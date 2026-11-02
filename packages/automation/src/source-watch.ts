import {createHash,randomUUID} from "node:crypto";
import {createReadStream} from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
import {DataStore,readJson,writeJsonAtomic,withLock} from "@ttm/storage";
import type {Autopilot,StudioRun} from "./studio.js";
export const SourceWatchConfig=z.object({enabled:z.boolean().default(false),intervalMinutes:z.number().int().min(1).max(1440).default(10)});
export const WatchedSource=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),file:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/),size:z.number().nonnegative(),mtimeMs:z.number(),firstSeenAt:z.string(),lastSeenAt:z.string(),available:z.boolean()});
export const SourceWatchState=z.object({autopilotId:z.string().uuid(),revision:z.number(),sourceFolder:z.string(),checkedAt:z.string(),nextPollAt:z.string(),items:z.array(WatchedSource).max(1000),error:z.string().nullable(),warning:z.string().nullable()});
export const SourceItem=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),originalFile:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/),size:z.number().nonnegative(),observedAt:z.string()});
async function digest(file:string){const hash=createHash("sha256");for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest("hex");}
function blocked(a:Autopilot,now:Date){if(!["localization","shorts"].includes(a.family))return "Folder watching currently supports authorized localization and original-speech excerpts";if(!a.sourceFolder)return "Choose the folder containing creator-provided authorized videos";if(a.rights!=="AUTHORIZED_REUSE"||a.rightsEvidence.trim().length<12||!a.reusePermissions.cut||!a.reusePermissions.redistribute||a.family==="localization"&&(!a.reusePermissions.translate||!a.reusePermissions.dub))return "Record source rights and each required cut/translation/dub/redistribution scope before watching media";if(a.reusePermissions.expiresAt&&Date.parse(a.reusePermissions.expiresAt)<=now.getTime())return "Source reuse rights expired";return null;}
/** Local creator-provided exports only. Never downloads or authorizes remote footage. */
export class SourceWatchStore{
 constructor(readonly store:DataStore){}
 get(id:string){z.string().uuid().parse(id);return readJson(this.store.p("studio","watches",`${id}.json`),SourceWatchState);}
 async poll(a:Autopilot,now=new Date(),force=false){
  if(!a.sourceWatch.enabled)return null;
  return withLock(this.store.p("locks",`source-watch-${a.id}.lock`),async()=>{
   const previous=await this.get(a.id),settings=await this.store.getSettings();if(settings.paused||settings.killSwitch)return previous;
   if(!force&&previous?.revision===a.revision&&Date.parse(previous.nextPollAt)>now.getTime())return previous;
   const state=SourceWatchState.parse({autopilotId:a.id,revision:a.revision,sourceFolder:a.sourceFolder,checkedAt:now.toISOString(),nextPollAt:new Date(now.getTime()+a.sourceWatch.intervalMinutes*60000).toISOString(),items:previous?.sourceFolder===a.sourceFolder?previous.items:[],error:null,warning:null});
   const save=async()=>{await writeJsonAtomic(this.store.p("studio","watches",`${a.id}.json`),state);return state;};
   const reason=blocked(a,now);if(reason){state.error=reason;return save();}
   try{
    const files=(await fs.readdir(a.sourceFolder,{withFileTypes:true})).filter(f=>f.isFile()&&/\.(mp4|mov|mkv|webm)$/i.test(f.name)).sort((x,y)=>x.name.localeCompare(y.name));
    if(files.length>40)state.warning="Only the first 40 top-level video files are watched; archive completed exports separately";
    const seen=new Set<string>();let readBytes=0;
    for(const entry of files.slice(0,40)){
     const flags=await this.store.getSettings();if(flags.paused||flags.killSwitch)break;
     const file=path.resolve(a.sourceFolder,entry.name),before=await fs.stat(file);if(now.getTime()-before.mtimeMs<5000){state.warning="A recent file may still be copying; it will be inspected after it settles";continue;}
     if(before.size>2*1024**3||readBytes+before.size>2*1024**3){state.warning="Watch scan has a 2 GiB file/read budget; split large exports or use manual intake";continue;}
     const cached=!force?state.items.find(i=>i.file===file&&i.size===before.size&&i.mtimeMs===before.mtimeMs):null;
     const sha256=cached?.sha256??await digest(file);if(!cached)readBytes+=before.size;
     const after=await fs.stat(file);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs){state.warning="Source changed while hashing; deferred until stable";continue;}
     const prior=state.items.find(i=>i.id===sha256);seen.add(sha256);
     if(prior)Object.assign(prior,{file,size:after.size,mtimeMs:after.mtimeMs,lastSeenAt:now.toISOString(),available:true});
     else if(state.items.length<1000)state.items.push(WatchedSource.parse({id:sha256,file,sha256,size:after.size,mtimeMs:after.mtimeMs,firstSeenAt:now.toISOString(),lastSeenAt:now.toISOString(),available:true}));
     else state.warning="Watch history reached 1000 identities; create a new source campaign rather than discard provenance";
    }
    for(const item of state.items)if(!seen.has(item.id))item.available=false;
   }catch(error){state.error=error instanceof Error?error.message:"Cannot inspect source folder";}
   return save();
  });
 }
 async prepare(a:Autopilot,runs:StudioRun[],now=new Date()):Promise<Autopilot|null>{
  if(!a.sourceWatch.enabled||a.sourceItem)return a;
  const reason=blocked(a,now);if(reason)throw new Error(reason);
  const state=await this.poll(a,now);if(!state||state.error)throw new Error(state?.error??"Source watcher unavailable");
  const seen=runs.filter(r=>r.autopilotId===a.id&&r.snapshot.sourceItem),used=new Set(seen.filter(r=>a.languages.every(lang=>seen.some(other=>other.language===lang&&other.snapshot.sourceItem?.id===r.snapshot.sourceItem?.id))).map(r=>r.snapshot.sourceItem!.id));
  const item=state.items.filter(i=>i.available&&!used.has(i.id)).sort((x,y)=>x.firstSeenAt.localeCompare(y.firstSeenAt)||x.file.localeCompare(y.file))[0];if(!item)return null;
  const folder=path.resolve(a.sourceFolder),file=path.resolve(item.file);if(!file.startsWith(folder+path.sep)||path.dirname(file)!==folder)throw new Error("Watched source escaped the selected folder");
  const intake=this.store.p("studio","watch-intake",a.id,item.id);await fs.mkdir(intake,{recursive:true});
  const space=await fs.statfs(intake),settings=await this.store.getSettings();if(space.bavail*space.bsize<item.size*2+settings.minFreeDiskGb*1024**3)throw new Error("Insufficient disk for pinned source and production artifacts");
  const dest=path.join(intake,`original${path.extname(file).toLowerCase()}`);
  if(await digest(dest).catch(()=>null)!==item.sha256){
   const temp=dest+`.copy-${randomUUID()}`;
   try{await fs.copyFile(file,temp,fs.constants.COPYFILE_EXCL);if(await digest(temp)!==item.sha256)throw new Error("Source changed after observation; force a rescan before production");await fs.rename(temp,dest);}finally{await fs.unlink(temp).catch(()=>undefined);}
  }
  const sourceItem=SourceItem.parse({id:item.id,originalFile:file,sha256:item.sha256,size:item.size,observedAt:item.firstSeenAt});await writeJsonAtomic(path.join(intake,"origin.json"),sourceItem);
  return {...a,sourceFolder:intake,sourceItem};
 }
}
