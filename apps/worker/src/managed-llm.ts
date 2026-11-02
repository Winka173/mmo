import{spawn,spawnSync,type ChildProcess}from"node:child_process";
import{createServer}from"node:net";
import * as fs from"node:fs/promises";
import path from"node:path";
import{type StudioConfig,hash}from"@ttm/automation";
import{FactoryError}from"@ttm/core";
import{withLock,writeJsonAtomic}from"@ttm/storage";
import type{Ctx}from"./context.js";
let owned:{child:ChildProcess;key:string;url:string}|null=null;
let cleanupBound=false;
export function stopManagedLlm(){if(owned?.child.exitCode===null){if(process.platform==="win32"&&owned.child.pid)spawnSync("taskkill",["/PID",String(owned.child.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});else owned.child.kill();}owned=null;}
export async function ensureManagedLlm(ctx:Ctx,config:StudioConfig){
 if(!config.llmManaged)return config.llmUrl;
 const serverDevice=config.llmServerDevice??config.llmDevice,url=`http://127.0.0.1:${config.llmPort}`,key=hash([ctx.store.root,config.llmBinary,config.llmModelStore,config.llmPort,serverDevice,config.maxContext]);
 if(owned?.key===key&&owned.child.exitCode===null)return `${url}/v1`;
 return withLock(ctx.store.p("locks","llm-start.lock"),async()=>{
  if(owned?.key===key&&owned.child.exitCode===null)return `${url}/v1`;
  if(!config.llmBinary||!config.llmModelStore)throw new FactoryError("NEEDS_PROVIDER","HUMAN_REQUIRED","Configure the managed LLM executable and its own model store");
  await fs.access(config.llmBinary).catch(()=>{throw new FactoryError("NEEDS_PROVIDER","HUMAN_REQUIRED","NEEDS_PROVIDER: managed LLM executable is missing; install the runtime and its lib directory in the configured ACS folder");});await fs.mkdir(config.llmModelStore,{recursive:true});
  if(owned){stopManagedLlm();await new Promise(resolve=>setTimeout(resolve,800));}
  const socket=createServer();await new Promise<void>((resolve,reject)=>{socket.once("error",()=>reject(new FactoryError("LLM_PORT_BUSY","HUMAN_REQUIRED",`Port ${config.llmPort} is owned by another process; choose another port or connect as an external local runtime`)));socket.listen(config.llmPort,"127.0.0.1",()=>resolve());});await new Promise<void>(resolve=>socket.close(()=>resolve()));
  const log=await fs.open(ctx.store.p("state","managed-llm.log"),"a");
  const child=spawn(config.llmBinary,["serve"],{windowsHide:true,env:{...process.env,OLLAMA_HOST:`127.0.0.1:${config.llmPort}`,OLLAMA_MODELS:config.llmModelStore,OLLAMA_NO_CLOUD:"1",OLLAMA_NUM_PARALLEL:"1",OLLAMA_MAX_LOADED_MODELS:"1",OLLAMA_KEEP_ALIVE:"0",OLLAMA_CONTEXT_LENGTH:String(config.maxContext),CUDA_VISIBLE_DEVICES:serverDevice==="cpu"?"-1":"0",GGML_VK_VISIBLE_DEVICES:serverDevice==="cpu"?"-1":"0"},stdio:["ignore",log.fd,log.fd]});await log.close();
  owned={child,key,url};if(!cleanupBound){cleanupBound=true;process.once("exit",stopManagedLlm);}
  let startError:Error|null=null;child.once("error",error=>{startError=error;});
  for(let i=0;i<120;i++){
   if(startError){stopManagedLlm();throw startError;}if(child.exitCode!==null){stopManagedLlm();throw new Error("Managed LLM exited; inspect diagnostics log");}
   try{const response=await fetch(`${url}/api/version`,{redirect:"error",signal:AbortSignal.timeout(1000)});if(response.ok){await writeJsonAtomic(ctx.store.p("state","managed-llm.json"),{pid:child.pid,key,url,modelStore:config.llmModelStore,device:config.llmDevice,version:await response.json(),startedAt:new Date().toISOString()});return `${url}/v1`;}}catch{}
   await new Promise(resolve=>setTimeout(resolve,250));
  }stopManagedLlm();throw new Error("Managed LLM startup timed out");
 },{waitMs:60000,ttlMs:60000});
}
