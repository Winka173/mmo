import * as fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import sharp from "sharp";
import {buildContext} from "../apps/worker/src/context.js";
import {executeStudioMediaVision} from "../apps/worker/src/studio-media-vision.js";
import {stopManagedLlm} from "../apps/worker/src/managed-llm.js";
import {Autopilot,StudioRun,StudioStore,StudioMediaCatalog,studioFileDigest,hash,discoverStudioTools} from "@ttm/automation";
async function main(){
 const root=process.cwd(),base=path.join(root,".local","media-intelligence",randomUUID()),ctx=await buildContext({dataDir:path.join(base,"data")}),studio=new StudioStore(ctx.store),installed=JSON.parse(await fs.readFile(path.join(root,".local/llm-setup/data/config/studio.json"),"utf8")),config=(await discoverStudioTools(root,installed)).config;await studio.saveConfig(config);
 await ctx.store.updateSettings(settings=>({...settings,paused:false,killSwitch:false,studioPostingEnabled:false,telegram:{...settings.telegram,enabled:false}}),"owned-vision-fixture");
 const id=randomUUID(),dir=ctx.store.p("studio","artifacts",id);await fs.mkdir(dir,{recursive:true});
 const file=path.join(dir,"source-0.png"),svg='<svg width="640" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="400" fill="white"/><circle cx="170" cy="190" r="90" fill="blue"/><rect x="340" y="100" width="210" height="180" fill="orange"/><text x="220" y="360" font-size="34" font-family="Arial" fill="black">ACS OWNED FIXTURE</text></svg>';await sharp(Buffer.from(svg)).png().toFile(file);
 const now=new Date().toISOString(),snapshot=Autopilot.parse({id:randomUUID(),name:"Owned geometric fixture; not gameplay",family:"custom",brief:"Owner-generated blue circle and orange rectangle",createdAt:now,updatedAt:now}),source={file,sha256:await studioFileDigest(file),size:(await fs.stat(file)).size};
 const run=StudioRun.parse({id,autopilotId:snapshot.id,snapshot,config,snapshotHash:hash({a:snapshot,config}),title:"Owned geometric keyframe benchmark",language:"en-US",state:"needs_input",stages:[],sources:[source],shots:[{text:"A blue circle sits beside an orange rectangle",asset:file}],createdAt:now,updatedAt:now});await studio.saveRun(run);
 const catalog=new StudioMediaCatalog(ctx.store),task=await catalog.enqueueVision({runId:id,sha256:source.sha256,positions:[0]}),started=Date.now();let status="VERIFIED_LOCAL_INFERENCE_FIXTURE_ONLY",failure:null|string=null;
 try{await executeStudioMediaVision(ctx,task.id);}catch(error:any){status="BLOCKED_REAL_INFERENCE";failure=error.message;}
 const result=await catalog.vision(task.id),frame=(result?.result?.frames as any[])?.[0],description=frame?.suggestion?.description??"",fixtureMatch=/blue/i.test(description)&&/orange/i.test(description)&&/circle/i.test(description)&&/rectang/i.test(description);
 const evidence={status,at:new Date().toISOString(),base,data:ctx.store.root,runId:id,taskId:task.id,source,seconds:(Date.now()-started)/1000,expected:{circle:"blue",rectangle:"orange",scope:"Owned static shape fixture, not gameplay/OCR calibration"},fixtureMatch,visualValidation:fixtureMatch?"MATCHED_OWNED_FIXTURE_ONLY":"FLAGGED_FIXTURE_SHAPE_MISMATCH_REVIEW_REQUIRED",taskState:result?.state,result:result?.result,error:failure,annotationsAutomaticallyApplied:await catalog.get(source.sha256)!==null,ownerReview:"NOT_PERFORMED",realGameplay:"NOT_AVAILABLE",cloudInference:false,publishing:false};
 await fs.writeFile(path.join(root,"docs/evidence/acs-media-vision.json"),JSON.stringify(evidence,null,2));console.log(JSON.stringify({status,taskId:task.id,fixtureMatch,seconds:evidence.seconds,error:failure}));if(failure)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>stopManagedLlm());
