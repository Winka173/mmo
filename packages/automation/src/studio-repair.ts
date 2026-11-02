import * as fs from "node:fs/promises";
import {createHash} from "node:crypto";
import {z} from "zod";
import {Timeline,TimelineClip} from "@ttm/core";
import {withLock,writeJsonAtomic} from "@ttm/storage";
import {StudioRun,STUDIO_STAGES,hash,type StudioStore} from "./studio.js";
import {FileQueue} from "./queue.js";
export const StudioRepairKind=z.enum(["captions","mix","encode"]);
type Kind=z.infer<typeof StudioRepairKind>;
const digest=(data:Buffer)=>createHash("sha256").update(data).digest("hex");
const affected:Record<Kind,string[]>={captions:["captions","render","preview","quality","eligibility","delivery"],mix:["render","preview","quality","eligibility","delivery"],encode:["render","preview","quality","eligibility","delivery"]};
/** Proposals are concrete and scoped. Factual/rights uncertainty cannot be repaired by rendering. */
export async function getStudioRepairPlan(studio:StudioStore,id:string){
 z.string().uuid().parse(id);const run=await studio.run(id);if(!run)throw new Error("Version not found");
 const dir=studio.store.p("studio","artifacts",id),qaBytes=await fs.readFile(`${dir}/qa.json`).catch(()=>null),timelineBytes=await fs.readFile(`${dir}/timeline.json`).catch(()=>null);
 if(!qaBytes||!timelineBytes)throw new Error("QA and an editable timeline are required / Cần QA và timeline đã lưu");
 const qa=JSON.parse(qaBytes.toString("utf8")),timeline=Timeline.parse(JSON.parse(timelineBytes.toString("utf8"))),rootId=run.repair?.rootId??run.id;
 const history=(await studio.runs()).filter(r=>r.repair?.rootId===rootId);
 const kinds:Kind[]=[];
 if(qa.captionQuality?.readability?.findings?.some((f:any)=>["caption.layout_overflow","caption.minimum_duration"].includes(f.criterion)))kinds.push("captions");
 if(qa.findings?.some((f:any)=>f.criterion==="audio_loudness"&&f.status!=="pass"))kinds.push("mix");
 if(qa.findings?.some((f:any)=>["container_and_codec","full_decode","resolution","duration","frame_timing"].includes(f.criterion)&&f.status!=="pass"))kinds.push("encode");
 const plan={schemaVersion:1,runId:id,rootId,qaSha256:digest(qaBytes),timelineSha256:digest(timelineBytes),operations:kinds.map(kind=>({kind,invalidatedStages:affected[kind],preserved:["sources","research","script","narration","voice_model"],attemptsUsed:history.filter(r=>r.repair?.kind===kind).length,maxAttempts:2,available:history.filter(r=>r.repair?.kind===kind).length<2&&["ready","failed","needs_input"].includes(run.state),method:kind==="captions"?"Regroup existing caption text within its original time bounds; no word alignment claim":kind==="mix"?"Normalize existing audio; stream-copy the current video":"Encode the existing track timeline; no local AI rerun"})),holds:["Facts, rights, editorial quality and publication authority require their own evidence and review"],history:history.map(r=>({id:r.id,state:r.state,...r.repair})),wordAlignment:timeline.captionTiming==="aligned"?"ALIGNED":"UNVERIFIED",willPublish:false};
 return{...plan,sha256:hash(plan)};
}
function regroupCaptions(timeline:Timeline){
 const limit=Math.max(20,Math.floor(timeline.width*.8/(Math.round(timeline.width*.052)*.55))),caps=timeline.clips.filter(c=>c.track==="caption").sort((a,b)=>a.start-b.start),result:TimelineClip[]=[];
 for(let i=0;i<caps.length;i++){
  const cap=caps[i],next=caps[i+1];
  // Merge a short adjacent cue only when the combined display stays bounded and readable.
  if(cap.duration<.8&&next&&Math.abs(next.start-(cap.start+cap.duration))<.08&&Array.from(cap.text+" "+next.text).length<=limit*2){result.push({...cap,text:cap.text+" "+next.text,duration:next.start+next.duration-cap.start});i++;continue;}
  const words=cap.text.split(/\s+/u).filter(Boolean),parts:string[]=[];let current="";
  for(const word of words){if(current&&Array.from(current+" "+word).length>limit*2){parts.push(current);current=word;}else current=current?current+" "+word:word;}if(current)parts.push(current);
  if(parts.length<2||cap.duration/parts.length<.8){result.push(cap);continue;}
  const total=parts.reduce((n,s)=>n+Array.from(s).length,0);let at=cap.start;
  for(let j=0;j<parts.length;j++){const duration=j===parts.length-1?cap.start+cap.duration-at:cap.duration*Array.from(parts[j]).length/total;result.push({...cap,id:`${cap.id}-reflow-${j}`,text:parts[j],start:at,duration});at+=duration;}
 }
 const before=caps.map(c=>c.text).join(" ").replace(/\s+/gu," ").trim(),after=result.map(c=>c.text).join(" ").replace(/\s+/gu," ").trim();
 if(before!==after)throw new Error("Caption repair must preserve every word");
 return Timeline.parse({...timeline,clips:[...timeline.clips.filter(c=>c.track!=="caption"),...result],captionTiming:"estimated"});
}
export async function requestStudioRepair(studio:StudioStore,input:unknown){
 const value=z.object({id:z.string().uuid(),kind:StudioRepairKind,expectedPlanSha256:z.string().regex(/^[a-f0-9]{64}$/)}).parse(input),initial=await studio.run(value.id);
 if(!initial)throw new Error("Version not found");const rootId=initial.repair?.rootId??initial.id;
 return withLock(studio.store.p("locks",`studio-repair-${rootId}.lock`),async()=>{
  const plan=await getStudioRepairPlan(studio,value.id);
  const key=`studio:repair:${value.id}:${value.kind}:${plan.qaSha256}:${plan.timelineSha256}`,queue=new FileQueue(studio.store),existing=await queue.findByKey(key);
  if(existing)return(await studio.run(String(existing.payload.runId)))!;
  if(plan.sha256!==value.expectedPlanSha256)throw new Error("Repair plan changed; reload before running / Kế hoạch sửa đã đổi, hãy tải lại");
  const operation=plan.operations.find(o=>o.kind===value.kind);if(!operation?.available)throw new Error("No safe matching repair or retry budget exhausted / Không có sửa phù hợp hoặc đã hết lượt thử");
  const parent=(await studio.run(value.id))!,timeline=(await studio.timeline(value.id))!;
  const nextTimeline=value.kind==="captions"?regroupCaptions(timeline):timeline;
  if(value.kind==="captions"&&hash(nextTimeline)===hash(timeline))throw new Error("No bounded caption regrouping is possible; edit captions after listening / Cần nghe và sửa phụ đề trực tiếp");
  const raw=hash(key),id=`${raw.slice(0,8)}-${raw.slice(8,12)}-4${raw.slice(13,16)}-a${raw.slice(17,20)}-${raw.slice(20,32)}`,now=new Date().toISOString();
  const child=StudioRun.parse({...parent,id,parentId:parent.id,planning:null,planRevision:null,repair:{rootId,parentId:parent.id,kind:value.kind,attempt:operation.attemptsUsed+1,planSha256:plan.sha256},edit:{kind:"timeline",operations:[]},trigger:"edit",state:"queued",stages:STUDIO_STAGES.map(id=>({id})),outputs:[],error:null,createdAt:now,updatedAt:now});
  await writeJsonAtomic(studio.store.p("studio","artifacts",id,"timeline.json"),nextTimeline);
  await writeJsonAtomic(studio.store.p("studio","artifacts",id,"repair-plan.json"),{...plan,selected:operation,parentVersion:parent.id,executionTimelineHash:hash(nextTimeline)});
  await studio.saveRun(child);await queue.enqueue({kind:"STUDIO_RUN",idempotencyKey:key,payload:{runId:id},usesGpu:false,maxAttempts:1});
  await studio.store.audit({actor:"studio-ui",action:"studio.repair_requested",subject:id,detail:child.repair??{}});return child;
 });
}
