import {randomUUID,createHash} from "node:crypto";
import * as fs from "node:fs/promises";
import {z} from "zod";
import {DataStore,readJson,writeJsonAtomic,withLock} from "@ttm/storage";
import {FileQueue} from "./queue.js";
import {StudioStore,StudioConfig,hash} from "./studio.js";
import {engineKey} from "./engine-health.js";

export const SemanticDocument=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),runId:z.string().uuid(),title:z.string(),language:z.string(),chunk:z.number().int().nonnegative(),text:z.string().min(1).max(3000),textHash:z.string().regex(/^[a-f0-9]{64}$/)});
export type SemanticDocument=z.infer<typeof SemanticDocument>;
export const SemanticVector=z.array(z.number().finite()).length(1024).refine(v=>Math.abs(v.reduce((sum,x)=>sum+x*x,0)-1)<0.02,"Embedding must be L2-normalized");
export const SemanticIndex=z.object({schemaVersion:z.literal(1),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),configHash:z.string(),corpusHash:z.string(),documents:z.array(SemanticDocument.extend({vector:SemanticVector})).max(600),coverage:z.object({eligibleRoots:z.number(),indexedRoots:z.number(),excludedDerivedVersions:z.number(),limit:z.literal(100)}),createdAt:z.string(),evidence:z.record(z.unknown())});
export type SemanticIndex=z.infer<typeof SemanticIndex>;
export const SemanticTask=z.object({id:z.string().uuid(),kind:z.enum(["index","search"]),query:z.string().max(2000).default(""),config:StudioConfig,configHash:z.string(),state:z.enum(["queued","running","ready","failed"]),result:z.record(z.unknown()).nullable().default(null),error:z.string().nullable().default(null),createdAt:z.string(),updatedAt:z.string()});
export type SemanticTask=z.infer<typeof SemanticTask>;
export const embeddingConfigHash=(config:StudioConfig)=>hash({python:config.pythonEmbedding,model:config.embeddingModel,device:config.embeddingDevice});
export const embeddingTextHash=(text:string)=>createHash("sha256").update(text,"utf8").digest("hex");
export function semanticChunks(text:string):string[]{
 const words=text.trim().split(/\s+/u).filter(Boolean),chunks:string[]=[];let current="";
 for(const word of words){if(word.length>3000)throw new Error("A script token exceeds the semantic chunk limit");if(current&&current.length+1+word.length>3000){chunks.push(current);current="";}current+=(current?" ":"")+word;}
 if(current)chunks.push(current);return chunks;
}
/** Derived vectors never become authority for scripts, rights, originality or facts. */
export class SemanticStore{
 constructor(readonly store:DataStore){}
 taskFile(id:string){return this.store.p("studio","semantic","tasks",`${z.string().uuid().parse(id)}.json`);}
 get(id:string){return readJson(this.taskFile(id),SemanticTask);}
 async tasks(){const names=await fs.readdir(this.store.p("studio","semantic","tasks")).catch(()=>[] as string[]);return (await Promise.all(names.filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(n=>this.get(n.slice(0,-5))))).filter((row):row is SemanticTask=>!!row).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 async save(row:SemanticTask){const value=SemanticTask.parse({...row,updatedAt:new Date().toISOString()});await writeJsonAtomic(this.taskFile(value.id),value);return value;}
 index(){return readJson(this.store.p("studio","semantic","index.json"),SemanticIndex);}
 async corpus(){
  const runs=await new StudioStore(this.store).runs(),eligible=runs.filter(r=>r.state==="ready"&&!r.parentId&&r.shots.some(s=>s.text.trim())).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)),selected=eligible.slice(0,100);
  const documents:SemanticDocument[]=[];let indexedRoots=0;
  for(const run of selected){const chunks=semanticChunks(`${run.title}\n${run.shots.map(s=>s.text).join("\n")}`);if(documents.length+chunks.length>600)break;
   for(const[textIndex,text]of chunks.entries()){const textHash=embeddingTextHash(text);documents.push(SemanticDocument.parse({id:hash([run.id,textIndex,textHash]),runId:run.id,title:run.title,language:run.language,chunk:textIndex,text,textHash}));}indexedRoots++;
  }
  return {documents,hash:hash(documents),coverage:{eligibleRoots:eligible.length,indexedRoots,excludedDerivedVersions:runs.filter(r=>!!r.parentId).length,limit:100 as const}};
 }
 async enqueue(input:unknown){
  const value=z.object({kind:z.enum(["index","search"]),query:z.string().trim().max(2000).default("")}).strict().parse(input);
  if(value.kind==="search"&&!value.query)throw new Error("Enter a search query");
  const config=await new StudioStore(this.store).config();if(!config.pythonEmbedding||!config.embeddingModel)throw new Error("Install/apply the local embedding profile first");
  if(value.kind==="search"&&!await this.index())throw new Error("Build the semantic index first");
  return withLock(this.store.p("locks","semantic-request.lock"),async()=>{
   const configHash=hash(config),pending=(await this.tasks()).find(row=>["queued","running"].includes(row.state)&&row.kind===value.kind&&row.query===value.query&&row.configHash===configHash);if(pending)return pending;
   const now=new Date().toISOString(),row=await this.save(SemanticTask.parse({...value,id:randomUUID(),config,configHash,state:"queued",createdAt:now,updatedAt:now}));
   await new FileQueue(this.store).enqueue({kind:"STUDIO_SEMANTIC",idempotencyKey:`semantic:${row.id}`,payload:{taskId:row.id,engineKeys:[engineKey(config,"embed")]},usesGpu:config.embeddingDevice==="cuda",maxAttempts:3,priority:6});return row;
  });
 }
 /** Incremental refresh: when an index already exists and the library changed, queue one index task (only new or changed scripts are embedded). */
 async refreshIfStale(){const summary=await this.summary();if(!summary?.stale)return null;if((await this.tasks()).some(t=>t.kind==="index"&&["queued","running"].includes(t.state)))return null;return this.enqueue({kind:"index"}).catch(()=>null);}
 async summary(){const index=await this.index();if(!index)return null;const corpus=await this.corpus(),config=await new StudioStore(this.store).config();return {createdAt:index.createdAt,documents:index.documents.length,coverage:index.coverage,fingerprint:index.fingerprint,stale:index.corpusHash!==corpus.hash||index.configHash!==embeddingConfigHash(config)};}
}
