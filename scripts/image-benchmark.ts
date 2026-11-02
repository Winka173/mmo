import * as fs from "node:fs/promises";
import path from "node:path";
import {buildContext} from "../apps/worker/src/context.js";
import {runJob} from "../apps/worker/src/handlers.js";
import {ImageStore,StudioStore} from "@ttm/automation";
async function main(){
 const root=process.cwd(),model=path.join(root,".local/models/flux2-klein-4b"),data=process.env.ACS_IMAGE_DATA??path.join(root,".local/image-benchmark",String(Date.now()),"data"),report:any={status:"WAITING_CHECKPOINT",started:new Date().toISOString(),data,model,paidApis:false,humanReview:"NOT_REVIEWED"};
 const save=()=>fs.writeFile("docs/evidence/acs-image-latest-attempt.json",JSON.stringify({...report,updatedAt:new Date().toISOString()},null,2));
 try{
  const downloadDeadline=Date.now()+45*60000;await save();while(!await fs.stat(path.join(model,"acs-manifest.json")).catch(()=>null)){if(Date.now()>downloadDeadline)throw new Error("Checkpoint download is still incomplete; resumable files retained");await new Promise(r=>setTimeout(r,5000));}
  const ctx=await buildContext({dataDir:data}),studio=new StudioStore(ctx.store),images=new ImageStore(ctx.store);await studio.saveConfig({...await studio.config(),pythonImage:path.join(root,".local/engines/image/Scripts/python.exe"),imageModel:model,imageDevice:"cuda_cpu_offload"});await ctx.store.updateSettings(s=>({...s,paused:false,killSwitch:false,externalPostingEnabled:false}),"image-benchmark");
  let row=(await images.list())[0];if(!row)row=await images.enqueue({prompt:"An original editorial watercolor illustration of a quiet library beside a small garden at sunrise, warm golden light, rich natural colors, inviting composition, no text, no logos, no people",width:768,height:768,seed:42});report.imageId=row.id;report.status="WAITING_OR_RUNNING_GPU";await save();
  const deadline=Date.now()+30*60000;while(row.state!=="ready"&&Date.now()<deadline){if(row.state==="failed")throw new Error(row.error??"Image inference failed");const job=await ctx.queue.claim({kinds:["STUDIO_IMAGE"],maxConcurrent:1,gpuSlots:1});if(job)await runJob(ctx,job);row=(await images.get(row.id))!;report.state=row.state;report.lastError=row.error;await save();if(row.state!=="ready")await new Promise(r=>setTimeout(r,3000));}
  if(row.state!=="ready")throw new Error("Shared GPU resource wait expired; durable image job retained");const evidence:any=row.evidence;if(evidence.device!=="cuda"||evidence.execution_mode!=="cuda_cpu_offload"||evidence.technical.status!=="PASS")throw new Error("Actual image inference did not satisfy technical acceptance");
  Object.assign(report,{status:"VERIFIED_LOCAL_IMAGE_TECHNICAL_ONLY",output:images.output(row.id),sha256:row.sha256,evidence,visualReview:"NOT_REVIEWED",factualEvidence:false,checks:["actual selected FLUX checkpoint read locally with pinned weight hashes","real CUDA inference with explicit CPU offload, no cloud request","PNG decoded and native dimensions/hash verified","seed, prompt, model/runtime provenance retained","technical validation does not establish editorial quality or real-world facts"]});await fs.writeFile("docs/evidence/acs-image-inference.json",JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,output:report.output,seconds:evidence.seconds,peakMiB:evidence.peak_vram_mib}));
 }catch(error:any){report.status="BLOCKED_OR_FAILED";report.error=error.message;await save();throw error;}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
