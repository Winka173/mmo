import path from "node:path";
import * as fs from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {DataStore} from "@ttm/storage";
import {StudioStore} from "@ttm/automation";
import {buildContext} from "../apps/worker/src/context.js";
import {executeStudio} from "../apps/worker/src/studio.js";
import {stopManagedLlm} from "../apps/worker/src/managed-llm.js";
const digest=async(file:string)=>createHash("sha256").update(await fs.readFile(file)).digest("hex");
async function main(){
 const root=process.cwd(),previous=JSON.parse(await fs.readFile("docs/evidence/acs-create-guided-ui.json","utf8"));
 if(!previous.status.startsWith("VERIFIED"))throw new Error("A genuine previously rendered guided speech fixture is required");
 const sourceStore=new StudioStore(new DataStore(previous.data)),original=await sourceStore.run(previous.runId);
 if(!original||original.state!=="ready"||original.language!=="en-US")throw new Error("Expected an existing English draft, not a synthetic placeholder");
 const sourceDir=sourceStore.store.p("studio","artifacts",original.id),sourceVideoSha=await digest(path.join(sourceDir,"final.mp4"));
 const base=path.join(root,".local/frame-speech",String(Date.now())),ctx=await buildContext({dataDir:path.join(base,"data")}),studio=new StudioStore(ctx.store),owned=path.join(base,"owned-graphics");await fs.mkdir(owned,{recursive:true});
 await studio.saveConfig({...original.config,asrModel:"",vadModel:""}); // Reuse measured real speech; this experiment does not re-certify ASR/VAD.
 await ctx.store.updateSettings(settings=>({...settings,paused:false,killSwitch:false,externalPostingEnabled:false,telegram:{...settings.telegram,enabled:false}}),"frame-speech-fixture");
 for(const [index,source] of original.sources.entries())await fs.copyFile(source.file,path.join(owned,`${index}${path.extname(source.file)}`));
 const now=new Date().toISOString(),pilot=await studio.saveAutopilot({id:randomUUID(),name:"Frame-aligned reuse of actual English narration",family:"custom",sourceFolder:owned,scriptText:original.shots.map(shot=>shot.text).join("\n\n"),brief:original.snapshot.brief,pronunciation:original.snapshot.pronunciation,languages:[original.language],format:original.snapshot.format,durationSec:original.snapshot.durationSec,rights:"AUTHORIZED_REUSE",rightsEvidence:"ACS-authored original graphics and prior Kokoro synthesis reused only for internal timing tests. Source facts, commercial/publication rights and human listening remain unapproved.",createdAt:now,updatedAt:now}),queued=await studio.enqueue(pilot,original.language,`frame:${randomUUID()}`),dir=ctx.store.p("studio","artifacts",queued.id);await fs.mkdir(dir,{recursive:true});
 for(const file of["voice-model-pin.json",...original.shots.flatMap((_,index)=>[`voice-${index}.wav`,`voice-${index}.json`])])await fs.copyFile(path.join(sourceDir,file),path.join(dir,file));
 const report:any={status:"RUNNING",at:now,sourceRunId:original.id,runId:queued.id,data:ctx.store.root,publicPosting:false,humanReview:"NOT_CREATED",speechPolicy:"Reuse byte-identical actual Kokoro CUDA WAVs and their original checkpoint metadata. No fresh ASR or speech quality approval."};
 try{
  await executeStudio(ctx,queued.id);const run=(await studio.run(queued.id))!,timeline=(await studio.timeline(run.id))!,qa=JSON.parse(await fs.readFile(path.join(dir,"qa.json"),"utf8"));
  const ttsRequests=(await fs.readdir(dir)).filter(file=>/^tts-.*request\.json$/.test(file));if(ttsRequests.length)throw new Error("Unchanged speech unexpectedly required fresh TTS; report it separately rather than claiming pure reuse");
  const voices=[];for(let index=0;index<run.shots.length;index++){const before=await digest(path.join(sourceDir,`voice-${index}.wav`)),after=await digest(path.join(dir,`voice-${index}.wav`));if(before!==after)throw new Error("Speech bytes changed");voices.push({index,sha256:after,reusedFrom:path.join(sourceDir,`voice-${index}.wav`)});}
  if(!qa.technical||!qa.renderTiming.frameTimedNarration||qa.renderTiming.measuredVideoFrames!==qa.renderTiming.plannedFrames||Math.abs(qa.duration-timeline.duration)>1/30+.02)throw new Error("Frame-aligned source render did not pass");
  const parentSha=await digest(path.join(dir,"final.mp4")),child=await studio.cut(run.id,5,8);await executeStudio(ctx,child.id);const childDir=ctx.store.p("studio","artifacts",child.id),cut=(await studio.timeline(child.id))!,cutQa=JSON.parse(await fs.readFile(path.join(childDir,"qa.json"),"utf8"));
  if(!cutQa.technical||Math.abs(timeline.duration-cut.duration-3)>1e-6||Math.abs(cutQa.duration-cut.duration)>1/30+.02||await digest(path.join(dir,"final.mp4"))!==parentSha||await digest(path.join(sourceDir,"final.mp4"))!==sourceVideoSha)throw new Error("Frame cut or immutable parent check failed");
  Object.assign(report,{status:"VERIFIED_FRAME_TIMING_WITH_REUSED_REAL_SPEECH_NO_NEW_MODEL_INFERENCE",final:path.join(dir,"final.mp4"),sourceVideoSha256:sourceVideoSha,videoSha256:parentSha,renderTiming:qa.renderTiming,timelineDuration:timeline.duration,voices,ttsRequests,ASR:"NOT_RERUN; earlier source evidence remains separate",cut:{id:child.id,final:path.join(childDir,"final.mp4"),timelineDuration:cut.duration,containerDuration:cutQa.duration,videoDuration:Number(cutQa.video.duration),videoFrames:Number(cutQa.video.nb_frames),timelineSecondsRemoved:timeline.duration-cut.duration,containerSecondsRemoved:qa.duration-cutQa.duration,technical:cutQa.technical},originalPreserved:true,publishEligibility:qa.publishEligibility});console.log(JSON.stringify({status:report.status,renderTiming:report.renderTiming,cut:report.cut}));
 }catch(error:any){report.status="BLOCKED_OR_FAILED";report.error=error.message;throw error;}finally{stopManagedLlm();await fs.writeFile("docs/evidence/acs-frame-speech-e2e.json",JSON.stringify(report,null,2));}
}
main().catch(error=>{console.error(error);stopManagedLlm();process.exitCode=1;});
