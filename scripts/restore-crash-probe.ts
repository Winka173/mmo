import * as fs from "node:fs/promises";
import path from "node:path";
import {spawn} from "node:child_process";
import {randomUUID,createHash} from "node:crypto";
import {DataStore,createBackup,restoreManifestSha,restoreStudioBackup,recoverStudioRestore,writeJsonAtomic} from "@ttm/storage";
async function main(){
const root=process.cwd(),folder=process.env.ACS_RESTORE_CRASH_ROOT??path.join(root,".local/restore-crash",randomUUID()),store=new DataStore(path.join(folder,"data"));
if(process.env.ACS_RESTORE_CRASH_CHILD){const request=JSON.parse(await fs.readFile(path.join(folder,"request.json"),"utf8"));await restoreStudioBackup(store,request.backup,request.id,request.sha,{afterWrite:async n=>{if(n===2){await fs.writeFile(path.join(folder,"partial-write-reached"),String(process.pid));await new Promise(()=>{setInterval(()=>{},1000);});}}});}
else{
 await store.init();await store.updateSettings(s=>({...s,paused:true}),"probe");await writeJsonAtomic(store.p("studio/autopilots/test.json"),{name:"Backup value",enabled:false});const backup=path.basename((await createBackup(store)).dir),id=randomUUID(),sha=await restoreManifestSha(store,backup);await writeJsonAtomic(store.p("studio/autopilots/test.json"),{name:"Current value",enabled:false});await writeJsonAtomic(store.p("config/restore-marker.json"),{value:"before partial restore"});const before=await fs.readFile(store.p("studio/autopilots/test.json"));await fs.writeFile(path.join(folder,"request.json"),JSON.stringify({backup,id,sha}));
 const child=spawn(process.execPath,[path.join(root,"node_modules/tsx/dist/cli.mjs"),"scripts/restore-crash-probe.ts"],{cwd:root,windowsHide:true,env:{...process.env,ACS_RESTORE_CRASH_ROOT:folder,ACS_RESTORE_CRASH_CHILD:"1"},stdio:["ignore","ignore","pipe"]});let logs="";child.stderr.on("data",b=>logs+=b);
 const deadline=Date.now()+30000;while(!await fs.stat(path.join(folder,"partial-write-reached")).catch(()=>null)){if(child.exitCode!==null||Date.now()>deadline)throw new Error(`Restore crash probe could not reach actual partial writes: ${logs}`);await new Promise(r=>setTimeout(r,100));}
 await new Promise<void>((resolve,reject)=>{const kill=spawn("taskkill",["/PID",String(child.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});kill.on("close",code=>code===0?resolve():reject(new Error("Owned restore crash injection failed")));});await new Promise<void>(resolve=>{if(child.exitCode!==null)resolve();else child.once("exit",()=>resolve());});
 const journalBefore=JSON.parse(await fs.readFile(store.p(`.restore/${id}/journal.json`),"utf8"));if(journalBefore.phase!=="applying")throw new Error("Restore was not actually interrupted while applying");const result=await recoverStudioRestore(store);if(result.status!=="ROLLED_BACK")throw new Error("Startup recovery did not roll back");if(!before.equals(await fs.readFile(store.p("studio/autopilots/test.json"))))throw new Error("Original project bytes were lost");if(JSON.parse(await fs.readFile(store.p("config/restore-marker.json"),"utf8")).value!=="before partial restore")throw new Error("Deleted metadata not recovered");if(!(await store.getSettings()).paused)throw new Error("Recovery unexpectedly resumed production");
 const report={status:"VERIFIED_ACTUAL_RESTORE_PROCESS_KILL_AND_JOURNAL_RECOVERY",at:new Date().toISOString(),folder,id,killedPid:child.pid,interruptedPhase:journalBefore.phase,rollback:result,originalProjectSha256:createHash("sha256").update(before).digest("hex"),settings:await store.getSettings(),AIInference:false,publicPosting:false};await fs.writeFile("docs/evidence/acs-restore-crash.json",JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,id}));
}

}
main().catch(error=>{console.error(error);process.exitCode=1;});
