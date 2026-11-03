import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import * as fs from "node:fs/promises";
import {realpathSync} from "node:fs";
import { z } from "zod";
import { DataStore, readJson, writeJsonAtomic, withLock } from "@ttm/storage";
import { FileQueue } from "./queue.js";
import { StudioConfig, StudioStore, hash } from "./studio.js";

export const SetupProfile=z.enum(["espeak-ng","qwen3.5-9b","qwen-quality","kokoro","vieneu","qwen-asr","silero-vad","flux2-klein-4b","qwen-embedding","wav2vec2-en-align"]);
export const ModelSetup=z.object({id:z.string().uuid(),profile:SetupProfile,mode:z.enum(["install","verify","preflight"]).default("install"),root:z.string(),config:StudioConfig,configHash:z.string(),state:z.enum(["queued","running","checked","installed","verified","failed"]),progress:z.record(z.unknown()).default({}),resultConfig:StudioConfig.nullable().default(null),error:z.string().nullable().default(null),createdAt:z.string(),updatedAt:z.string()});
export type ModelSetup=z.infer<typeof ModelSetup>;
const StoredModelSetup=z.unknown().transform(input=>{const raw=input as ModelSetup,authentic=!!raw&&raw.configHash===hash(raw.config),row=ModelSetup.parse(input);if(authentic)row.configHash=hash(row.config);return row;});
export function environmentLock(python:string){
 let env=path.dirname(path.dirname(path.resolve(python)));try{env=realpathSync(env);}catch{}
 return path.join(process.env.LOCALAPPDATA||os.tmpdir(),"AutonomousCreativeStudio","locks",`environment-${hash(process.platform==="win32"?env.toLowerCase():env)}.lock`);
}
export function modelStoreLock(folder:string){let target=path.resolve(folder);try{target=realpathSync(target);}catch{}return path.join(process.env.LOCALAPPDATA||os.tmpdir(),"AutonomousCreativeStudio","locks",`model-store-${hash(process.platform==="win32"?target.toLowerCase():target)}.lock`);}
export class ModelSetupStore{
 constructor(readonly store:DataStore){}
 file(id:string){return this.store.p("studio","setup",`${z.string().uuid().parse(id)}.json`);}
 get(id:string){return readJson(this.file(id),StoredModelSetup);}
 async list(){const names=await fs.readdir(this.store.p("studio","setup")).catch(()=>[] as string[]);const rows=await Promise.all(names.filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(n=>this.get(n.slice(0,-5))));return rows.filter((r):r is ModelSetup=>!!r);}
 async save(row:ModelSetup){row=ModelSetup.parse({...row,updatedAt:new Date().toISOString()});await writeJsonAtomic(this.file(row.id),row);return row;}
 async enqueue(input:unknown){
  const {profile,root,mode}=z.object({profile:SetupProfile,root:z.string().trim().min(1),mode:z.enum(["install","verify","preflight"]).default("install")}).parse(input);
  if(!path.isAbsolute(root))throw new Error("Choose an absolute ACS setup folder");
  const normalized=path.resolve(root);
  if(/asset[-_ ]?forge/i.test(normalized))throw new Error("Choose an ACS-owned folder, separate from Asset Forge");
  return withLock(this.store.p("locks","setup-request.lock"),async()=>{
   const pending=(await this.list()).find(r=>r.profile===profile&&r.root===normalized&&["queued","running"].includes(r.state));if(pending){if(pending.mode!==mode)throw new Error("This profile is still running another operation. Wait for completion before verification or repair.");return pending;}
   const now=new Date().toISOString(),config=await new StudioStore(this.store).config();
   const row=await this.save(ModelSetup.parse({id:randomUUID(),profile,mode,root:normalized,config,configHash:hash(config),state:"queued",createdAt:now,updatedAt:now}));
   await new FileQueue(this.store).enqueue({kind:"STUDIO_SETUP",idempotencyKey:`setup:${row.id}`,payload:{setupId:row.id},usesGpu:false,maxAttempts:1,priority:1});return row;
  });
 }
}
