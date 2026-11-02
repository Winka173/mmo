import { describe,it,expect } from "vitest";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DataStore, writeJsonAtomic } from "@ttm/storage";
import { Autopilot, StudioStore, localEndpoint, hash } from "../src/studio.js";
import { tmpDir } from "../../storage/test/helpers.js";
import { FileQueue } from "../src/queue.js";
const autopilot=(over:Record<string,unknown>={})=>Autopilot.parse({id:randomUUID(),name:"Owned project",brief:"Verified game footage",sourceFolder:"C:/owned",rights:"AUTHORIZED_REUSE",rightsEvidence:"Owner declaration",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),...over});
describe("Studio persistence, policy and scheduling",()=>{
 it("rejects remote AI endpoints and unverified auto-publication",async()=>{
  for(const endpoint of ["https://api.example.com/v1","http://example.com","http://127.0.0.1@example.com","file:///tmp/model"])expect(()=>localEndpoint(endpoint)).toThrow();
  expect(localEndpoint("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434/v1");
  const store=new DataStore(await tmpDir("acs-policy-"));await store.init();const studio=new StudioStore(store);
  await expect(studio.saveAutopilot(autopilot({enabled:true,mode:"AUTHORIZED_AUTO_PUBLISH",policyConsent:true}))).rejects.toThrow("not yet verified");
 });
 it("persists partial wizard drafts and schedules one job per language/slot across concurrent ticks",async()=>{
  const store=new DataStore(await tmpDir("acs-schedule-"));await store.init();const studio=new StudioStore(store);
  const draft=await studio.saveAutopilot(autopilot({name:"",brief:"",sourceFolder:"",step:3}));
  expect((await new StudioStore(store).autopilot(draft.id))?.step).toBe(3);
  const media=await tmpDir("acs-source-"); await fs.writeFile(path.join(media,"fixture.png"),"scheduler-test-not-real-media");
  const a=await studio.saveAutopilot(autopilot({sourceFolder:media,enabled:true,languages:["vi-VN","en-US"]}));
  const now=new Date();await Promise.all([studio.tick(now),new StudioStore(store).tick(now)]);
  const jobs=(await new FileQueue(store).list("queued")).filter(j=>j.kind==="STUDIO_RUN");expect(jobs).toHaveLength(2);
  expect((await studio.runs()).map(r=>r.language).sort()).toEqual(["en-US","vi-VN"]);
  expect((await studio.autopilot(a.id))?.nextRunAt).not.toBeNull();
 });
 it("pause leaves backlog untouched; explicit retry uses the original immutable snapshot",async()=>{
  const store=new DataStore(await tmpDir("acs-pause-"));await store.init();const studio=new StudioStore(store);const a=await studio.saveAutopilot(autopilot({enabled:true}));
  await store.updateSettings(s=>({...s,paused:true}),"test");expect(await studio.tick()).toEqual([]);expect(await studio.runs()).toHaveLength(0);
  const first=await studio.enqueue(a,"vi-VN","slot");await studio.saveConfig({llmModel:"changed"});const again=await studio.enqueue(a,"vi-VN","slot");expect(again.id).toBe(first.id);
  expect((await studio.run(first.id))?.config.llmModel).toBe("");
 });
 it("skips exhausted inputs across cadence and revisions; changing actual bytes creates new content",async()=>{
  const store=new DataStore(await tmpDir("acs-novelty-"));await store.init();const studio=new StudioStore(store);
  const media=await tmpDir("acs-novelty-source-");const file=path.join(media,"fixture.png");await fs.writeFile(file,"first");
  const a=await studio.saveAutopilot(autopilot({sourceFolder:media,enabled:true,languages:["en-US","en-US"]}));
  const now=new Date(); expect(await studio.tick(now)).toHaveLength(1);
  const current=(await studio.autopilot(a.id))!;await studio.saveAutopilot({...current,name:"Rename only"});
  expect(await studio.tick(new Date(now.getTime()+3*86400000))).toEqual([]);
  await fs.writeFile(file,"other"); // same byte count: timestamps/size alone cannot detect this correctly
  expect(await studio.tick(new Date(now.getTime()+6*86400000))).toHaveLength(1);
  expect(await studio.runs()).toHaveLength(2);
 });
 it("missing/empty source creates no filler and does not stop other pilots",async()=>{
  const store=new DataStore(await tmpDir("acs-empty-"));await store.init();const studio=new StudioStore(store);
  await studio.saveAutopilot(autopilot({enabled:true,sourceFolder:path.join(store.root,"missing")}));
  expect(await studio.tick()).toEqual([]);expect(await studio.runs()).toHaveLength(0);
 });
 it("rejects concurrent stale config saves without losing the winning edit",async()=>{
  const store=new DataStore(await tmpDir("acs-conflict-"));await store.init();const studio=new StudioStore(store);
  const a=await studio.saveAutopilot(autopilot());
  const results=await Promise.allSettled([studio.saveAutopilot({...a,name:"A"}),studio.saveAutopilot({...a,name:"B"})]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
  expect((await studio.autopilot(a.id))?.revision).toBe(a.revision+1);
 });
 it("normalizes authentic legacy snapshot defaults but never repairs a tampered snapshot hash",async()=>{
  const store=new DataStore(await tmpDir("acs-legacy-"));await store.init();const studio=new StudioStore(store);
  const a=await studio.saveAutopilot(autopilot());const {id}=await studio.enqueue(a,"en-US","legacy");
  const raw:any=await studio.run(id);delete raw.config.voiceEnGb;raw.snapshotHash=hash({a:raw.snapshot,config:raw.config});
  await writeJsonAtomic(store.p("studio","runs",`${id}.json`),raw);
  const normalized=(await studio.run(id))!;expect(normalized.config.voiceEnGb).toBe("bf_emma");expect(normalized.snapshotHash).toBe(hash({a:normalized.snapshot,config:normalized.config}));
  raw.snapshot.brief="tampered";await writeJsonAtomic(store.p("studio","runs",`${id}.json`),raw);
  const corrupt=(await studio.run(id))!;expect(corrupt.snapshotHash).not.toBe(hash({a:corrupt.snapshot,config:corrupt.config}));
 });
 it("sentence revision creates an independent child and preserves the original text and settings",async()=>{
  const store=new DataStore(await tmpDir("acs-sentence-"));await store.init();const studio=new StudioStore(store);
  const a=await studio.saveAutopilot(autopilot());const {id}=await studio.enqueue(a,"en-US","sentence");
  const parent=(await studio.run(id))!;parent.state="ready";parent.shots=[{text:"Original",asset:"owned.png",durationSec:4,sourceStart:0,sourceDuration:null},{text:"Untouched",asset:"owned.png",durationSec:6,sourceStart:0,sourceDuration:null}];await studio.saveRun(parent);
  const child=await studio.reviseNarration(id,0,"Revised");
  expect(child.parentId).toBe(id);expect(child.shots[0].text).toBe("Revised");expect(child.shots[1]).toEqual(parent.shots[1]);expect(child.snapshotHash).toBe(parent.snapshotHash);
  expect((await studio.run(id))?.shots[0].text).toBe("Original");expect(child.outputs).toEqual([]);
  await expect(studio.reviseNarration(id,99,"Invalid")).rejects.toThrow();
  await expect(studio.reviseNarration(id,0,"Original")).rejects.toThrow("unchanged");
 });
});
