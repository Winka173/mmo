import * as fs from "node:fs/promises";
import {createReadStream} from "node:fs";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {z} from "zod";
import {DataStore,readJson,writeJsonAtomic,withLock} from "@ttm/storage";
import {StudioStore,StudioConfig,hash} from "./studio.js";
import {FileQueue} from "./queue.js";
import {engineKey,GPU_ENGINE_KEY} from "./engine-health.js";

const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const StudioSceneAnnotation=z.object({startSec:z.number().finite().nonnegative(),endSec:z.number().finite().positive(),description:z.string().trim().min(1).max(1500)}).strict().refine(row=>row.endSec>row.startSec,"Scene end must follow its start");
export const StudioMediaAnnotations=z.object({version:z.literal(1),assets:z.array(z.object({file:z.string().min(1).max(255).refine(name=>path.basename(name)===name&&!/[\\/:]/.test(name),"Use a source basename"),sha256:sha,description:z.string().trim().min(1).max(1500),segments:z.array(StudioSceneAnnotation).max(8).default([])}).strict()).max(40)}).strict().superRefine((value,ctx)=>{const seen=new Set<string>();for(const row of value.assets){if(seen.has(row.sha256))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Duplicate source SHA annotation"});seen.add(row.sha256);}});
export const StudioCatalogRecord=z.object({version:z.literal(1),sha256:sha,revision:z.number().int().positive(),displayName:z.string().trim().min(1).max(255).refine(name=>!/[\\/:]/.test(name),"Use a display name without path separators"),description:z.string().trim().min(1).max(1500),segments:z.array(StudioSceneAnnotation).max(8),runId:z.string().uuid(),reviewedSuggestionId:z.string().uuid().nullable(),createdAt:z.string(),recordHash:sha});
export type StudioCatalogRecord=z.infer<typeof StudioCatalogRecord>;
export const StudioVisionSuggestion=z.object({description:z.string().trim().min(1).max(1500),subjects:z.array(z.string().max(100)).max(10),possibleIssues:z.array(z.enum(["loading_screen","debug_overlay","mostly_black","unclear_subject","none_observed"])).max(5)}).strict();
export const StudioMediaVisionTask=z.object({id:z.string().uuid(),runId:z.string().uuid(),sourceSha256:sha,sourceFile:z.string(),positions:z.array(z.number().finite().nonnegative()).min(1).max(3),config:StudioConfig,configHash:sha,state:z.enum(["queued","running","ready","failed"]),result:z.record(z.unknown()).nullable(),error:z.string().nullable(),createdAt:z.string(),updatedAt:z.string()});
export type StudioMediaVisionTask=z.infer<typeof StudioMediaVisionTask>;
export async function studioFileDigest(file:string){const digest=createHash("sha256");for await(const bytes of createReadStream(file))digest.update(bytes);return digest.digest("hex");}
const contained=(root:string,file:string)=>{const relative=path.relative(root,file);return relative!==""&&!relative.startsWith(`..${path.sep}`)&&relative!==".."&&!path.isAbsolute(relative);};

/** Owner descriptions are separate from rights and model suggestions. Each accepted edit is immutable. */
export class StudioMediaCatalog{
 constructor(readonly store:DataStore){}
 recordFile(sourceSha:string,revision:number){return this.store.p("studio","media-catalog",sha.parse(sourceSha),`revision-${z.number().int().positive().parse(revision)}.json`);}
 async get(sourceSha:string){
  const head=await readJson(this.store.p("studio","media-catalog",sha.parse(sourceSha),"head.json"),z.object({revision:z.number().int().positive(),recordHash:sha}));if(!head)return null;
  const row=await readJson(this.recordFile(sourceSha,head.revision),StudioCatalogRecord);if(!row)throw new Error("Catalog revision missing");
  const {recordHash,...body}=row;if(recordHash!==hash(body)||head.recordHash!==recordHash||row.sha256!==sourceSha)throw new Error("Catalog metadata integrity failed");return row;
 }
 async source(runId:string,sourceSha:string,verify=true){
  const run=await new StudioStore(this.store).run(z.string().uuid().parse(runId));if(!run)throw new Error("Production version missing");
  const source=run.sources.find(row=>row.sha256===sha.parse(sourceSha));if(!source)throw new Error("Source is not pinned in this version");
  const root=await fs.realpath(this.store.p("studio","artifacts")),actual=await fs.realpath(source.file);
  if(!contained(root,actual))throw new Error("Pinned source is outside the application artifact library");
  const stat=await fs.stat(actual);if(!stat.isFile()||stat.size!==source.size||verify&&await studioFileDigest(actual)!==source.sha256)throw new Error("Pinned source integrity failed");
  return {run,source:{...source,file:actual}};
 }
 async list(runId:string){
  const run=await new StudioStore(this.store).run(z.string().uuid().parse(runId));if(!run)throw new Error("Production version missing");
  const intake=await fs.readFile(this.store.p("studio","artifacts",run.id,"source-intake.json"),"utf8").then(JSON.parse,()=>null);
  return Promise.all(run.sources.slice(0,40).map(async(source)=>{const annotation=await this.get(source.sha256),original=intake?.sources?.find((row:any)=>row.sha256===source.sha256)?.originalName;return {sha256:source.sha256,size:source.size,pinnedName:path.basename(source.file),originalName:typeof original==="string"?path.basename(original):null,displayName:annotation?.displayName??(typeof original==="string"?path.basename(original):path.basename(source.file)),kind:/\.(mp4|mov|mkv|webm)$/i.test(source.file)?"video":"image",annotation};}));
 }
 async save(input:unknown){
  const value=z.object({runId:z.string().uuid(),sha256:sha,expectedRevision:z.number().int().nonnegative(),displayName:StudioCatalogRecord.shape.displayName,description:StudioCatalogRecord.shape.description,segments:z.array(StudioSceneAnnotation).max(8).default([]),reviewedSuggestionId:z.string().uuid().nullable().default(null)}).strict().parse(input);
  return withLock(this.store.p("locks",`studio-media-${value.sha256}.lock`),async()=>{
   const {source}=await this.source(value.runId,value.sha256),prior=await this.get(value.sha256);if((prior?.revision??0)!==value.expectedRevision)throw new Error("Media description changed; reload before saving");
   if(value.segments.length&&!/\.(mp4|mov|mkv|webm)$/i.test(source.file))throw new Error("Still images cannot contain timed scenes");
   if(value.reviewedSuggestionId){const task=await this.vision(value.reviewedSuggestionId);if(!task||task.state!=="ready"||task.sourceSha256!==value.sha256)throw new Error("Select a completed suggestion for this exact source");}
   const {expectedRevision:_,...fields}=value,parsed=StudioCatalogRecord.parse({...fields,version:1,revision:(prior?.revision??0)+1,createdAt:new Date().toISOString(),recordHash:"0".repeat(64)}),{recordHash:__,...body}=parsed,record={...body,recordHash:hash(body)};
   const revisionFile=this.recordFile(record.sha256,record.revision);if(await fs.stat(revisionFile).catch(()=>null))throw new Error("An immutable revision already exists; inspect interrupted catalog save before retrying");
   await writeJsonAtomic(revisionFile,record);await writeJsonAtomic(this.store.p("studio","media-catalog",record.sha256,"head.json"),{revision:record.revision,recordHash:record.recordHash});
   await this.store.audit({actor:"studio-ui",action:"studio.media_annotation",subject:record.sha256,detail:{revision:record.revision,runId:record.runId,reviewedSuggestionId:record.reviewedSuggestionId,rightsChanged:false}});return record;
  });
 }
 async manifest(runId:string){const rows=await this.list(runId);return StudioMediaAnnotations.parse({version:1,assets:rows.filter(row=>row.annotation).map(row=>({file:row.pinnedName,sha256:row.sha256,description:row.annotation!.description,segments:row.annotation!.segments}))});}
 vision(id:string){return readJson(this.store.p("studio","media-vision",`${z.string().uuid().parse(id)}.json`),StudioMediaVisionTask);}
 async visions(runId:string){z.string().uuid().parse(runId);const names=await fs.readdir(this.store.p("studio","media-vision")).catch(()=>[] as string[]);return(await Promise.all(names.filter(name=>/^[a-f0-9-]{36}\.json$/.test(name)).map(name=>this.vision(name.slice(0,-5))))).filter((row):row is StudioMediaVisionTask=>!!row&&row.runId===runId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,12);}
 async saveVision(input:StudioMediaVisionTask){const value=StudioMediaVisionTask.parse({...input,updatedAt:new Date().toISOString()});await writeJsonAtomic(this.store.p("studio","media-vision",`${value.id}.json`),value);return value;}
 async enqueueVision(input:unknown){
  const value=z.object({runId:z.string().uuid(),sha256:sha,positions:z.array(z.number().finite().nonnegative().max(86400)).min(1).max(3).default([0])}).strict().parse(input),{source}=await this.source(value.runId,value.sha256),config=await new StudioStore(this.store).config();
  if(!config.llmManaged||!config.llmModel||!config.python)throw new Error("Apply the managed local Qwen vision profile first; external providers are not supported");
  if(!/\.(mp4|mov|mkv|webm)$/i.test(source.file)&&value.positions.some(position=>position!==0))throw new Error("Still images have no keyframe time");
  return withLock(this.store.p("locks",`studio-media-vision-${value.sha256}.lock`),async()=>{
   const configHash=hash(config),positions=[...new Set(value.positions)].sort((a,b)=>a-b),pending=(await this.visions(value.runId)).find(row=>["queued","running"].includes(row.state)&&row.sourceSha256===value.sha256&&hash(row.positions)===hash(positions)&&row.configHash===configHash);if(pending)return pending;
   const now=new Date().toISOString(),task=await this.saveVision(StudioMediaVisionTask.parse({id:randomUUID(),runId:value.runId,sourceSha256:value.sha256,sourceFile:source.file,positions,config,configHash,state:"queued",result:null,error:null,createdAt:now,updatedAt:now}));
   await new FileQueue(this.store).enqueue({kind:"STUDIO_MEDIA_VISION",idempotencyKey:`media-vision:${task.id}`,payload:{taskId:task.id,engineKeys:[engineKey(config,"script"),...(config.llmDevice!=="cpu"?[GPU_ENGINE_KEY]:[])]},usesGpu:config.llmDevice!=="cpu",maxAttempts:3,priority:7});return task;
  });
 }
}
