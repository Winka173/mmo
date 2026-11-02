import * as fs from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
import {DataStore,recoverStudioRestore,restoreStudioBackup,rollbackStudioRestore,writeJsonAtomic} from "@ttm/storage";
const [mode,root,data]=process.argv.slice(2),store=new DataStore(data);
const Request=z.discriminatedUnion("action",[
 z.object({id:z.string().uuid(),action:z.literal("restore"),name:z.string().regex(/^[A-Za-z0-9_-]{1,180}$/),manifestSha:z.string().regex(/^[a-f0-9]{64}$/),currentFingerprint:z.string().regex(/^[a-f0-9]{64}$/),at:z.string().datetime()}),
 z.object({id:z.string().uuid(),action:z.literal("rollback"),transactionId:z.string().uuid(),at:z.string().datetime()}),
]);
if(!path.isAbsolute(root)||!path.isAbsolute(data))throw new Error("Explicit absolute maintenance folders required");
const requestFile=path.join(root,"maintenance-request.json"),resultFile=path.join(root,"maintenance-result.json");
try{
 if(mode==="recover"){
  const result=await recoverStudioRestore(store);if("id"in result){const pending=await fs.readFile(requestFile,"utf8").then(JSON.parse,()=>null);if(pending?.id===result.id||pending?.transactionId===result.id){await writeJsonAtomic(resultFile,{...result,id:pending.id,transactionId:result.id,at:new Date().toISOString(),recoveredAfterInterruption:true},{keepBackup:false});await fs.rm(requestFile,{force:true});}}
 }else if(mode==="run"){
  const request=Request.parse(JSON.parse(await fs.readFile(requestFile,"utf8")));let result;
  try{result=request.action==="restore"?await restoreStudioBackup(store,request.name,request.id,request.manifestSha,{expectedCurrentFingerprint:request.currentFingerprint}):await rollbackStudioRestore(store,request.transactionId);}catch(error:any){if(await fs.stat(store.p(".restore/active.json")).catch(()=>null))throw error;result={status:"FAILED",error:error.message};}
  await writeJsonAtomic(resultFile,{...result,id:request.id,transactionId:request.action==="restore"?request.id:request.transactionId,action:request.action,at:new Date().toISOString()},{keepBackup:false});await fs.rm(requestFile,{force:true});
 }else throw new Error("Unknown maintenance command");
}catch(error:any){console.error(error.message);process.exitCode=1;}
