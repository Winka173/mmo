import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import { z } from "zod";
import { DataStore, readJson, withLock, writeJsonAtomic } from "@ttm/storage";
import { FactoryError } from "@ttm/core";

const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export const GPU_ENGINE_KEY = digest("shared-gpu-resource");
export function engineKey(c: Record<string, any>, operation: string, language = "") {
  if(operation==="embed")return digest([operation,c.pythonEmbedding,c.embeddingModel,c.embeddingDevice]);
  if(operation.startsWith("image"))return digest(["image",c.pythonImage,c.imageModel,c.imageDevice]);
  if(operation==="vad")return digest([operation,c.pythonVad||c.pythonAsr,c.vadModel,c.vadSha256,"cpu"]);
  return digest(operation === "script" ? [operation,c.llmUrl,c.llmModel,c.llmModelDigest,c.llmDevice] : operation === "asr" ? [operation,c.pythonAsr,c.asrModel,c.asrDevice] : ["tts",language.startsWith("vi") ? c.pythonVi || c.python : c.python,language.startsWith("vi") ? c.ttsViModel : c.ttsEnModel,c.ttsDevice]);
}
export function studioEngineKeys(c: Record<string, any>, language: string, scriptProvided: boolean,family?:string) {
  if(family==="shorts")return [...(c.asrDevice!=="cpu"||c.llmDevice!=="cpu"?[GPU_ENGINE_KEY]:[]),engineKey(c,"asr"),engineKey(c,"script")];
  const gpu=!scriptProvided||c.ttsDevice!=="cpu"||!!c.asrModel&&c.asrDevice!=="cpu";
  return [...new Set([...(gpu?[GPU_ENGINE_KEY]:[]),engineKey(c,"tts",language),...(!scriptProvided?[engineKey(c,"script")]:[]),...(c.asrModel?[engineKey(c,"asr")]:[]),...(c.vadModel?[engineKey(c,"vad")]:[])])];
}
export const EngineHealth = z.object({
  key:z.string().regex(/^[a-f0-9]{64}$/),label:z.string(),state:z.enum(["closed","open","half_open"]),failures:z.number().int().nonnegative(),
  lastError:z.string().nullable(),retryAt:z.string().nullable(),lastSuccess:z.string().nullable(),updatedAt:z.string(),
  probe:z.object({pid:z.number(),host:z.string(),until:z.string()}).nullable(),
});
export type EngineHealth=z.infer<typeof EngineHealth>;
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(e:any){return e.code==="EPERM";}};
export class EngineHealthStore {
  constructor(readonly store:DataStore,readonly now:()=>Date=()=>new Date()){}
  private file(key:string){z.string().regex(/^[a-f0-9]{64}$/).parse(key);return this.store.p("state","engines",`${key}.json`);}
  get(key:string){return readJson(this.file(key),EngineHealth);}
  async list(){const files=await fs.readdir(this.store.p("state","engines")).catch(()=>[] as string[]);return (await Promise.all(files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>this.get(f.slice(0,-5))))).filter((x):x is EngineHealth=>!!x);}
  private async change<T>(key:string,fn:(old:EngineHealth)=>Promise<T>){return withLock(this.store.p("locks",`engine-${key}.lock`),async()=>fn((await this.get(key))??{key,label:key,state:"closed",failures:0,lastError:null,retryAt:null,lastSuccess:null,updatedAt:this.now().toISOString(),probe:null}));}
  private save(row:EngineHealth){row.updatedAt=this.now().toISOString();return writeJsonAtomic(this.file(row.key),EngineHealth.parse(row),{keepBackup:false});}
  async begin(key:string,label:string){
    return this.change(key,async row=>{
      const now=this.now().getTime();
      const probeBusy=row.state==="half_open"&&row.probe&&new Date(row.probe.until).getTime()>now&&(row.probe.host!==os.hostname()||alive(row.probe.pid));
      if(probeBusy||(row.state==="open"&&row.retryAt&&new Date(row.retryAt).getTime()>now))throw new FactoryError("ENGINE_COOLDOWN","RETRYABLE",row.lastError??"Engine cooling down",{retryAfter:row.retryAt??row.probe?.until??new Date(now+60000).toISOString(),provider:key});
      if(row.state!=="closed")await this.save({...row,label,state:"half_open",probe:{pid:process.pid,host:os.hostname(),until:new Date(now+20*60000).toISOString()}});
    });
  }
  async success(key:string,label:string){await this.change(key,async row=>this.save({...row,label,state:"closed",failures:0,lastError:null,retryAt:null,probe:null,lastSuccess:this.now().toISOString()}));}
  /** Resource waits/pause are not a successful or failed model probe. Allow a later real probe. */
  async defer(key:string){await this.change(key,async row=>this.save({...row,probe:null,...(row.state==="half_open"?{state:"open" as const,retryAt:this.now().toISOString()}:{} )}));}
  async failure(key:string,label:string,message:string){
    return this.change(key,async row=>{
      const resource=/GPU_BUSY/.test(message),missing=/NEEDS_PROVIDER|No module named|BINARY_MISSING|safetensor|checkpoint.*(corrupt|invalid)|invalid.*checkpoint|PytorchStreamReader/i.test(message);
      const failures=resource?row.failures:row.failures+1,open=resource||missing||failures>=2;
      const next:EngineHealth={...row,label,failures,state:open?"open":"closed",probe:null,lastError:message.slice(-2000),retryAt:open?new Date(this.now().getTime()+(resource?60000:Math.min(3600000,300000*2**Math.min(failures-1,3)))).toISOString():null};
      await this.save(next);if(open&&row.state==="closed")await this.store.audit({actor:"engine",action:"engine.circuit_open",subject:key,detail:{label,failures,error:next.lastError,retryAt:next.retryAt}});
      return next;
    });
  }
  async reset(key:string,actor:string){await this.change(key,async row=>this.save({...row,state:"closed",failures:0,lastError:null,retryAt:null,probe:null}));await this.store.audit({actor,action:"engine.reset",subject:key});}
  async blockedKeys(){const now=this.now().getTime();return new Set((await this.list()).filter(r=>(r.state==="open"&&!!r.retryAt&&Date.parse(r.retryAt)>now)||(r.state==="half_open"&&!!r.probe&&Date.parse(r.probe.until)>now&&(r.probe.host!==os.hostname()||alive(r.probe.pid)))).map(r=>r.key));}
}
