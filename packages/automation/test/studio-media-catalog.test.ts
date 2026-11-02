import {describe,it,expect} from "vitest";
import * as fs from "node:fs/promises";
import {randomUUID,createHash} from "node:crypto";
import path from "node:path";
import {DataStore} from "@ttm/storage";
import {Autopilot,StudioConfig,StudioRun,StudioStore,StudioMediaCatalog,FileQueue,hash} from "../src/index.js";
import {tmpDir} from "../../storage/test/helpers.js";

async function fixture(){
 const root=await tmpDir("acs-catalog-"),store=new DataStore(root);await store.init();const studio=new StudioStore(store),runId=randomUUID(),folder=store.p("studio","artifacts",runId);await fs.mkdir(folder,{recursive:true});const file=path.join(folder,"source-0.png"),bytes=Buffer.from("Owned catalog protocol fixture, not a real image");await fs.writeFile(file,bytes);
 const now=new Date().toISOString(),snapshot=Autopilot.parse({id:randomUUID(),name:"Owned fixture",createdAt:now,updatedAt:now}),config=StudioConfig.parse({}),sha256=createHash("sha256").update(bytes).digest("hex"),run=StudioRun.parse({id:runId,autopilotId:snapshot.id,snapshot,config,snapshotHash:hash({a:snapshot,config}),stages:[],title:"Catalog test",language:"en-US",sources:[{file,sha256,size:bytes.length}],createdAt:now,updatedAt:now});await studio.saveRun(run);return{root,store,studio,run,file,sha256,catalog:new StudioMediaCatalog(store)};
}
describe("SHA catalog revisions and explicit owner acceptance",()=>{
 it("keeps immutable revisions, checks stale writes and exports a pinned manifest without changing source bytes",async()=>{
  const f=await fixture(),before=await fs.readFile(f.file),first=await f.catalog.save({runId:f.run.id,sha256:f.sha256,expectedRevision:0,displayName:"Boss.png",description:"A red dragon in the stone arena"}),oldBytes=await fs.readFile(f.catalog.recordFile(f.sha256,1));expect(first.revision).toBe(1);
  await expect(f.catalog.save({runId:f.run.id,sha256:f.sha256,expectedRevision:0,displayName:"Farm.png",description:"Stale edit"})).rejects.toThrow("changed");
  const next=await f.catalog.save({runId:f.run.id,sha256:f.sha256,expectedRevision:1,displayName:"Boss closeup",description:"Dragon closeup"});expect(next.revision).toBe(2);expect(await fs.readFile(f.catalog.recordFile(f.sha256,1))).toEqual(oldBytes);expect(await fs.readFile(f.file)).toEqual(before);
  const manifest=await f.catalog.manifest(f.run.id);expect(manifest.assets[0]).toEqual({file:"source-0.png",sha256:f.sha256,description:"Dragon closeup",segments:[]});expect((await f.studio.run(f.run.id))?.sources).toEqual(f.run.sources);
 });
 it("rejects tampering, source changes, foreign sources and timed still-image scenes",async()=>{
  const f=await fixture(),input={runId:f.run.id,sha256:f.sha256,expectedRevision:0,displayName:"Owned",description:"Owned scene"};
  await expect(f.catalog.save({...input,sha256:"a".repeat(64)})).rejects.toThrow("not pinned");await expect(f.catalog.save({...input,segments:[{startSec:0,endSec:1,description:"Invalid image interval"}]})).rejects.toThrow("Still images");
  await f.catalog.save(input);const saved=JSON.parse(await fs.readFile(f.catalog.recordFile(f.sha256,1),"utf8"));saved.description="tampered";await fs.writeFile(f.catalog.recordFile(f.sha256,1),JSON.stringify(saved));await expect(f.catalog.get(f.sha256)).rejects.toThrow("integrity");
  await fs.appendFile(f.file,"changed");await expect(f.catalog.source(f.run.id,f.sha256)).rejects.toThrow("integrity");
 });
 it("rejects a source outside the artifact library even when its path/hash were written into a run",async()=>{
  const f=await fixture(),outside=path.join(f.root,"external.png");await fs.copyFile(f.file,outside);await f.studio.saveRun({...f.run,sources:[{...f.run.sources[0],file:outside}]});await expect(f.catalog.source(f.run.id,f.sha256)).rejects.toThrow("outside");
 });
 it("requires the actual local image-capable provider, deduplicates pending vision jobs and does not accept unreviewed model text",async()=>{
  const f=await fixture();await expect(f.catalog.enqueueVision({runId:f.run.id,sha256:f.sha256})).rejects.toThrow("managed local Qwen");await f.studio.saveConfig({...await f.studio.config(),llmManaged:true,llmModel:"qwen3.5:9b",python:"owned-test-python"});
  const task=await f.catalog.enqueueVision({runId:f.run.id,sha256:f.sha256}),again=await f.catalog.enqueueVision({runId:f.run.id,sha256:f.sha256});expect(task.id).toBe(again.id);expect((await new FileQueue(f.store).list("queued")).filter(row=>row.kind==="STUDIO_MEDIA_VISION")).toHaveLength(1);expect(await f.catalog.get(f.sha256)).toBe(null);
  await expect(f.catalog.save({runId:f.run.id,sha256:f.sha256,expectedRevision:0,displayName:"Owned",description:"Not reviewed",reviewedSuggestionId:task.id})).rejects.toThrow("completed suggestion");
  await expect(f.catalog.enqueueVision({runId:f.run.id,sha256:f.sha256,positions:[2]})).rejects.toThrow("Still images");
 });
});
