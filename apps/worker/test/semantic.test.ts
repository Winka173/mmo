import {describe,it,expect,vi,beforeEach} from "vitest";
import * as fs from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {DataStore} from "@ttm/storage";
import {StudioStore,SemanticStore,semanticChunks,embeddingTextHash,hash} from "@ttm/automation";
import {FactoryError} from "@ttm/core";
import {tmpDir} from "../../../packages/storage/test/helpers.js";
import {buildContext} from "../src/context.js";
vi.mock("../src/local-engine.js",()=>({invokeLocalEngine:vi.fn()}));
import {invokeLocalEngine} from "../src/local-engine.js";
import {executeSemantic} from "../src/semantic.js";

const vector=(axis:number)=>Array.from({length:1024},(_,i)=>i===axis?1:0);
async function fixture(){
 const ctx=await buildContext({dataDir:await tmpDir("acs-semantic-test-")}),studio=new StudioStore(ctx.store),now=new Date().toISOString();
 await studio.saveConfig({pythonEmbedding:"fixture-python",embeddingModel:"fixture-model",embeddingDevice:"cpu"});
 const a=await studio.saveAutopilot({id:randomUUID(),name:"Original fixture",createdAt:now,updatedAt:now});
 const one=await studio.enqueue(a,"en-US",randomUUID());await studio.saveRun({...((await studio.run(one.id))!),state:"ready",title:"Library",shots:[{text:"A local library lends books.",asset:"",durationSec:5,sourceStart:0,sourceDuration:null}]});
 const two=await studio.enqueue(a,"en-US",randomUUID());await studio.saveRun({...((await studio.run(two.id))!),state:"ready",title:"Bicycle",shots:[{text:"Bicycle brakes need maintenance.",asset:"",durationSec:5,sourceStart:0,sourceDuration:null}]});
 return {ctx,studio,registry:new SemanticStore(ctx.store),a,one,two};
}
beforeEach(()=>{vi.mocked(invokeLocalEngine).mockReset().mockImplementation(async(_ctx,_config,op:any)=>({fingerprint:"a".repeat(64),device:"cpu",documents:op.texts.map((text:any)=>({id:text.id,textSha256:embeddingTextHash(text.text),vector:vector(/library|books/i.test(text.text)?0:1)}))}));});
describe("Derived local script search (synthetic vectors, file-backed source of truth)",()=>{
 it("caps a large library by complete productions and exposes coverage without silently truncating an indexed script",async()=>{
  const {studio,registry,one}=await fixture(),template=(await studio.run(one.id))!;
  const texts=Array.from({length:12},(_,i)=>`Part ${i} ${Array(145).fill("illustration").join(" ")}`);
  for(let i=0;i<100;i++)await studio.saveRun({...template,id:randomUUID(),createdAt:new Date(Date.now()+1000+i).toISOString(),shots:texts.map(text=>({text:text.slice(0,1500),asset:"",durationSec:5,sourceStart:0,sourceDuration:null}))});
  const corpus=await registry.corpus(),ids=new Set(corpus.documents.map(doc=>doc.runId));expect(corpus.coverage.eligibleRoots).toBe(102);expect(corpus.documents.length).toBeLessThanOrEqual(600);expect(ids.size).toBe(corpus.coverage.indexedRoots);expect(ids.size).toBeLessThan(100);
  for(const id of ids){const run=(await studio.run(id))!,expected=`${run.title} ${run.shots.map(shot=>shot.text).join(" ")}`.trim().replace(/\s+/g," ");expect(corpus.documents.filter(doc=>doc.runId===id).map(doc=>doc.text).join(" ")).toBe(expected);}
 });
 it("indexes root ready scripts, ranks one result per version, keeps reviews/config/source bytes untouched and detects new content",async()=>{
  const {ctx,studio,registry,one,a}=await fixture(),before=await fs.readFile(ctx.store.p("studio","runs",`${one.id}.json`),"utf8"),configHash=hash(await studio.config());
  const task=await registry.enqueue({kind:"index"});expect(await registry.enqueue({kind:"index"})).toMatchObject({id:task.id});await executeSemantic(ctx,task.id);
  expect((await registry.summary())?.stale).toBe(false);expect((await registry.index())?.documents).toHaveLength(2);
  const search=await registry.enqueue({kind:"search",query:"library books"});await executeSemantic(ctx,search.id);
  expect((await registry.get(search.id))?.result?.matches).toMatchObject([{title:"Library",score:1},{title:"Bicycle",score:0}]);
  expect((await registry.get(search.id))?.result?.meaningRightsOriginalityCertified).toBe(false);
  expect(await fs.readFile(ctx.store.p("studio","runs",`${one.id}.json`),"utf8")).toBe(before);expect(hash(await studio.config())).toBe(configHash);
  const source=(await studio.run(one.id))!,child=await studio.enqueue(a,"en-US",randomUUID());await studio.saveRun({...((await studio.run(child.id))!),parentId:one.id,state:"ready",shots:source.shots});expect((await registry.summary())?.stale).toBe(false);expect((await registry.corpus()).coverage.excludedDerivedVersions).toBe(1);
  const fresh=await studio.enqueue(a,"vi-VN",randomUUID());await studio.saveRun({...((await studio.run(fresh.id))!),state:"ready",shots:source.shots});expect((await registry.summary())?.stale).toBe(true);
  const stale=await registry.enqueue({kind:"search",query:"books"}),calls=vi.mocked(invokeLocalEngine).mock.calls.length;await expect(executeSemantic(ctx,stale.id)).rejects.toThrow("stale");expect(vi.mocked(invokeLocalEngine)).toHaveBeenCalledTimes(calls);
 });
 it("holds changed runtime or malformed vectors without replacing a valid index",async()=>{
  const {ctx,registry,studio,a}=await fixture(),indexTask=await registry.enqueue({kind:"index"});await executeSemantic(ctx,indexTask.id);
  const file=ctx.store.p("studio","semantic","index.json"),bytes=await fs.readFile(file,"utf8");
  vi.mocked(invokeLocalEngine).mockResolvedValueOnce({fingerprint:"b".repeat(64),documents:[{id:"query",vector:vector(0)}]});
  const search=await registry.enqueue({kind:"search",query:"books"});await expect(executeSemantic(ctx,search.id)).rejects.toThrow("identity changed");expect((await registry.get(search.id))?.state).toBe("failed");
  vi.mocked(invokeLocalEngine).mockImplementationOnce(async(_ctx,_config,op:any)=>({fingerprint:"a".repeat(64),documents:op.texts.map((text:any)=>({id:text.id,textSha256:embeddingTextHash(text.text),vector:Array(1024).fill(0)}))}));
  const added=await studio.enqueue(a,"en-US",randomUUID());await studio.saveRun({...((await studio.run(added.id))!),state:"ready",title:"New",shots:[{text:"A new script needs a vector.",asset:"",durationSec:5,sourceStart:0,sourceDuration:null}]});
  const invalid=await registry.enqueue({kind:"index"});await expect(executeSemantic(ctx,invalid.id)).rejects.toThrow("L2");expect(await fs.readFile(file,"utf8")).toBe(bytes);
 });
 it("keeps GPU contention queued and resumes a task without fabricating results",async()=>{
  const {ctx,registry}=await fixture(),task=await registry.enqueue({kind:"index"});
  vi.mocked(invokeLocalEngine).mockRejectedValueOnce(new FactoryError("GPU_BUSY","RETRYABLE","Another app holds the GPU lease"));await expect(executeSemantic(ctx,task.id)).rejects.toMatchObject({code:"GPU_BUSY"});expect((await registry.get(task.id))?.state).toBe("queued");expect(await registry.index()).toBe(null);
  await executeSemantic(ctx,task.id);expect((await registry.get(task.id))?.state).toBe("ready");
 });
 it("requires a configured local model and losslessly chunks text, rejecting unsafe or empty requests",async()=>{
  const store=new DataStore(await tmpDir("acs-no-semantic-"));await store.init();const registry=new SemanticStore(store);
  await expect(registry.enqueue({kind:"index"})).rejects.toThrow("Install/apply");await expect(registry.enqueue({kind:"search",query:""})).rejects.toThrow("query");await expect(registry.enqueue({kind:"search",query:"text",cloudUrl:"https://example.com"})).rejects.toThrow();
  const text=Array(1800).fill("Tiếng Việt có dấu English").join(" "),chunks=semanticChunks(text);expect(chunks.length).toBeGreaterThan(1);expect(chunks.every(chunk=>chunk.length<=3000)).toBe(true);expect(chunks.join(" ")).toBe(text);expect(()=>semanticChunks("a".repeat(3001))).toThrow();
 });
 it("refreshes incrementally: only new scripts are embedded, unchanged vectors are reused, and a stale index queues itself once",async()=>{
  const {ctx,studio,registry,a}=await fixture();const first=await registry.enqueue({kind:"index"});await executeSemantic(ctx,first.id);
  const embeddedTexts=()=>vi.mocked(invokeLocalEngine).mock.calls.flatMap(c=>(c[2] as any).texts.map((t:any)=>t.text));
  expect(embeddedTexts()).toHaveLength(2);
  expect(await registry.refreshIfStale()).toBeNull();
  const fresh=await studio.enqueue(a,"en-US",randomUUID());await studio.saveRun({...((await studio.run(fresh.id))!),state:"ready",title:"Garden",shots:[{text:"Tomatoes need sun.",asset:"",durationSec:5,sourceStart:0,sourceDuration:null}]});
  const auto=await registry.refreshIfStale();expect(auto?.kind).toBe("index");expect(await registry.refreshIfStale()).toBeNull();
  await executeSemantic(ctx,auto!.id);
  expect(embeddedTexts()).toHaveLength(3);expect(embeddedTexts()[2]).toContain("Tomatoes need sun.");
  expect((await registry.get(auto!.id))?.result).toMatchObject({documents:3,incremental:{reused:2,embedded:1}});
  expect((await registry.summary())?.stale).toBe(false);
  const again=await registry.enqueue({kind:"index"});await executeSemantic(ctx,again.id);expect(embeddedTexts()).toHaveLength(3);
  expect((await registry.get(again.id))?.result).toMatchObject({incremental:{reused:3,embedded:0}});
 });
});
