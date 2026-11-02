import path from "node:path";
import * as fs from "node:fs/promises";
import os from "node:os";
import { EngineHealthStore, engineKey, GPU_ENGINE_KEY, environmentLock,modelStoreLock,resolveLlmProfile,ramAdmission,type StudioConfig } from "@ttm/automation";
import { FactoryError } from "@ttm/core";
import { writeJsonAtomic,withLock } from "@ttm/storage";
import { runProcess,checkVramBeforeGpu } from "@ttm/media";
import type { Ctx } from "./context.js";
import{ensureManagedLlm}from"./managed-llm.js";

export async function invokeLocalEngine(ctx:Ctx,baseConfig:StudioConfig,operation:Record<string,unknown>,requestFile:string){
  const settings=await ctx.settings();if(settings.paused||settings.killSwitch)throw new FactoryError("STUDIO_PAUSED","RETRYABLE","Paused at a safe boundary / Tạm dừng tại ranh giới an toàn",{retryAfter:new Date(Date.now()+30000).toISOString()});
  // Text tasks pick the fast or the quality model; everything below sees only the effective config (own digest, device and engine key).
  const choice=String(operation.op)==="script"?resolveLlmProfile(baseConfig,operation.task):null;
  let config:StudioConfig=(choice?.config??baseConfig) as StudioConfig;
  if(choice&&choice.minFreeRamGb>0){const grace=Number((config as any).llmQualityRamGraceMs??0),until=Date.now()+grace;let admission=ramAdmission(os.freemem()/2**30,choice.minFreeRamGb);while(!admission.ok&&Date.now()<until){await new Promise(resolve=>setTimeout(resolve,2000));admission=ramAdmission(os.freemem()/2**30,choice.minFreeRamGb);}if(!admission.ok)throw new FactoryError("RAM_BUSY","RETRYABLE",admission.reason,{retryAfter:new Date(Date.now()+60000).toISOString(),provider:`${choice.profile}:${choice.model}`});}
  // Gaming guard: another program (a game) may hold the GPU. Wait with nothing loaded instead of risking out-of-memory for either side.
  const vram=await checkVramBeforeGpu(String(operation.op),config as unknown as Record<string,any>);
  if(!vram.ok)throw new FactoryError("GPU_BUSY","RETRYABLE",vram.reason,{retryAfter:new Date(Date.now()+(vram.retryAfterMs??60000)).toISOString()});
  if(vram.downgradeToCpu){const op0=String(operation.op);config={...config,...(op0.startsWith("asr")?{asrDevice:"cpu"}:{}),...(op0==="tts"||op0==="narrate"?{ttsDevice:"cpu"}:{})} as StudioConfig;}
  const op=String(operation.op),language=String(operation.language??""),key=engineKey(config,op,language),health=new EngineHealthStore(ctx.store);
  const python=op==="embed"?config.pythonEmbedding:op.startsWith("image")?config.pythonImage:op==="vad"?config.pythonVad||config.pythonAsr||config.python:op.startsWith("asr")?config.pythonAsr||config.python:language.startsWith("vi")?config.pythonVi||config.python:config.python;
  const heavy=!op.endsWith("-environment");
  if(heavy)await health.begin(key,`${op} ${language}`);
  await writeJsonAtomic(requestFile,{...operation,config},{keepBackup:false});
  try{
    if(op==="script"&&config.llmManaged){const url=await ensureManagedLlm(ctx,config);if(url!==config.llmUrl)throw new FactoryError("QUALITY_LOCK","HUMAN_REQUIRED","Managed LLM endpoint differs from the frozen config; create a fresh run");}
    if(op.startsWith("image")&&!python)throw new Error("NEEDS_PROVIDER: configure the isolated image Python environment");
    if(op==="embed"&&!python)throw new Error("NEEDS_PROVIDER: configure a compatible isolated embedding Python runtime");
    const runner=process.env.ACS_ENGINE_RUNNER??path.resolve("engines/runner.py"),script=op==="embed"?path.join(path.dirname(runner),"embedding_engine.py"):op.startsWith("image")?path.join(path.dirname(runner),"image_engine.py"):runner;
    const execute=async()=>{const latest=await ctx.settings();if(latest.paused||latest.killSwitch)throw new FactoryError("STUDIO_PAUSED","RETRYABLE","Paused while waiting for engine/model access",{retryAfter:new Date(Date.now()+30000).toISOString()});return runProcess(python,[script,requestFile],{timeoutMs:900000,env:{PYTHONDONTWRITEBYTECODE:"1"}});};
    const result=await withLock(environmentLock(python),()=>op==="script"&&config.llmManaged?withLock(modelStoreLock(config.llmModelStore),execute,{waitMs:7200000,ttlMs:60000,purpose:"Pin model store throughout inference"}):op==="embed"?withLock(modelStoreLock(config.embeddingModel),execute,{waitMs:7200000,ttlMs:60000,purpose:"Pin embedding checkpoint throughout inference"}):op.startsWith("image")?withLock(modelStoreLock(config.imageModel),execute,{waitMs:7200000,ttlMs:60000,purpose:"Pin image checkpoint throughout inference"}):op==="vad"?withLock(modelStoreLock(path.dirname(config.vadModel)),execute,{waitMs:7200000,ttlMs:60000,purpose:"Pin VAD checkpoint throughout inference"}):execute(),{waitMs:7200000,ttlMs:60000,purpose:"ACS inference: prevent concurrent environment installation"});
    await fs.writeFile(`${requestFile}.log`,result.stderr,"utf8");
    let data:any;try{data=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)??"{}");}catch{throw new Error(result.stderr.slice(-1800)||"Engine did not return JSON");}
    if(result.code!==0||data.error)throw new Error(data.error||result.stderr.slice(-1800)||`Engine exited ${result.code}`);
    if(choice)data.llmProfile={profile:choice.profile,task:choice.task,reviewRequired:choice.reviewRequired,reason:choice.reason};
    if(heavy)await health.success(key,`${op} ${language}`);
    if(data.device==="cuda")await health.success(GPU_ENGINE_KEY,"Shared GPU");
    return data;
  }catch(error:any){
    if(error.code==="STUDIO_PAUSED"){if(heavy)await health.defer(key);throw error;}
    const message=String(error.code==="ENOENT"?`BINARY_MISSING: ${error.message}`:error.message??error);
    if(/GPU_BUSY/.test(message)){if(heavy)await health.defer(key);await health.failure(GPU_ENGINE_KEY,"Shared GPU",message);throw new FactoryError("GPU_BUSY","RETRYABLE",message,{retryAfter:new Date(Date.now()+60000).toISOString(),provider:key});}
    const record=heavy?await health.failure(key,`${op} ${language}`,message):null;
    if(record?.state==="open")throw new FactoryError("ENGINE_COOLDOWN","RETRYABLE",message,{retryAfter:record.retryAt,provider:key});
    if(/NEEDS_PROVIDER|No module named|BINARY_MISSING/.test(message))throw new FactoryError("NEEDS_PROVIDER","HUMAN_REQUIRED",message,{provider:key});
    if(/out of memory|CUDA_ERROR_OUT_OF_MEMORY|CUBLAS_STATUS_ALLOC_FAILED/i.test(message))throw new FactoryError("GPU_OOM","RETRYABLE",message,{provider:key,retryAfter:new Date(Date.now()+60000).toISOString()});
    throw error;
  }
}
