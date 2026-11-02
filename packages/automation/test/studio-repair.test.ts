import {describe,it,expect} from "vitest";
import {randomUUID} from "node:crypto";
import * as fs from "node:fs/promises";
import {DataStore,writeJsonAtomic} from "@ttm/storage";
import {Timeline} from "@ttm/core";
import {StudioStore,StudioRun,STUDIO_STAGES,hash} from "../src/studio.js";
import {getStudioRepairPlan,requestStudioRepair} from "../src/studio-repair.js";
import {tmpDir} from "../../storage/test/helpers.js";
async function fixture(){
 const store=new DataStore(await tmpDir("acs-repair-planner-"));await store.init();const studio=new StudioStore(store),now=new Date().toISOString();
 const a=await studio.saveAutopilot({id:randomUUID(),name:"Contract fixture",createdAt:now,updatedAt:now}),config=await studio.config(),id=randomUUID();
 const row=await studio.saveRun(StudioRun.parse({id,autopilotId:a.id,title:a.name,language:"en-US",snapshot:a,config,snapshotHash:hash({a,config}),state:"ready",stages:STUDIO_STAGES.map(id=>({id})),createdAt:now,updatedAt:now}));
 const timeline=Timeline.parse({schemaVersion:1,width:640,height:360,fps:30,duration:8,createdAt:now,clips:[{id:"caption",track:"caption",start:0,duration:8,text:"Keep every source word exactly while regrouping the caption into readable phrases with clear timing and visible evidence for review."}]});
 const qa={technical:true,publishEligibility:"BLOCKED",captionQuality:{readability:{findings:[{criterion:"caption.layout_overflow"}]}},findings:[{criterion:"audio_loudness",status:"unknown"}]};
 await writeJsonAtomic(store.p("studio","artifacts",id,"qa.json"),qa);await writeJsonAtomic(store.p("studio","artifacts",id,"timeline.json"),timeline);
 return{store,studio,row,timeline,qa};
}
describe("Studio stage repair planner",()=>{
 it("reflows captions without dropping words or touching dialogue and records estimated timing",async()=>{
  const {studio,row,timeline}=await fixture(),plan=await getStudioRepairPlan(studio,row.id);
  const child=await requestStudioRepair(studio,{id:row.id,kind:"captions",expectedPlanSha256:plan.sha256}),actual=(await studio.timeline(child.id))!;
  expect(actual.clips.filter(c=>c.track==="caption").length).toBeGreaterThan(1);expect(actual.clips.every(c=>c.start+c.duration<=timeline.duration)).toBe(true);expect(actual.clips.map(c=>c.text).join(" ")).toBe(timeline.clips[0].text);expect(actual.captionTiming).toBe("estimated");expect(await studio.timeline(row.id)).toEqual(timeline);expect(child.repair?.attempt).toBe(1);
 });
 it("rejects stale evidence and counts at most two attempts per repair kind across branches",async()=>{
  const {studio,store,row,qa}=await fixture(),plan=await getStudioRepairPlan(studio,row.id);
  await writeJsonAtomic(store.p("studio","artifacts",row.id,"qa.json"),{...qa,note:"Changed after preview"});
  await expect(requestStudioRepair(studio,{id:row.id,kind:"mix",expectedPlanSha256:plan.sha256})).rejects.toThrow("plan changed");
  const current=await getStudioRepairPlan(studio,row.id),first=await requestStudioRepair(studio,{id:row.id,kind:"mix",expectedPlanSha256:current.sha256});
  await studio.saveRun({...first,state:"failed"});await writeJsonAtomic(store.p("studio","artifacts",first.id,"qa.json"),qa);
  const secondPlan=await getStudioRepairPlan(studio,first.id),second=await requestStudioRepair(studio,{id:first.id,kind:"mix",expectedPlanSha256:secondPlan.sha256});expect(second.repair?.attempt).toBe(2);
  await studio.saveRun({...second,state:"failed"});await writeJsonAtomic(store.p("studio","artifacts",second.id,"qa.json"),qa);
  const exhausted=await getStudioRepairPlan(studio,second.id);expect(exhausted.operations.find(o=>o.kind==="mix")?.available).toBe(false);
  await expect(requestStudioRepair(studio,{id:second.id,kind:"mix",expectedPlanSha256:exhausted.sha256})).rejects.toThrow("retry budget exhausted");
 });
 it("offers no render retry as a substitute for missing rights, facts or human approval",async()=>{
  const {studio,store,row}=await fixture();await writeJsonAtomic(store.p("studio","artifacts",row.id,"qa.json"),{technical:true,facts:"UNKNOWN",rights:"UNKNOWN",humanReview:"REQUIRED",findings:[]});
  const plan=await getStudioRepairPlan(studio,row.id);expect(plan.operations).toEqual([]);expect(plan.willPublish).toBe(false);expect(plan.wordAlignment).toBe("UNVERIFIED");
 });
});
