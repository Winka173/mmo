import path from "node:path";
import * as fs from "node:fs/promises";
import {randomUUID} from "node:crypto";
import sharp from "sharp";
import {StudioStore} from "@ttm/automation";
import {buildContext} from "../apps/worker/src/context.js";
import {runJob} from "../apps/worker/src/handlers.js";
async function main(){
 const root=process.cwd(),base=path.resolve(process.env.ACS_P0_UI_ROOT??"");if(!base.startsWith(path.join(root,".local","p0-ui")+path.sep))throw new Error("Use an isolated P0 UI directory");
 const ctx=await buildContext({dataDir:path.join(base,"data")}),studio=new StudioStore(ctx.store),folder=path.join(base,"owned");await fs.mkdir(folder,{recursive:true});
 await sharp({create:{width:640,height:360,channels:3,background:"#64487e"}}).png().toFile(path.join(folder,"calibration.png"));
 await studio.saveConfig({ttsDevice:"cpu",llmDevice:"cpu",ffmpeg:path.join(root,".local/tools/ffmpeg.exe"),ffprobe:path.join(root,".local/tools/ffprobe.exe")});
 await ctx.store.updateSettings(s=>({...s,paused:false,killSwitch:false,externalPostingEnabled:false,telegram:{...s.telegram,enabled:false}}),"isolated-p0-ui");
 const now=new Date().toISOString(),pilot=await studio.saveAutopilot({id:randomUUID(),name:"P0 owned planning UI fixture",family:"custom",brief:"Owned calibration image. This is not gameplay or a model-quality evaluation.",scriptText:"An owned calibration image for editing a saved plan.",sourceFolder:folder,rights:"AUTHORIZED_REUSE",rightsEvidence:"Owned generated calibration image for contract testing only",languages:["en-US"],createdAt:now,updatedAt:now}),plan=await studio.enqueue(pilot,"en-US","p0-ui",true);
 const job=await ctx.queue.claim({kinds:["STUDIO_RUN"],maxConcurrent:1,gpuSlots:1});if(!job)throw new Error("Fixture plan missing");await runJob(ctx,job);if((await studio.run(plan.id))?.planning?.state!=="ready")throw new Error("Fixture plan did not stop");
 // Import a byte-identical prior real-speech draft into this isolated database; this is NOT fresh inference.
 const previous=JSON.parse(await fs.readFile(path.join(root,"docs/evidence/acs-frame-speech-e2e.json"),"utf8")),oldCtx=await buildContext({dataDir:previous.data}),oldStudio=new StudioStore(oldCtx.store),rendered=(await oldStudio.run(previous.runId))!;
 if(!rendered||rendered.state!=="ready")throw new Error("Prior real speech draft unavailable");
 await studio.saveAutopilot({...rendered.snapshot,enabled:false});await studio.saveRun(rendered);
 await fs.cp(oldCtx.store.p("studio","artifacts",rendered.id),ctx.store.p("studio","artifacts",rendered.id),{recursive:true});
 const qaFile=ctx.store.p("studio","artifacts",rendered.id,"qa.json"),qa=JSON.parse(await fs.readFile(qaFile,"utf8"));
 qa.findings.push({criterion:"audio_loudness",status:"unknown",severity:"warning",evidence:"Injected UI repair proposal fixture; not an actual new loudness finding"});await fs.writeFile(qaFile,JSON.stringify(qa));
 await fs.writeFile(path.join(base,"fixture.json"),JSON.stringify({data:ctx.store.root,planId:plan.id,renderId:rendered.id,priorSpeechSource:previous.final,inference:"NOT_PERFORMED",publicPosting:false},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
