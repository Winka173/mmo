import { describe, expect, it } from "vitest";
import {errorGuidance,nextActions,type NextActionInput} from "../../web/app/components/studio-guidance.js";
const blank=():NextActionInput=>({runs:[],autopilots:[],settings:{paused:false,killSwitch:false},workerHealth:{status:"online"},engines:[]});
describe("workspace next-step guidance",()=>{
 it("keeps emergency stop ahead of production and only offers navigation",()=>{
  const data={...blank(),settings:{paused:true,killSwitch:true},workerHealth:{status:"dead"}};
  const rows=nextActions(data,true);
  expect(rows[0].id).toBe("stopped");expect(rows.some(row=>row.id==="paused")).toBe(false);expect(rows[1].id).toBe("worker");
  expect(rows.every(row=>row.href.startsWith("/")&&!/approve|publish|action=/.test(row.href))).toBe(true);
 });
 it("resumes the exact saved plan and keeps a separate Autopilot draft discoverable",()=>{
  const data:NextActionInput={...blank(),autopilots:[{id:"planned",name:"One-off",enabled:false,step:3},{id:"draft",name:"Weekly plan",enabled:false,step:4}],runs:[{id:"plan/id",autopilotId:"planned",title:"Owned source",state:"needs_input",planning:{state:"ready"},outputs:["plan.json"]}]};
  const rows=nextActions(data,false);
  expect(rows.find(row=>row.id==="plan-plan/id")?.href).toBe("/studio/create?id=plan%2Fid");
  expect(rows.filter(row=>row.id.startsWith("blocked-"))).toEqual([]);expect(rows.find(row=>row.id==="draft-draft")?.href).toBe("/studio/autopilots?id=draft");
 });
 it("never labels a merely present artifact or queued version as ready",()=>{
  const data:NextActionInput={...blank(),runs:[{id:"queued",title:"Queued output",state:"queued",outputs:["final.mp4"]},{id:"no-final",title:"Plan",state:"ready",outputs:["plan.json"]}]};
  expect(nextActions(data,true).some(row=>row.tone==="ready")).toBe(false);
  data.runs.push({id:"actual",title:"Actual output",state:"ready",outputs:["final.mp4"]});
  const ready=nextActions(data,true).find(row=>row.tone==="ready");expect(ready?.href).toBe("/studio/editor?id=actual");expect(ready?.detail).toContain("before deciding");
 });
 it("handles a clean workspace without inventing installed models or ownership",()=>{
  const rows=nextActions(blank(),false);expect(rows.map(row=>row.id)).toEqual(["first-create"]);expect(rows[0].href).toBe("/studio/create");
 });
});
describe("actionable error guidance",()=>{
 it("distinguishes GPU waits from GPU exhaustion and never asks to delete a lease",()=>{
  expect(errorGuidance("GPU lease busy",true).title).toBe("Waiting for the GPU");expect(errorGuidance("CUDA out of memory",true).title).toContain("memory");
  expect(errorGuidance("GPU lease busy",true).detail).toContain("does not justify deleting locks");
 });
 it("points tools, voices and rights errors to their relevant destination",()=>{
  expect(errorGuidance("ffprobe missing",true).href).toBe("/studio/settings");expect(errorGuidance("VOICE_QA: ASR mismatch",true).href).toBe("/studio/editor");expect(errorGuidance("rights expired",true).href).toBe("/studio/review");
 });
 it("keeps unknown errors unknown and gives navigation instead of a fake fix",()=>{
  expect(errorGuidance("unexpected sentinel 912",true).title).toBe("The action did not complete");expect(errorGuidance("unexpected sentinel 912",true).detail).toContain("original error");
  expect(errorGuidance("artifact changed unexpectedly",true).title).toBe("The action did not complete");
 });
});
