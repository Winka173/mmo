import { describe,it,expect } from "vitest";
import { DataStore,writeJsonAtomic } from "@ttm/storage";
import { FactoryError } from "@ttm/core";
import { tmpDir } from "../../storage/test/helpers.js";
import { EngineHealthStore,engineKey,GPU_ENGINE_KEY } from "../src/engine-health.js";
import { FileQueue } from "../src/queue.js";
describe("Engine circuit and waiting queue",()=>{
 it("releases a half-open probe on resource wait without counting success or trapping resume for twenty minutes",async()=>{const store=new DataStore(await tmpDir("acs-deferred-probe-"));await store.init();let now=new Date();const health=new EngineHealthStore(store,()=>now),key=engineKey({imageModel:"fixture"},"image");await health.failure(key,"Image","CUDA out of memory");await health.failure(key,"Image","CUDA out of memory");now=new Date(now.getTime()+3600000);await health.begin(key,"Image");expect((await health.get(key))?.state).toBe("half_open");await health.defer(key);expect(await health.get(key)).toMatchObject({state:"open",failures:2,probe:null,lastSuccess:null});await health.begin(key,"Image");await health.success(key,"Image");expect((await health.get(key))?.failures).toBe(0);});
 it("repeated OOM blocks that engine's backlog while unrelated work can continue",async()=>{
  const store=new DataStore(await tmpDir("acs-circuit-"));await store.init();const health=new EngineHealthStore(store);const key=engineKey({ttsEnModel:"bad",python:"python"},"tts","en-US");const queue=new FileQueue(store);
  await health.failure(key,"TTS","CUDA out of memory");expect((await health.get(key))?.state).toBe("closed");
  await health.failure(key,"TTS","CUDA out of memory");expect((await health.get(key))?.state).toBe("open");
  for(let i=0;i<20;i++)await queue.enqueue({kind:"STUDIO_RUN",idempotencyKey:`blocked:${i}`,payload:{engineKeys:[key]}});
  const other=await queue.enqueue({kind:"BACKUP",idempotencyKey:"unrelated:cpu",payload:{}});
  expect((await queue.claim({maxConcurrent:1,gpuSlots:1}))?.id).toBe(other.job.id);
  expect((await queue.list("queued")).every(j=>j.attempts===0)).toBe(true);expect(await queue.list("failed")).toHaveLength(0);
 });
 it("GPU contention never exhausts retry budget or blocks unrelated CPU work",async()=>{
  const store=new DataStore(await tmpDir("acs-resource-wait-"));await store.init();let now=new Date();const queue=new FileQueue(store,{now:()=>now});const health=new EngineHealthStore(store,()=>now);
  const first=await queue.enqueue({kind:"STUDIO_RUN",idempotencyKey:"gpu:fixture",payload:{},usesGpu:true,maxAttempts:1});
  for(let i=0;i<8;i++){expect((await queue.claim({maxConcurrent:1,gpuSlots:1}))?.id).toBe(first.job.id);await queue.fail(first.job.id,new FactoryError("GPU_BUSY","RETRYABLE","GPU_BUSY",{retryAfter:new Date(now.getTime()+1000).toISOString()}),"voice");now=new Date(now.getTime()+2000);}
  expect((await queue.get(first.job.id))?.attempts).toBe(0);
  await health.failure(GPU_ENGINE_KEY,"GPU","GPU_BUSY");await queue.enqueue({kind:"BACKUP",idempotencyKey:"backup:available",payload:{}});
  expect((await queue.claim({maxConcurrent:1,gpuSlots:1}))?.kind).toBe("BACKUP");
 });
 it("cooldown allows one probe after expiry, and explicit reset clears the breaker",async()=>{
  const store=new DataStore(await tmpDir("acs-half-open-"));await store.init();let now=new Date();const health=new EngineHealthStore(store,()=>now);const key=engineKey({asrModel:"missing"},"asr");
  await health.failure(key,"ASR","NEEDS_PROVIDER: missing checkpoint");await expect(health.begin(key,"ASR")).rejects.toMatchObject({code:"ENGINE_COOLDOWN"});
  now=new Date(now.getTime()+3600000);const probes=await Promise.allSettled([health.begin(key,"ASR"),health.begin(key,"ASR")]);expect(probes.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  await health.success(key,"ASR");expect((await health.get(key))?.state).toBe("closed");
  await health.failure(key,"ASR","NEEDS_PROVIDER");await health.reset(key,"test");expect((await health.get(key))?.failures).toBe(0);
 });
});
