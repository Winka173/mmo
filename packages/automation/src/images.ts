import {randomUUID} from "node:crypto";
import * as fs from "node:fs/promises";
import {z} from "zod";
import {DataStore,readJson,writeJsonAtomic} from "@ttm/storage";
import {StudioConfig,StudioStore,hash} from "./studio.js";
import {FileQueue} from "./queue.js";
import {GPU_ENGINE_KEY,engineKey} from "./engine-health.js";
export const ImageInput=z.object({prompt:z.string().trim().min(1).max(2400),width:z.number().int().min(384).max(1536).multipleOf(16).default(768),height:z.number().int().min(384).max(1536).multipleOf(16).default(768),seed:z.number().int().min(0).max(2147483647).default(0)}).refine(v=>v.width*v.height<=1048576,"Image preset is limited to one megapixel; choose a supported preset");
export const ImageAsset=z.object({id:z.string().uuid(),input:ImageInput,config:StudioConfig,configHash:z.string(),state:z.enum(["queued","running","ready","failed"]),evidence:z.record(z.unknown()).nullable().default(null),sha256:z.string().nullable().default(null),error:z.string().nullable().default(null),synthetic:z.literal(true).default(true),humanReview:z.literal("NOT_REVIEWED").default("NOT_REVIEWED"),createdAt:z.string(),updatedAt:z.string()});
export type ImageAsset=z.infer<typeof ImageAsset>;
const StoredImage= z.unknown().transform(input=>{const raw=input as ImageAsset,authentic=!!raw&&raw.configHash===hash(raw.config),row=ImageAsset.parse(input);if(authentic)row.configHash=hash(row.config);return row;});
export class ImageStore{
 constructor(readonly store:DataStore){}
 file(id:string){return this.store.p("studio","images",`${z.string().uuid().parse(id)}.json`);}
 output(id:string){return this.store.p("studio","image-files",`${z.string().uuid().parse(id)}.png`);}
 get(id:string){return readJson(this.file(id),StoredImage);}
 async list(){const names=await fs.readdir(this.store.p("studio","images")).catch(()=>[] as string[]),rows=await Promise.all(names.filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(n=>this.get(n.slice(0,-5))));return rows.filter((r):r is ImageAsset=>!!r).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 async save(row:ImageAsset){row=ImageAsset.parse({...row,updatedAt:new Date().toISOString()});await writeJsonAtomic(this.file(row.id),row);return row;}
 async enqueue(input:unknown){const value=ImageInput.parse(input),config=await new StudioStore(this.store).config();if(!config.pythonImage||!config.imageModel)throw new Error("Install/configure the local image runtime and checkpoint first / Cài và cấu hình model ảnh local trước");const now=new Date().toISOString(),row=await this.save(ImageAsset.parse({id:randomUUID(),input:value,config,configHash:hash(config),state:"queued",createdAt:now,updatedAt:now}));const {job}=await new FileQueue(this.store).enqueue({kind:"STUDIO_IMAGE",idempotencyKey:`image:${row.id}`,payload:{imageId:row.id,engineKeys:[GPU_ENGINE_KEY,engineKey(config,"image")]},usesGpu:true,maxAttempts:2,priority:2});return {...row,jobId:job.id};}
}
