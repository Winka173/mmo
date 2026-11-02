import * as fs from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import path from "node:path";
import {z} from "zod";
import {withLock,writeJsonAtomic} from "@ttm/storage";
import {StudioRun,Shot,hash,planRunIdentity,type StudioStore} from "./studio.js";
import {VoiceStore,VoiceSample} from "./voices.js";
import {FileQueue} from "./queue.js";
import {studioEngineKeys,GPU_ENGINE_KEY} from "./engine-health.js";
import {applyPronunciations} from "./pronunciation.js";
const digest=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
export const PlanRevisionInput=z.object({id:z.string().uuid(),expectedSha256:z.string().regex(/^[a-f0-9]{64}$/),shots:z.array(Shot).min(1).max(12)});
/** Each save is a new immutable plan. No queue work, rendering or publication permission. */
export async function reviseStudioPlan(studio:StudioStore,input:unknown){
 const value=PlanRevisionInput.parse(input);
 return withLock(studio.store.p("locks",`studio-plan-${value.id}.lock`),async()=>{
  const parent=await studio.run(value.id);
  if(!parent||parent.planning?.state!=="ready"||parent.state!=="needs_input"||parent.planning.sha256!==value.expectedSha256)throw new Error("Reload the completed plan before editing / Tải lại kế hoạch đã hoàn thành");
  const original=await fs.readFile(studio.store.p("studio","artifacts",parent.id,"plan.json"));
  if(digest(original)!==value.expectedSha256||planRunIdentity(JSON.parse(original.toString("utf8")))!==planRunIdentity(parent))throw new Error("Pinned plan integrity failed");
  // Preserve product research/affiliate disclosure lines, including ordering. Any new claims still need independent review.
  const research=await fs.readFile(studio.store.p("studio","artifacts",parent.id,"research.json"),"utf8").then(JSON.parse,()=>null);
  if(parent.snapshot.family==="product"&&research){
   const required=(research.draft?.shots??[]).filter((s:any)=>!s.claimIds?.length).map((s:any)=>s.text);
   const positions=required.map((text:string)=>value.shots.findIndex(s=>s.text===text));
   if(positions.some((n:number,i:number)=>n<0||i>0&&n<=positions[i-1]))throw new Error("Keep required product and affiliate disclosures unchanged / Giữ nguyên các câu công bố bắt buộc");
  }
  for(const shot of value.shots){
   if(!parent.sources.some(s=>s.file===shot.asset))throw new Error("Choose an existing pinned source / Chọn media đã ghim");
   if(/\.(png|jpe?g|webp)$/i.test(shot.asset)&&(shot.sourceStart!==0||shot.sourceDuration!==null))throw new Error("Still images have no source time range");
   if(shot.sourceDuration!==null&&shot.sourceDuration<=0)throw new Error("Invalid source duration");
  }
  const changedScenes=value.shots.map((s,i)=>hash(s)!==hash(parent.shots[i])?i:-1).filter(i=>i>=0);
  if(value.shots.length!==parent.shots.length)changedScenes.push(...parent.shots.map((_,i)=>i).filter(i=>i>=value.shots.length));
  if(!changedScenes.length)throw new Error("Plan is unchanged / Kế hoạch chưa thay đổi");
  const now=new Date().toISOString(),id=randomUUID(),dir=studio.store.p("studio","artifacts",id);
  await fs.mkdir(dir,{recursive:true});
  const child=StudioRun.parse({...parent,id,parentId:null,edit:null,repair:null,planRevision:{parentId:parent.id,parentSha256:value.expectedSha256,changedScenes},shots:value.shots,createdAt:now,updatedAt:now,outputs:[],error:null});
  // Copy only immutable evidence; source media stay referenced by pinned path/hash, never overwritten.
  for(const file of ["research.json","citations.md","product-evidence.json","product-publication-description.txt","llm-evidence.json","source-analysis.json","source-matching.json","source-matching-input.json"]){
   const source=studio.store.p("studio","artifacts",parent.id,file);if(await fs.stat(source).catch(()=>null)){await fs.copyFile(source,path.join(dir,file));child.outputs.push(file);}
  }
  const plan={version:1,runId:id,snapshotHash:child.snapshotHash,renderTimingVersion:child.renderTimingVersion,language:child.language,title:child.title,shots:child.shots,sources:child.sources,researchHash:child.researchHash,revision:child.planRevision,createdAt:now,timing:"UNMEASURED_BEFORE_NARRATION",factApproval:"REQUIRED_AFTER_MANUAL_EDIT",rightsApproval:"REQUIRED",willPublish:false};
  await writeJsonAtomic(path.join(dir,"plan.json"),plan);child.planning={state:"ready",sha256:digest(await fs.readFile(path.join(dir,"plan.json")))};child.outputs.push("plan.json");
  for(const stage of child.stages)if(["script","storyboard","media"].includes(stage.id)){stage.state="flagged";stage.note="Manually revised plan; facts, source agreement and creative quality require fresh review";}
  await studio.saveRun(child);await studio.store.audit({actor:"studio-ui",action:"studio.revise_plan",subject:id,detail:{...child.planRevision,willPublish:false}});return child;
 });
}
/** Listen to one line using the plan's frozen config, independently of subsequent global changes. */
export async function previewStudioPlanLine(studio:StudioStore,id:string,index:number){
 z.string().uuid().parse(id);z.number().int().nonnegative().parse(index);
 return withLock(studio.store.p("locks",`studio-plan-${id}.lock`),async()=>{
  const run=await studio.run(id);if(!run||run.planning?.state!=="ready"||run.state!=="needs_input"||!run.shots[index])throw new Error("Select a completed plan line first");
  const bytes=await fs.readFile(studio.store.p("studio","artifacts",id,"plan.json"));
  if(digest(bytes)!==run.planning.sha256||planRunIdentity(JSON.parse(bytes.toString("utf8")))!==planRunIdentity(run))throw new Error("Plan integrity failed");
  const queue=new FileQueue(studio.store),key=`plan-voice:${id}:${run.planning.sha256}:${index}`,prior=await queue.findByKey(key);
  if(prior){const row=await new VoiceStore(studio.store).get(String(prior.payload.sampleId));if(!row)throw new Error("Audition record unavailable");return row;}
  const now=new Date().toISOString(),raw=hash(key),sampleId=`${raw.slice(0,8)}-${raw.slice(8,12)}-4${raw.slice(13,16)}-a${raw.slice(17,20)}-${raw.slice(20,32)}`,voices=new VoiceStore(studio.store);
  const text=applyPronunciations(run.shots[index].text,run.language,run.snapshot.pronunciation);
  const sample=await voices.save(VoiceSample.parse({id:sampleId,language:run.language,text,config:run.config,configHash:hash(run.config),state:"queued",createdAt:now,updatedAt:now}));
  const engineKeys=studioEngineKeys(run.config,run.language,true);
  await queue.enqueue({kind:"STUDIO_VOICE",idempotencyKey:key,payload:{sampleId,engineKeys},usesGpu:engineKeys.includes(GPU_ENGINE_KEY),priority:2});return sample;
 });
}
