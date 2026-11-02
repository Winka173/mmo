import {z} from "zod";
import * as fs from "node:fs/promises";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {createBackup,listBackups,readBackupManifest,inspectStudioRestore,restoreManifestSha,withLock,writeJsonAtomic} from "@ttm/storage";
import {getStore,getQueue} from "../../../lib/data";
export const dynamic="force-dynamic";
const read=async(file:string)=>fs.readFile(file,"utf8").then(JSON.parse,()=>null);
const signature=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function desktop(){
 const root=process.env.ACS_DESKTOP_CONFIG;if(!root)return null;
 const native=await read(path.join(root,"desktop-status.json"));
 if(!native||path.resolve(native.dataDir??"")!==path.resolve(process.env.DATA_DIR??""))return null;
 try{process.kill(native.supervisorPid,0);}catch{return null;}
 return{root,native,pending:await read(path.join(root,"maintenance-request.json")),result:await read(path.join(root,"maintenance-result.json"))};
}
export async function GET(){const store=await getStore(),control=await desktop(),backups=await Promise.all((await listBackups(store)).slice(0,30).map(async name=>({name,...await readBackupManifest(store,name)})));return Response.json({folder:store.p("backups"),backups:backups.map(({checksums,...row})=>row),desktopAvailable:!!control,maintenance:control?{pending:control.pending,result:control.result,status:control.native.status}:null});}
export async function POST(request:Request){
 if(request.headers.get("origin")!==`http://${request.headers.get("host")}`)return Response.json({error:"Invalid origin"},{status:403});
 try{
  const body=z.discriminatedUnion("action",[
   z.object({action:z.literal("create"),includeMedia:z.boolean().default(false)}),
   z.object({action:z.literal("inspect"),name:z.string().min(1).max(180)}),
   z.object({action:z.literal("restore"),name:z.string().min(1).max(180),manifestSha:z.string().regex(/^[a-f0-9]{64}$/),planSignature:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)}),
   z.object({action:z.literal("rollback"),transactionId:z.string().uuid(),confirmed:z.literal(true)}),
  ]).parse(await request.json()),store=await getStore();
  if(body.action==="inspect"){const plan=await inspectStudioRestore(store,body.name);return Response.json({...plan,manifestSha:await restoreManifestSha(store,body.name),planSignature:signature(plan)});}
  return Response.json(await withLock(store.p("locks","backup-ui.lock"),async()=>{
   const control=await desktop();if(control?.pending)throw new Error("Maintenance is already pending / Đang có tác vụ bảo trì");
   const settings=await store.getSettings(),running=await(await getQueue()).list("running");
   if(!settings.paused||running.length)throw new Error("Pause production and wait for running jobs to stop / Tạm dừng và chờ tác vụ đang chạy kết thúc");
   if(body.action==="create")return createBackup(store,{includeMedia:body.includeMedia,label:body.includeMedia?"studio-media":"studio-metadata"});
   if(!control||control.native.status!=="READY")throw new Error("Open the installed desktop app to restore or rollback / Mở app Windows để khôi phục hoặc hoàn tác");
   const id=randomUUID(),at=new Date().toISOString();let value;
   if(body.action==="restore"){
    const plan=await inspectStudioRestore(store,body.name);
    if(!plan.uiSupported)throw new Error(plan.reason??"UI restore requires current-version checksummed data without encrypted credentials");
    if(body.planSignature!==signature(plan)||body.manifestSha!==await restoreManifestSha(store,body.name))throw new Error("Backup or current data changed since inspection; inspect again / Dữ liệu đã đổi; kiểm tra lại trước khi khôi phục");
    value={id,action:"restore",name:body.name,manifestSha:body.manifestSha,currentFingerprint:plan.currentFingerprint,at};
   }else{
    const last=control.result;if(last?.status!=="RESTORED"||last.transactionId!==body.transactionId)throw new Error("Only the latest completed restore can be undone from this screen");value={id,action:"rollback",transactionId:body.transactionId,at};
   }
   await writeJsonAtomic(path.join(control.root,"maintenance-request.json"),value,{keepBackup:false});return{status:"QUEUED",...value};
  },{purpose:"Studio backup/restore request",waitMs:1000}));
 }catch(error:any){return Response.json({error:error.message},{status:400});}
}
