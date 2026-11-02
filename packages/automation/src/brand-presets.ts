import * as fs from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {BrandStyle} from "@ttm/core";
import {DataStore,readJson,writeJsonAtomic,withLock} from "@ttm/storage";
export const BrandPreset=z.object({id:z.string().uuid(),revision:z.number().int().positive(),style:BrandStyle,createdAt:z.string().datetime(),updatedAt:z.string().datetime()});
export class BrandPresetStore{
 constructor(readonly store:DataStore){}
 async list(){const names=await fs.readdir(this.store.p("studio","brand-presets")).catch(()=>[] as string[]),rows=await Promise.all(names.filter(n=>/^[a-f0-9-]{36}\.json$/i.test(n)).map(n=>readJson(this.store.p("studio","brand-presets",n),BrandPreset)));return rows.filter((r):r is z.infer<typeof BrandPreset>=>!!r);}
 async save(input:unknown){const value=z.object({id:z.string().uuid().optional(),revision:z.number().int().positive().optional(),style:BrandStyle}).strict().parse(input),id=value.id??randomUUID();
  return withLock(this.store.p("locks",`brand-preset-${id}.lock`),async()=>{const file=this.store.p("studio","brand-presets",`${id}.json`),old=await readJson(file,BrandPreset);if(value.id&&!old)throw new Error("Preset not found");if(old&&old.revision!==value.revision)throw new Error("Brand preset changed; reload before saving");const now=new Date().toISOString(),next=BrandPreset.parse({id,revision:(old?.revision??0)+1,style:value.style,createdAt:old?.createdAt??now,updatedAt:now});
   await writeJsonAtomic(this.store.p("studio","brand-history",id,`${next.revision}.json`),next);await writeJsonAtomic(file,next);return next;});
 }
}
