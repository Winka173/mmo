import * as fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {z} from "zod";
import {DATA_VERSION} from "@ttm/core";
import type {DataStore} from "./store.js";
import {BACKUP_INCLUDE,SKIP_EXT,planRestore,readBackupManifest} from "./backup.js";
import {safeJoin,sha256File,writeJsonAtomic,writeFileAtomic} from "./fsutil.js";
import {withLock} from "./lock.js";

const Entry=z.object({file:z.string(),old:z.string().nullable(),next:z.string().nullable()});
const Journal=z.object({id:z.string().uuid(),backup:z.string(),manifestSha:z.string(),phase:z.enum(["prepared","applying","committed","rolling_back","rolled_back"]),entries:z.array(Entry),at:z.string(),error:z.string().optional()});
type Journal=z.infer<typeof Journal>;
const digest=(bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
const uuid=(id:string)=>z.string().uuid().parse(id);
const hashOrNull=async(file:string)=>sha256File(file).catch((error:NodeJS.ErrnoException)=>{if(error.code==="ENOENT")return null;throw error;});
/** Every existing path component must remain an ordinary directory/file, never a junction. */
async function ordinary(root:string,relative:string){
 const file=safeJoin(root,relative);let current=path.resolve(root);
 for(const segment of ["",...path.relative(root,file).split(path.sep).filter(Boolean)]){
  if(segment)current=path.join(current,segment);
  const stat=await fs.lstat(current).catch((error:NodeJS.ErrnoException)=>{if(error.code==="ENOENT")return null;throw error;});
  if(stat?.isSymbolicLink())throw new Error(`Restore refuses a linked path: ${relative}`);
 }
 return file;
}
function allowed(relative:string){safeJoin("restore-validation",relative);if(!BACKUP_INCLUDE.includes(relative.split(/[\\/]/)[0]))throw new Error(`Unsupported restore path: ${relative}`);return relative;}
async function files(root:string,relative:string):Promise<string[]>{
 const file=await ordinary(root,relative),stat=await fs.lstat(file).catch((error:NodeJS.ErrnoException)=>{if(error.code==="ENOENT")return null;throw error;});
 if(!stat)return[];if(stat.isFile())return[relative];if(!stat.isDirectory())throw new Error("Unsupported restore entry");
 const result:string[]=[];for(const name of await fs.readdir(file))result.push(...await files(root,`${relative}/${name}`));return result;
}
const metadata=(file:string)=>!SKIP_EXT.has(path.extname(file.replace(/\.bak$/i,"")).toLowerCase())&&!file.endsWith(".tmp");
async function atomicCopy(source:string,dest:string,expected:string){
 await fs.mkdir(path.dirname(dest),{recursive:true});const temp=`${dest}.${process.pid}.${Date.now()}.restore-tmp`;
 try{await fs.copyFile(source,temp);if(await sha256File(temp)!==expected)throw new Error("Copied restore file failed checksum");const handle=await fs.open(temp,"r+");try{await handle.sync();}finally{await handle.close();}
  for(let attempt=0;;attempt++){try{await fs.rename(temp,dest);break;}catch(error:any){if(attempt>=5||!["EPERM","EBUSY","EACCES"].includes(error.code))throw error;await new Promise(r=>setTimeout(r,50*2**attempt));}}
 }finally{await fs.rm(temp,{force:true}).catch(()=>{});}
}
async function holdSettings(store:DataStore){
 const file=await ordinary(store.root,"config/settings.json"),settings=JSON.parse(await fs.readFile(file,"utf8"));
 await writeJsonAtomic(file,{...settings,paused:true,killSwitch:true,externalPostingEnabled:false,telegram:{...settings.telegram,enabled:false}},{keepBackup:false});
 await writeJsonAtomic(await ordinary(store.root,"studio/posting-policy.json"),{enabled:false,scope:"RESTORE_REQUIRES_NEW_AUTHORIZATION",at:new Date().toISOString()},{keepBackup:false});
}
async function saveJournal(store:DataStore,journal:Journal){await writeJsonAtomic(await ordinary(store.root,`.restore/${uuid(journal.id)}/journal.json`),journal,{keepBackup:false});}
async function loadJournal(store:DataStore,id:string){return Journal.parse(JSON.parse(await fs.readFile(await ordinary(store.root,`.restore/${uuid(id)}/journal.json`),"utf8")));}
async function pointer(store:DataStore,id:string){await writeJsonAtomic(await ordinary(store.root,".restore/active.json"),{id:uuid(id)},{keepBackup:false});}
async function clearPointer(store:DataStore,id:string){const file=await ordinary(store.root,".restore/active.json"),current=await fs.readFile(file,"utf8").then(JSON.parse,()=>null);if(current?.id===id)await fs.rm(file,{force:true});}
export async function restoreManifestSha(store:DataStore,name:string){if(!await readBackupManifest(store,name))throw new Error("Invalid backup manifest");return sha256File(await ordinary(store.root,`backups/${name}/BACKUP.json`));}
export async function inspectStudioRestore(store:DataStore,name:string){
 const plan=await planRestore(store,name),manifest=await readBackupManifest(store,name);if(!manifest)throw new Error("Invalid backup");
 const current=(await Promise.all(BACKUP_INCLUDE.map(top=>files(store.root,top)))).flat(),removed=current.filter(file=>(manifest.includeMedia||metadata(file))&&!Object.hasOwn(manifest.checksums,file)&&file!=="studio/posting-policy.json");
 const identities=await Promise.all(current.filter(file=>manifest.includeMedia||metadata(file)).sort().map(async file=>[file,await sha256File(await ordinary(store.root,file))]));
 return{...plan,currentFingerprint:digest(JSON.stringify(identities)),willRemove:removed.length,removeExamples:removed.slice(0,20),uiSupported:manifest.dataVersion===DATA_VERSION&&manifest.secrets==="none"&&plan.compatible&&!plan.integrity.unchecked&&Object.keys(manifest.checksums).length>0};
}

async function rollbackUnlocked(store:DataStore,journal:Journal){
 // Validate every rollback byte before changing any file. A damaged safety copy blocks recovery.
 for(const entry of journal.entries){allowed(entry.file);await ordinary(store.root,entry.file);if(entry.old&&await hashOrNull(await ordinary(store.root,`.restore/${journal.id}/old/${entry.file}`))!==entry.old)throw new Error(`Safety copy failed checksum: ${entry.file}`);}
 journal.phase="rolling_back";await saveJournal(store,journal);await pointer(store,journal.id);
 for(const entry of journal.entries){const dest=await ordinary(store.root,entry.file);if(entry.old)await atomicCopy(await ordinary(store.root,`.restore/${journal.id}/old/${entry.file}`),dest,entry.old);else await fs.rm(dest,{force:true});}
 await holdSettings(store);journal.phase="rolled_back";await saveJournal(store,journal);await clearPointer(store,journal.id);return{status:"ROLLED_BACK",id:journal.id,backup:journal.backup,productionHeld:true};
}
/** Runs BEFORE DataStore.init / web / worker on native startup. It never reapplies an interrupted restore. */
export async function recoverStudioRestore(store:DataStore){
 return withLock(store.p("locks/worker.lock"),async()=>{
  const active=await fs.readFile(await ordinary(store.root,".restore/active.json"),"utf8").then(JSON.parse,(error:NodeJS.ErrnoException)=>{if(error.code==="ENOENT")return null;throw error;});
  if(!active)return{status:"NO_RECOVERY_NEEDED"};const journal=await loadJournal(store,uuid(active.id));
  if(journal.phase==="committed"||journal.phase==="rolled_back"){await clearPointer(store,journal.id);return{status:journal.phase==="committed"?"RESTORED":"ROLLED_BACK",id:journal.id,backup:journal.backup};}
  return rollbackUnlocked(store,journal);
 },{waitMs:1000,purpose:"Studio restore startup recovery"});
}
/** Transactional UI restore: stage + verified safety copies, durable journal, atomic files, rollback. */
export async function restoreStudioBackup(store:DataStore,name:string,id:string,manifestSha:string,options:{afterWrite?:(count:number)=>Promise<void>;expectedCurrentFingerprint?:string}={}){
 uuid(id);return withLock(store.p("locks/worker.lock"),async()=>{
  if(await fs.stat(store.p(".restore/active.json")).catch(()=>null))throw new Error("Unfinished restore must be recovered first");
  const existing=await fs.stat(store.p(`.restore/${id}/journal.json`)).catch(()=>null);
  if(existing){const journal=await loadJournal(store,id);if(journal.backup!==name||journal.manifestSha!==manifestSha)throw new Error("Restore request identity changed");if(!["committed","rolled_back"].includes(journal.phase))throw new Error("Interrupted restore requires startup recovery");return{status:journal.phase==="committed"?"RESTORED":"ROLLED_BACK",id,backup:name,productionHeld:true};}
  const plan=await planRestore(store,name),manifest=await readBackupManifest(store,name);
  if(!manifest||!plan.compatible||plan.integrity.unchecked||!Object.keys(manifest.checksums).length)throw new Error(plan.reason??"Restore requires a complete checksummed backup");
  if(manifest.dataVersion!==DATA_VERSION)throw new Error("UI restore requires the current data version; migrate older backups offline first");
  if(manifest.secrets!=="none")throw new Error("UI restore does not restore encrypted credential bundles");
  if(await restoreManifestSha(store,name)!==manifestSha)throw new Error("Backup changed since inspection; inspect again");
  if(options.expectedCurrentFingerprint&&(await inspectStudioRestore(store,name)).currentFingerprint!==options.expectedCurrentFingerprint)throw new Error("Current data changed after inspection; inspect again before restoring");
  const settings=await store.getSettings();if(!settings.paused)throw new Error("Pause production before restoring");
  const desired=new Map<string,{file:string;sha:string}>();
  const replace=async(relative:string,value:unknown)=>{const file=await ordinary(store.root,`.restore/${id}/new/${relative}`),bytes=JSON.stringify(value);await writeFileAtomic(file,bytes,{keepBackup:false});desired.set(relative,{file,sha:digest(bytes)});};
  const disk=await fs.statfs(store.root),backupBytes=(await Promise.all(Object.keys(manifest.checksums).map(async relative=>(await fs.stat(await ordinary(store.root,`backups/${name}/${relative}`))).size))).reduce((a,b)=>a+b,0);
  const existingFiles=(await Promise.all(BACKUP_INCLUDE.map(top=>files(store.root,top)))).flat(),existingBytes=(await Promise.all(existingFiles.filter(file=>manifest.includeMedia||metadata(file)).map(async file=>(await fs.stat(store.p(file))).size))).reduce((a,b)=>a+b,0);
  if(disk.bavail*disk.bsize<backupBytes+existingBytes+Math.max(backupBytes,existingBytes)+64*1024*1024)throw new Error("Not enough free disk space for staging, safety copies and rollback");
  for(const [relative,sha]of Object.entries(manifest.checksums)){
   allowed(relative);const source=await ordinary(store.root,`backups/${name}/${relative}`),file=await ordinary(store.root,`.restore/${id}/new/${relative}`);await atomicCopy(source,file,sha);
   if(/\.(json|jsonl)$/i.test(relative)){const stat=await fs.stat(file);if(stat.size>64*1024*1024)throw new Error("UI restore JSON metadata limit is 64 MiB per file; use offline tooling for larger records");const text=await fs.readFile(file,"utf8");if(relative.endsWith(".jsonl")){for(const line of text.split(/\r?\n/).filter(Boolean))JSON.parse(line);}else JSON.parse(text);}
   desired.set(relative,{file,sha});
  }
  // Old automation state must never resume side effects after restoring.
  const restoredSettings=desired.has("config/settings.json")?JSON.parse(await fs.readFile(desired.get("config/settings.json")!.file,"utf8")):null;if(!restoredSettings)throw new Error("Backup is missing settings");
  await replace("config/settings.json",{...restoredSettings,paused:true,killSwitch:true,externalPostingEnabled:false,telegram:{...restoredSettings.telegram,enabled:false}});
  await replace("studio/posting-policy.json",{enabled:false,scope:"RESTORE_REQUIRES_NEW_AUTHORIZATION",at:new Date().toISOString()});
  for(const [file,entry]of desired)if(/^studio\/autopilots\/[^/]+\.json$/.test(file)){const row=JSON.parse(await fs.readFile(entry.file,"utf8"));await replace(file,{...row,enabled:false,revision:Math.max(1,Number(row.revision)||1)+1,updatedAt:new Date().toISOString()});}
  const affected=new Set([...desired.keys(),...existingFiles.filter(file=>manifest.includeMedia||metadata(file))]);
  const journal:Journal={id,backup:name,manifestSha,phase:"prepared",entries:[],at:new Date().toISOString()};
  for(const relative of [...affected].sort()){
   allowed(relative);const dest=await ordinary(store.root,relative),old=await hashOrNull(dest),next=desired.get(relative)?.sha??null;if(old===next)continue;
   if(old)await atomicCopy(dest,await ordinary(store.root,`.restore/${id}/old/${relative}`),old);journal.entries.push({file:relative,old,next});
  }
  await saveJournal(store,journal);await pointer(store,id);
  try{
   journal.phase="applying";await saveJournal(store,journal);let count=0;
   for(const entry of journal.entries){const dest=await ordinary(store.root,entry.file);if(await hashOrNull(dest)!==entry.old)throw new Error(`Current data changed during restore: ${entry.file}`);
    if(entry.next)await atomicCopy(await ordinary(store.root,`.restore/${id}/new/${entry.file}`),dest,entry.next);else await fs.rm(dest,{force:true});await options.afterWrite?.(++count);
   }
   for(const entry of journal.entries)if(await hashOrNull(await ordinary(store.root,entry.file))!==entry.next)throw new Error(`Post-restore checksum mismatch: ${entry.file}`);
   journal.phase="committed";await saveJournal(store,journal);await clearPointer(store,id);return{status:"RESTORED",id,backup:name,restored:journal.entries.length,safetyFolder:store.p(`.restore/${id}/old`),productionHeld:true};
  }catch(error:any){journal.error=error.message;await saveJournal(store,journal);await rollbackUnlocked(store,journal);throw new Error(`Restore failed; original files restored and production held: ${error.message}`);}
 },{waitMs:1000,purpose:"Transactional Studio restore"});
}
export async function rollbackStudioRestore(store:DataStore,id:string){return withLock(store.p("locks/worker.lock"),async()=>{
 const journal=await loadJournal(store,id);if(journal.phase==="rolled_back")return{status:"ROLLED_BACK",id,productionHeld:true};if(journal.phase!=="committed")throw new Error("Restore is not completed; recover it first");
 if(!(await store.getSettings()).paused)throw new Error("Pause production before rollback");
 for(const entry of journal.entries)if(await hashOrNull(await ordinary(store.root,entry.file))!==entry.next)throw new Error(`Data changed after restore; rollback would overwrite new work: ${entry.file}`);
 return rollbackUnlocked(store,journal);
 },{waitMs:1000,purpose:"Rollback Studio restore"});}
