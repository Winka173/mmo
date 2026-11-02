import * as fs from "node:fs/promises";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {buildContext} from "../apps/worker/src/context.js";
import {executeStudio} from "../apps/worker/src/studio.js";
import {StudioStore,getStudioRepairPlan,requestStudioRepair} from "@ttm/automation";
import {inspectStudioMedia} from "@ttm/quality";
import {runProcess} from "@ttm/media";
const digest=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
async function main(){
 const root=process.cwd(),previous=JSON.parse(await fs.readFile("docs/evidence/acs-frame-speech-e2e.json","utf8")),original=await buildContext({dataDir:previous.data}),ctx=await buildContext({dataDir:path.join(root,".local/p0-repair-e2e",randomUUID(),"data")}),studio=new StudioStore(ctx.store),parent=(await new StudioStore(original.store).run(previous.runId))!;
 await ctx.store.updateSettings(s=>({...s,paused:false,killSwitch:false,externalPostingEnabled:false,telegram:{...s.telegram,enabled:false}}),"isolated-repair-fixture");
 await studio.saveAutopilot({...parent.snapshot,enabled:false});await studio.saveRun(parent);
 const dir=ctx.store.p("studio","artifacts",parent.id);await fs.cp(original.store.p("studio","artifacts",parent.id),dir,{recursive:true});
 const source=path.join(dir,"final.mp4"),damaged=path.join(dir,"controlled-quiet.mp4");
 const attenuation=await runProcess(parent.config.ffmpeg,["-y","-i",source,"-c:v","copy","-af","volume=0.04","-c:a","aac",damaged]);if(attenuation.code)throw new Error(attenuation.stderr);
 await fs.rename(damaged,source);const before=await fs.readFile(source),measured=await inspectStudioMedia(source,parent.config),qa=JSON.parse(await fs.readFile(path.join(dir,"qa.json"),"utf8"));
 qa.findings=measured.findings;qa.technical=measured.technical;qa.videoSha256=digest(before);qa.controlledFault="Existing copied speech attenuated to 4% gain, original source artifacts untouched";await fs.writeFile(path.join(dir,"qa.json"),JSON.stringify(qa));
 const plan=await getStudioRepairPlan(studio,parent.id);if(!plan.operations.some(op=>op.kind==="mix"&&op.available))throw new Error("Actual quiet audio did not trigger repair");
 const child=await requestStudioRepair(studio,{id:parent.id,kind:"mix",expectedPlanSha256:plan.sha256});await executeStudio(ctx,child.id);
 const done=(await studio.run(child.id))!,childDir=ctx.store.p("studio","artifacts",child.id),result=JSON.parse(await fs.readFile(path.join(childDir,"qa.json"),"utf8")),execution=JSON.parse(await fs.readFile(path.join(childDir,"repair-execution.json"),"utf8"));
 const originalHash=digest(await fs.readFile(previous.final)),requests=(await fs.readdir(childDir)).filter(name=>/request\.json$/.test(name));
 const beforeLoudness=qa.findings.find((f:any)=>f.criterion==="audio_loudness"),afterLoudness=result.findings.find((f:any)=>f.criterion==="audio_loudness");
 if(done.state!=="ready"||!result.technical||afterLoudness.status!=="pass"||requests.length||digest(await fs.readFile(source))!==digest(before)||originalHash!==previous.videoSha256)throw new Error("Targeted mix repair failed preservation/technical/no-AI criteria");
 const report={status:"VERIFIED_REAL_SPEECH_SCOPED_MIX_REPAIR_NO_NEW_AI",at:new Date().toISOString(),data:ctx.store.root,parentId:parent.id,childId:child.id,final:path.join(childDir,"final.mp4"),sourceEvidence:"acs-frame-speech-e2e.json",fault:qa.controlledFault,before:beforeLoudness,after:afterLoudness,execution,technical:result.technical,parentVideoSha256:digest(before),originalSpeechDraftSha256:originalHash,originalPreserved:true,aiRequests:requests,publicPosting:false,humanListening:"NOT_REVIEWED"};
 await fs.writeFile("docs/evidence/acs-p0-repair-e2e.json",JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,childId:child.id,before:beforeLoudness.status,after:afterLoudness.status}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
