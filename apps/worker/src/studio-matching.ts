import * as fs from "node:fs/promises";
import {createReadStream} from "node:fs";
import {createHash} from "node:crypto";
import path from "node:path";
import {z} from "zod";
import {hash,SemanticVector,embeddingTextHash,embeddingConfigHash,StudioMediaCatalog,StudioMediaAnnotations,type StudioRun} from "@ttm/automation";
import {FactoryError} from "@ttm/core";
import {writeJsonAtomic} from "@ttm/storage";
import {probeMedia} from "@ttm/media";
import {invokeLocalEngine} from "./local-engine.js";
import type {Ctx} from "./context.js";

export {StudioMediaAnnotations};
type Candidate={id:string;file:string;sha256:string;description:string;origin:"OWNER_ANNOTATION"|"UNANNOTATED_SOURCE";startSec:number;endSec:number|null;excludedReason:string|null};
type Assignment={shot:number;candidateId:string;file:string;sha256:string;sourceStart:number;sourceDuration:number|null;score:number|null;method:string;description:string;reused:boolean;semanticReview:"REQUIRED"|"UNKNOWN"};
const pinnedSchema=z.object({version:z.literal(1),sourceIdentity:z.string(),manifestSha256:z.string().nullable(),annotations:StudioMediaAnnotations.nullable(),identity:z.string()});
async function digest(file:string){const state=createHash("sha256");for await(const bytes of createReadStream(file))state.update(bytes);return state.digest("hex");}
const stop=new Set("a an the and or is are to of for in on with this that it from we you your our một những các và hoặc là của cho trong với này đó từ chúng ta bạn".split(/\s+/u));
function tokens(text:string){return new Set(text.toLowerCase().normalize("NFD").replace(/\p{M}/gu,"").replace(/đ/g,"d").split(/[^\p{L}\p{N}]+/u).filter(word=>word.length>1&&!stop.has(word)));}
export function metadataSimilarity(a:string,b:string){const left=tokens(a),right=tokens(b);if(!left.size||!right.size)return 0;const intersection=[...left].filter(word=>right.has(word)).length;return intersection/Math.sqrt(left.size*right.size);}
const overlaps=(start:number,end:number,interval:{start:number;end:number})=>start<interval.end&&end>interval.start;

/** Exact-content annotations are pinned once, so changing the watch folder cannot rewrite a retry. */
async function pinnedAnnotations(run:StudioRun,dir:string,ctx:Ctx){
 const identity=hash(run.sources.map(source=>({sha256:source.sha256,size:source.size}))),file=path.join(dir,"source-matching-input.json");
 const previous=await fs.readFile(file,"utf8").then(JSON.parse,error=>{if(error.code!=="ENOENT")throw error;return null;});
 if(previous){const value=pinnedSchema.parse(previous),{identity:stored,...body}=value;if(stored!==hash(body)||value.sourceIdentity!==identity)throw new FactoryError("QUALITY_LOCK","BLOCKED","Pinned media annotations or source identity changed");return value;}
 let annotations:z.infer<typeof StudioMediaAnnotations>|null=null,manifestSha256:string|null=null;
 if(run.snapshot.sourceFolder){
  const source=path.join(run.snapshot.sourceFolder,"acs-media.json"),stat=await fs.lstat(source).catch(error=>{if(error.code!=="ENOENT")throw error;return null;});
  if(stat){if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256000)throw new FactoryError("MEDIA_ANNOTATIONS","HUMAN_REQUIRED","acs-media.json must be a regular file under 256 KB");
   const bytes=await fs.readFile(source);manifestSha256=createHash("sha256").update(bytes).digest("hex");
   try{annotations=StudioMediaAnnotations.parse(JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/,"")));}catch(error:any){throw new FactoryError("MEDIA_ANNOTATIONS","HUMAN_REQUIRED",`Invalid acs-media.json: ${error.message}`);}
   for(const entry of annotations.assets)if(!run.sources.some(row=>row.sha256===entry.sha256))throw new FactoryError("MEDIA_ANNOTATIONS","HUMAN_REQUIRED",`Annotation ${entry.file} does not match any pinned source SHA; update stale metadata`);
  }
 }
 // The app-owned catalog overrides descriptions for this SHA only when first pinning a fresh run.
 // A resumed run uses the immutable input above, so later metadata edits cannot rewrite it.
 if(ctx.store){const catalog=new StudioMediaCatalog(ctx.store),assets=[...(annotations?.assets??[])];for(const source of run.sources){const record=await catalog.get(source.sha256);if(!record)continue;const entry={file:path.basename(source.file),sha256:source.sha256,description:record.description,segments:record.segments},index=assets.findIndex(row=>row.sha256===source.sha256);if(index>=0)assets[index]=entry;else assets.push(entry);}if(assets.length)annotations=StudioMediaAnnotations.parse({version:1,assets});}
 const body={version:1 as const,sourceIdentity:identity,manifestSha256,annotations};const result={...body,identity:hash(body)};await writeJsonAtomic(file,result);return result;
}

function candidatesFor(run:StudioRun,annotations:z.infer<typeof StudioMediaAnnotations>|null,analysis:any){
 const candidates:Candidate[]=[],seen=new Set<string>();
 for(const source of run.sources){
  if(seen.has(source.sha256))continue;seen.add(source.sha256);
  const entry=annotations?.assets.find(item=>item.sha256===source.sha256),measured=analysis?.results?.find((item:any)=>item.sha256===source.sha256&&item.status==="MEASURED_LOCAL_HEURISTICS")?.analysis;
  const scenes=entry?.segments.length?entry.segments:[{startSec:0,endSec:null,description:entry?.description??""}];
  if(entry?.segments.length&&!/\.(mp4|mov|mkv|webm)$/i.test(source.file))throw new FactoryError("MEDIA_ANNOTATIONS","HUMAN_REQUIRED","Still images cannot contain timed scene annotations");
  for(const scene of scenes){
   const end=scene.endSec;let excludedReason:string|null=null;
   if(end!==null&&measured?.durationSec&&end>measured.durationSec+.001)throw new FactoryError("MEDIA_ANNOTATIONS","HUMAN_REQUIRED","Annotated scene exceeds measured source duration");
   if(end!==null&&measured&&[...(measured.blacks??[]),...(measured.freezes??[])].some(interval=>overlaps(scene.startSec,end,interval)))excludedReason="Annotated interval overlaps measured black/frozen footage";
   candidates.push({id:hash([source.sha256,scene.startSec,end]),file:source.file,sha256:source.sha256,description:scene.description,origin:entry?"OWNER_ANNOTATION":"UNANNOTATED_SOURCE",startSec:scene.startSec,endSec:end,excludedReason});
  }
 }
 return candidates;
}

/** Scores compare supplied descriptions with narration; they never inspect or certify source pixels. */
export function chooseStudioMedia(shots:{text:string}[],candidates:Candidate[],scores:number[][]|null){
 const available=candidates.filter(row=>!row.excludedReason);if(!available.length)throw new FactoryError("MEDIA_MATCH","HUMAN_REQUIRED","No eligible source interval remains after media checks");
 const usage=new Map<string,number>(),assignments:Assignment[]=[];
 for(const [index,shot]of shots.entries()){
  const ranked=available.map(candidate=>{const candidateIndex=candidates.indexOf(candidate),raw=candidate.description?(scores?.[index]?.[candidateIndex]??metadataSimilarity(shot.text,candidate.description)):0,used=usage.get(candidate.id)??0;
   const previous=assignments.at(-1),consecutive=previous?.sha256===candidate.sha256;
   return {candidate,raw,used,rank:raw-Math.min(.24,used*.08)-(consecutive ? .12 : 0)};
  }).sort((a,b)=>b.rank-a.rank||a.used-b.used||a.candidate.id.localeCompare(b.candidate.id));
  const lastTwo=assignments.slice(-2),repeatingSource=lastTwo.length===2&&lastTwo[0].sha256===lastTwo[1].sha256?lastTwo[0].sha256:null;
  const repeatingScene=lastTwo.length===2&&lastTwo[0].candidateId===lastTwo[1].candidateId?lastTwo[0].candidateId:null;
  const selected=(repeatingSource?ranked.find(row=>row.candidate.sha256!==repeatingSource):null)??(repeatingScene?ranked.find(row=>row.candidate.id!==repeatingScene):null)??ranked[0],candidate=selected.candidate;usage.set(candidate.id,selected.used+1);
  assignments.push({shot:index,candidateId:candidate.id,file:candidate.file,sha256:candidate.sha256,sourceStart:candidate.startSec,sourceDuration:candidate.endSec===null?null:candidate.endSec-candidate.startSec,score:candidate.description?selected.raw:null,method:candidate.description?(scores?"LOCAL_TEXT_EMBEDDING_OWNER_DESCRIPTION":"LEXICAL_OWNER_DESCRIPTION"):"UNANNOTATED_BALANCED_SELECTION",description:candidate.description,reused:selected.used>0,semanticReview:candidate.description?"REQUIRED":"UNKNOWN"});
 }
 return assignments;
}

export async function matchStudioShots(ctx:Ctx,run:StudioRun,dir:string){
 if(!run.sources.length||!run.shots.length||run.edit||["localization","shorts"].includes(run.snapshot.family))return null;
 for(const source of run.sources)if(await digest(source.file)!==source.sha256)throw new FactoryError("QUALITY_LOCK","BLOCKED","Pinned media changed before shot matching");
 const input=await pinnedAnnotations(run,dir,ctx),analysis=await fs.readFile(path.join(dir,"source-analysis.json"),"utf8").then(JSON.parse,()=>null),candidates=candidatesFor(run,input.annotations,analysis);
 for(const source of run.sources){const timed=candidates.filter(row=>row.sha256===source.sha256&&row.endSec!==null);if(!timed.length)continue;const probe=await probeMedia(source.file,run.config.ffprobe);if(!probe.hasVideo||timed.some(row=>row.endSec!>probe.durationSec+.001))throw new FactoryError("MEDIA_ANNOTATIONS","HUMAN_REQUIRED","Annotated scene exceeds actual source duration");}
 const key=hash({version:1,input:input.identity,shots:run.shots.map(shot=>shot.text),candidates,embedding:embeddingConfigHash(run.config)}),file=path.join(dir,"source-matching.json");
 let report=await fs.readFile(file,"utf8").then(JSON.parse,()=>null);
 if(report&&report.key===key){const {reportSha256,...body}=report;if(reportSha256!==hash(body))throw new FactoryError("QUALITY_LOCK","BLOCKED","Cached shot matching report changed");}
 else{
  let scores:number[][]|null=null,embedding:any=null;
  const annotated=candidates.filter(row=>row.description&&!row.excludedReason);
  if(annotated.length&&run.config.pythonEmbedding&&run.config.embeddingModel){
   const texts=[...run.shots.map((shot,index)=>({id:`shot-${index}`,text:shot.text,role:"query"})),...annotated.map(row=>({id:row.id,text:row.description,role:"document"}))],vectors=new Map<string,number[]>();let fingerprint="";
   for(let offset=0;offset<texts.length;offset+=32){const batch=texts.slice(offset,offset+32),response=await invokeLocalEngine(ctx,run.config,{op:"embed",texts:batch},path.join(dir,`media-match-${offset}.request.json`));
    if(!/^[a-f0-9]{64}$/.test(response.fingerprint)||response.documents?.length!==batch.length||fingerprint&&fingerprint!==response.fingerprint)throw new FactoryError("QUALITY_LOCK","BLOCKED","Media embedding response identity changed");
    fingerprint=response.fingerprint;const {documents:_,...metadata}=response;embedding=metadata;
    for(const [index,item]of batch.entries()){const result=response.documents[index];if(result.id!==item.id||result.textSha256!==embeddingTextHash(item.text))throw new FactoryError("QUALITY_LOCK","BLOCKED","Media embedding text identity changed");vectors.set(item.id,SemanticVector.parse(result.vector));}
   }
   scores=run.shots.map((_,index)=>candidates.map(candidate=>{const left=vectors.get(`shot-${index}`),right=vectors.get(candidate.id);return left&&right?left.reduce((sum,value,column)=>sum+value*right[column],0):0;}));
  }
  const assignments=chooseStudioMedia(run.shots,candidates,scores),body={version:1,key,at:new Date().toISOString(),inputIdentity:input.identity,manifestSha256:input.manifestSha256,method:embedding?"LOCAL_TEXT_EMBEDDING":"DETERMINISTIC_METADATA",embedding,candidates,assignments,coverage:{sources:run.sources.length,annotatedSources:input.annotations?.assets.length??0,shots:run.shots.length,unannotatedAssignments:assignments.filter(row=>row.semanticReview==="UNKNOWN").length},visualUnderstanding:"NOT_PERFORMED",meaningReview:"REQUIRED",rightsReview:"REQUIRED",publicationApproval:false,warnings:[...(!input.annotations?["No acs-media.json descriptions; selection balances sources and does not claim visual/narration agreement"]:[]),...(!embedding&&annotated.length?["No embedding runtime configured; explicit lexical description matching used"]:[]),...(assignments.some(row=>row.reused)?["Some source intervals are reused; inspect repetition before approval"]:[])]};
  report={...body,reportSha256:hash(body)};await writeJsonAtomic(file,report);
 }
 if(report.assignments.length!==run.shots.length)throw new FactoryError("QUALITY_LOCK","BLOCKED","Matching assignment count differs from script");
 for(const row of report.assignments as Assignment[]){const shot=run.shots[row.shot];if(!shot||!run.sources.some(source=>source.file===row.file&&source.sha256===row.sha256))throw new FactoryError("QUALITY_LOCK","BLOCKED","Matched asset is outside pinned sources");shot.asset=row.file;shot.sourceStart=row.sourceStart;shot.sourceDuration=row.sourceDuration;}
 // These reports carry source descriptions and measured selection provenance, never credentials.
 run.outputs=[...new Set([...run.outputs,"source-matching-input.json","source-matching.json"])];
 return report;
}
