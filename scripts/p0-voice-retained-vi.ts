import * as fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {reviewNarration} from "@ttm/quality";

async function main(){
 const root=process.cwd(),sha=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex"),sourceFile=path.join(root,"docs/evidence/acs-product-e2e.json"),sourceBytes=await fs.readFile(sourceFile),source=JSON.parse(sourceBytes.toString("utf8"));
 const selected=source.runs.filter((run:any)=>run.language==="vi-VN");if(selected.length!==1)throw new Error("Expected one fixed real Vietnamese product draft");
 const dir=path.dirname(selected[0].final),reviewFile=path.join(dir,"voice-review.json"),reviewBytes=await fs.readFile(reviewFile),prior=JSON.parse(reviewBytes.toString("utf8")),samples:any[]=[];
 if(prior.engine.engine!=="qwen3-asr"||prior.engine.device!=="cuda")throw new Error("Expected retained actual local CUDA ASR receipt");
 for(const [index,check]of prior.checks.entries()){
  const file=path.join(dir,`voice-${index}.wav`),receipt=JSON.parse(await fs.readFile(path.join(dir,`voice-${index}.json`),"utf8")),audioSha256=sha(await fs.readFile(file));
  if(check.file!==file||receipt.audioSha256!==audioSha256||receipt.spokenText!==check.spokenText||receipt.device!=="cuda"||receipt.engine!=="vieneu"||receipt.language!=="vi-VN")throw new Error("Retained voice identity/metadata mismatch");
  const observed=prior.engine.results.filter((result:any)=>result.file===file);if(observed.length!==1||observed[0].text!==check.transcription)throw new Error("Retained ASR text identity mismatch");
  const current=reviewNarration(receipt.spokenText,observed[0].text,"vi-VN",observed[0].language);
  samples.push({index,file,audioSha256,seconds:receipt.audio_seconds,sourceText:receipt.sourceText,spokenText:receipt.spokenText,transcription:observed[0].text,tts:{engine:receipt.engine,voice:receipt.voice,device:receipt.device,sdkVersion:receipt.sdk_version,modelSha256:receipt.model_sha256,codecSha256:receipt.codec_sha256},priorStatus:check.status,current,changed:check.status!==current.status});
 }
 const report={status:"VERIFIED_RETAINED_REAL_VI_SPEECH_RECHECK_NOT_NEW_INFERENCE",at:new Date().toISOString(),selection:"All five narration lines in the already verified Vietnamese product draft; selected without excluding failures",sourceEvidence:{file:sourceFile,sha256:sha(sourceBytes),voiceReviewFile:reviewFile,voiceReviewSha256:sha(reviewBytes)},inferencePerformed:false,originalArtifactsModified:false,localOnly:true,humanListening:"NOT_REVIEWED",wordAlignment:"NOT_PROVIDED",publicPosting:false,asr:{engine:prior.engine.engine,device:prior.engine.device,modelSha256:prior.engine.model_sha256},samples,summary:{clips:samples.length,audioSeconds:samples.reduce((sum,s)=>sum+s.seconds,0),previousPass:samples.filter(s=>s.priorStatus==="pass").length,currentPass:samples.filter(s=>s.current.status==="pass").length,currentFlagged:samples.filter(s=>s.current.status!=="pass").length,newlyFlagged:samples.filter(s=>s.changed&&s.current.status!=="pass").map(s=>({index:s.index,numericEvidence:s.current.numericEvidence,negationEvidence:s.current.negationEvidence}))},scope:"Deterministic re-evaluation of retained authentic VieNeu CUDA speech/Qwen ASR outputs. Detecting mismatch does not determine whether TTS or ASR was wrong; owner listening remains required."};
 await fs.writeFile(path.join(root,"docs/evidence/acs-p0-voice-retained-vi.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,summary:report.summary}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
