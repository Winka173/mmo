import {describe,it,expect,vi} from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import sharp from "sharp";
import {StudioStore,GPU_ENGINE_KEY,reviseStudioPlan,previewStudioPlanLine,VoiceStore,getStudioRepairPlan,requestStudioRepair} from "@ttm/automation";
import {runProcess} from "@ttm/media";
import {buildContext} from "../src/context.js";
import {runJob} from "../src/handlers.js";
import {tmpDir} from "../../../packages/storage/test/helpers.js";
const fixture=vi.hoisted(()=>({calls:[] as string[],audio:Buffer.alloc(0)}));
vi.mock("../src/local-engine.js",()=>({invokeLocalEngine:async(_ctx:unknown,_config:unknown,request:any)=>{
 fixture.calls.push(request.op);
 if(request.op==="script")return{script:{shots:[{text:"An owned calibration image."}]},model:"MOCK_SCRIPT_NOT_INFERENCE"};
 if(request.op==="voice-environment")return{fingerprint:"MOCK_RUNTIME"};
 if(request.op==="tts"){await fs.writeFile(request.output,fixture.audio);return{engine:"MOCK_TONE_NOT_SPEECH"};}
 throw new Error(`Unexpected operation ${request.op}`);
}}));
async function setup(rights="AUTHORIZED_REUSE"){
 fixture.calls=[];
 const ctx=await buildContext({dataDir:await tmpDir("acs-guided-plan-")}),studio=new StudioStore(ctx.store),folder=ctx.store.p("owned");await fs.mkdir(folder,{recursive:true});
 await sharp({create:{width:640,height:360,channels:3,background:"#503773"}}).png().toFile(path.join(folder,"owned.png"));
 const root=process.cwd();await studio.saveConfig({llmDevice:"cpu",ffmpeg:root+"/.local/tools/ffmpeg.exe",ffprobe:root+"/.local/tools/ffprobe.exe"});
 const now=new Date().toISOString(),a=await studio.saveAutopilot({id:randomUUID(),family:"custom",name:"Owned plan contract fixture",brief:"This is an owned calibration image, not gameplay",sourceFolder:folder,rights,rightsEvidence:"Owned image; mock AI contract, no listening approval",createdAt:now,updatedAt:now});
 const queued=await studio.enqueue(a,"en-US","fixed-plan-slot",true);
 return{ctx,studio,a,id:queued.id,dir:ctx.store.p("studio","artifacts",queued.id)};
}
async function work(ctx:Awaited<ReturnType<typeof buildContext>>){const job=await ctx.queue.claim({kinds:["STUDIO_RUN"],maxConcurrent:1,gpuSlots:1});expect(job).toBeTruthy();await runJob(ctx,job!);return(await ctx.queue.get(job!.id))!;}
describe("Guided Create plan stop and continuation (mock AI, real disk and FFmpeg)",()=>{
 it("forks edited plans, pins audition config, and renders only the revised script without another script call",async()=>{
  const {ctx,studio,id,dir}=await setup();await work(ctx);const parent=(await studio.run(id))!,original=await fs.readFile(path.join(dir,"plan.json"));
  const revised=await reviseStudioPlan(studio,{id,expectedSha256:parent.planning!.sha256,shots:parent.shots.map(s=>({...s,text:"A revised owned calibration image."}))});
  expect(revised.id).not.toBe(id);expect(revised.planRevision?.parentId).toBe(id);expect(revised.planning?.state).toBe("ready");expect(await fs.readFile(path.join(dir,"plan.json"))).toEqual(original);expect(await ctx.queue.list("queued")).toHaveLength(0);
  await studio.saveConfig({...await studio.config(),voiceEn:"changed-after-plan"});
  const sample=await previewStudioPlanLine(studio,revised.id,0),again=await previewStudioPlanLine(studio,revised.id,0);
  expect(sample.id).toBe(again.id);expect(sample.config.voiceEn).toBe(parent.config.voiceEn);expect(sample.text).toBe(revised.shots[0].text);expect((await new VoiceStore(ctx.store).get(sample.id))?.humanReview).toBe("NOT_REVIEWED");
  const voiceJob=(await ctx.queue.list("queued"))[0];await ctx.queue.transition(voiceJob.id,"failed","Audition contract only; no synthetic speech claim");
  const wave=ctx.store.p("tone.wav");expect((await runProcess(process.cwd()+"/.local/tools/ffmpeg.exe",["-y","-f","lavfi","-i","sine=frequency=220:duration=1.8","-ar","24000","-ac","1",wave])).code).toBe(0);fixture.audio=await fs.readFile(wave);
  await studio.continuePlan(revised.id);expect((await work(ctx)).state).toBe("succeeded");expect((await studio.run(revised.id))?.state).toBe("ready");expect(fixture.calls.filter(c=>c==="script")).toHaveLength(1);expect((await studio.run(id))?.state).toBe("needs_input");
 },60000);
 it("rejects stale plan edits and unpinned media, and cannot turn an image into a timed video",async()=>{
  const {ctx,studio,id}=await setup();await work(ctx);const row=(await studio.run(id))!;
  await expect(reviseStudioPlan(studio,{id,expectedSha256:"0".repeat(64),shots:row.shots})).rejects.toThrow("Reload");
  await expect(reviseStudioPlan(studio,{id,expectedSha256:row.planning!.sha256,shots:row.shots.map(s=>({...s,asset:"C:/untrusted.mp4"}))})).rejects.toThrow("pinned source");
  await expect(reviseStudioPlan(studio,{id,expectedSha256:row.planning!.sha256,shots:row.shots.map(s=>({...s,sourceStart:5}))})).rejects.toThrow("Still images");
  expect(await ctx.queue.list("queued")).toHaveLength(0);
 });
 it("performs a QA-directed audio repair without new AI, retains parent bytes, deduplicates and blocks unsupported repairs",async()=>{
  const {ctx,studio,id}=await setup();await work(ctx);const wave=ctx.store.p("tone.wav");expect((await runProcess(process.cwd()+"/.local/tools/ffmpeg.exe",["-y","-f","lavfi","-i","sine=frequency=220:duration=1.8","-ar","24000","-ac","1",wave])).code).toBe(0);fixture.audio=await fs.readFile(wave);
  await studio.continuePlan(id);await work(ctx);const parent=(await studio.run(id))!,parentDir=ctx.store.p("studio","artifacts",id),original=await fs.readFile(path.join(parentDir,"final.mp4"));
  const qa=JSON.parse(await fs.readFile(path.join(parentDir,"qa.json"),"utf8"));qa.findings.push({criterion:"audio_loudness",status:"unknown",severity:"warning",evidence:"Controlled repair contract"});await fs.writeFile(path.join(parentDir,"qa.json"),JSON.stringify(qa));
  const plan=await getStudioRepairPlan(studio,id);expect(plan.operations.some(o=>o.kind==="mix"&&o.available)).toBe(true);
  const calls=fixture.calls.length,child=await requestStudioRepair(studio,{id,kind:"mix",expectedPlanSha256:plan.sha256});expect((await requestStudioRepair(studio,{id,kind:"mix",expectedPlanSha256:plan.sha256})).id).toBe(child.id);
  expect((await work(ctx)).state).toBe("succeeded");expect(fixture.calls).toHaveLength(calls);expect(await fs.readFile(path.join(parentDir,"final.mp4"))).toEqual(original);
  const done=(await studio.run(child.id))!;expect(done.repair).toMatchObject({rootId:parent.id,attempt:1,kind:"mix"});expect(done.outputs).toContain("repair-result.json");expect(done.stages.find(s=>s.id==="eligibility")?.state).toBe("blocked");
  const report=JSON.parse(await fs.readFile(ctx.store.p("studio","artifacts",child.id,"repair-execution.json"),"utf8"));expect(report).toMatchObject({aiRequests:0,videoStreamCopied:true});
  await expect(requestStudioRepair(studio,{id,kind:"encode",expectedPlanSha256:(await getStudioRepairPlan(studio,id)).sha256})).rejects.toThrow("No safe matching repair");
  const normal=await studio.editTimeline(child.id,[{kind:"set_gain",track:"dialogue",gain:.8}]);expect(normal.repair).toBeNull();
 },60000);
 it("finishes plan-only job without speech/render, restarts from pinned script and deduplicates continuation",async()=>{
  const {ctx,studio,a,id,dir}=await setup();const job=await work(ctx);expect(job.state).toBe("succeeded");
  expect(job.usesGpu).toBe(false);expect(job.payload.engineKeys).not.toContain(GPU_ENGINE_KEY);expect(fixture.calls).toEqual(["script"]);
  const plan=(await studio.run(id))!;expect(plan).toMatchObject({state:"needs_input",error:null,planning:{state:"ready"}});expect(plan.stages.find(s=>s.id==="voice")?.state).toBe("needs_input");
  expect(await fs.stat(path.join(dir,"final.mp4")).catch(()=>null)).toBeNull();expect(await fs.stat(path.join(dir,"qa.json")).catch(()=>null)).toBeNull();
  const pinned=await fs.readFile(path.join(dir,"plan.json")),llm=await fs.readFile(path.join(dir,"llm-evidence.json"));
  // Draft edits and current global config cannot rewrite the plan that is already selected.
  await studio.saveAutopilot({...a,scriptText:"Different future draft"});await studio.saveConfig({...await studio.config(),voiceEn:"another-voice"});
  const restarted=new StudioStore(ctx.store),requests=await Promise.all([restarted.continuePlan(id),restarted.continuePlan(id)]);expect(requests[0]).toEqual(requests[1]);
  const wave=ctx.store.p("tone.wav");expect((await runProcess(process.cwd()+"/.local/tools/ffmpeg.exe",["-y","-f","lavfi","-i","sine=frequency=220:duration=1.8","-ar","24000","-ac","1",wave])).code).toBe(0);fixture.audio=await fs.readFile(wave);
  expect((await work(ctx)).state).toBe("succeeded");const done=(await studio.run(id))!;
  expect(done.state).toBe("ready");expect(done.config.voiceEn).toBe("af_heart");expect(done.outputs).toContain("plan.json");expect(fixture.calls.filter(op=>op==="script")).toHaveLength(1);
  expect(await fs.readFile(path.join(dir,"plan.json"))).toEqual(pinned);expect(await fs.readFile(path.join(dir,"llm-evidence.json"))).toEqual(llm);
  expect(await restarted.continuePlan(id)).toEqual(requests[0]);
  const child=await studio.reviseNarration(id,0,"A revised calibration line.");expect(child.planning).toBeNull();expect(child.parentId).toBe(id);expect((await studio.run(id))?.shots[0].text).toBe(plan.shots[0].text);
 },60000);
 it("refuses tampered plan bytes and changed shot text without enqueueing a continuation",async()=>{
  const {ctx,studio,id,dir}=await setup();await work(ctx);const file=path.join(dir,"plan.json"),original=await fs.readFile(file);
  await fs.appendFile(file," ");await expect(studio.continuePlan(id)).rejects.toThrow("artifact changed");await fs.writeFile(file,original);
  const row=(await studio.run(id))!;row.shots[0].text="Tampered text";await studio.saveRun(row);await expect(studio.continuePlan(id)).rejects.toThrow("no longer matches");expect(await ctx.queue.list("queued")).toHaveLength(0);
 });
 it("blocks missing rights before model invocation and does not imply adaptation-plan support",async()=>{
  const {ctx,studio,a,id}=await setup("PERMISSION_PENDING");expect((await work(ctx)).state).toBe("manual_action");expect(fixture.calls).toHaveLength(0);expect((await studio.run(id))?.planning?.state).toBe("requested");
  await expect(studio.enqueue({...a,family:"localization"},"en-US",randomUUID(),true)).rejects.toThrow("not available");
 });
 it("cancelling a saved plan prevents continuation and preserves its artifact",async()=>{
  const {ctx,studio,id,dir}=await setup();await work(ctx);const pinned=await fs.readFile(path.join(dir,"plan.json"));
  const control=ctx.store.p("studio","controls");await fs.mkdir(control,{recursive:true});await fs.writeFile(path.join(control,`${id}.json`),JSON.stringify({cancelled:true}));
  await expect(studio.continuePlan(id)).rejects.toThrow("Cancelled");expect(await fs.readFile(path.join(dir,"plan.json"))).toEqual(pinned);expect(await ctx.queue.list("queued")).toHaveLength(0);
 });
 it("rechecks pinned media bytes before narration when continuing a saved plan",async()=>{
  const {ctx,studio,id}=await setup();await work(ctx);const row=(await studio.run(id))!;
  await studio.continuePlan(id);await fs.appendFile(row.sources[0].file,"changed after plan");
  expect((await work(ctx)).state).toBe("needs_review");expect((await studio.run(id))?.error).toContain("Source hash mismatch");expect(fixture.calls).toEqual(["script"]);
 });
});
