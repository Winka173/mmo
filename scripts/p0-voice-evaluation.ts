import * as fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildContext } from "../apps/worker/src/context.js";
import { invokeLocalEngine } from "../apps/worker/src/local-engine.js";
import { buildStudioCaptions } from "../apps/worker/src/studio-caption-evidence.js";
import { StudioStore, applyPronunciations, type Pronunciation } from "@ttm/automation";
import { reviewNarration } from "@ttm/quality";
import { runProcess, toSrt, toAss } from "@ttm/media";

const root=process.cwd(),sha=(bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
const viNumeric="Bản cập nhật có 12 màn chơi, chạy ở 60 khung hình mỗi giây và có dung lượng 2,5 GB.";
const enNumeric="Version 2.5 includes 12 levels and runs at 60 frames per second.";
const dictionary=(language:"vi-VN"|"en-US",values:[string,string][]):Pronunciation[]=>values.map(([term,spoken])=>({term,spoken,language}));
const samples=[
 {id:"vi-diacritics",language:"vi-VN" as const,text:"Giữ nguyên bản gốc. Những chiếc thuyền nhỏ vượt qua bến cảng, dưới ánh nắng dịu dàng.",dictionary:[]},
 {id:"vi-raw-numbers",language:"vi-VN" as const,text:viNumeric,dictionary:[]},
 {id:"vi-explicit-numbers",language:"vi-VN" as const,text:viNumeric,dictionary:dictionary("vi-VN",[["12","mười hai"],["60","sáu mươi"],["2,5","hai phẩy năm"],["GB","ghi ga bai"]])},
 {id:"vi-pauses-names",language:"vi-VN" as const,text:"ACS đã lưu bản gốc. Chờ một chút... Sau đó, bạn có thể tiếp tục chỉnh sửa video.",dictionary:dictionary("vi-VN",[["ACS","ây xi ét"]])},
 {id:"en-us-baseline",language:"en-US" as const,text:"Keep the original files. The small boats cross the harbor in the gentle morning light.",dictionary:[]},
 {id:"en-us-raw-numbers",language:"en-US" as const,text:enNumeric,dictionary:[]},
 {id:"en-us-explicit-numbers",language:"en-US" as const,text:enNumeric,dictionary:dictionary("en-US",[["2.5","two point five"],["12","twelve"],["60","sixty"]])},
 {id:"en-us-pauses-names",language:"en-US" as const,text:"ACS saved the original. Wait a moment... Then, you can continue editing the video.",dictionary:dictionary("en-US",[["ACS","A C S"]])},
 {id:"en-gb-baseline",language:"en-GB" as const,text:"Keep the original files. The small boats cross the harbour in the gentle morning light.",dictionary:[]},
];

function pcmStats(bytes:Buffer){
 if(bytes.toString("ascii",0,4)!=="RIFF"||bytes.toString("ascii",8,12)!=="WAVE")throw new Error("Expected RIFF PCM WAV");
 let offset=12,format=0,rate=0,channels=0,bits=0,data:Buffer|undefined;
 while(offset+8<=bytes.length){const id=bytes.toString("ascii",offset,offset+4),size=bytes.readUInt32LE(offset+4),from=offset+8;if(from+size>bytes.length)throw new Error("Truncated WAV chunk");
  if(id==="fmt "){format=bytes.readUInt16LE(from);channels=bytes.readUInt16LE(from+2);rate=bytes.readUInt32LE(from+4);bits=bytes.readUInt16LE(from+14);}
  if(id==="data")data=bytes.subarray(from,from+size);offset=from+size+(size%2);
 }
 if(format!==1||bits!==16||!data||!rate||!channels)throw new Error("Evaluation requires lossless 16-bit PCM output");
 let peak=0,clippedSamples=0,sum=0;for(let i=0;i<data.length;i+=2){const v=data.readInt16LE(i);peak=Math.max(peak,Math.abs(v));sum+=v*v;if(v===32767||v===-32768)clippedSamples++;}
 const count=data.length/2;return{sampleRate:rate,channels,seconds:count/channels/rate,peakLinear:peak/32768,rmsLinear:Math.sqrt(sum/count)/32768,clippedSamples,sampleCount:count};
}

/** Rescore retained real outputs after deterministic QA changes; no new inference. */
async function recheck(device:string){
 const destination=path.join(root,`docs/evidence/acs-p0-voice-${device==="cpu"?"cpu-":""}evaluation.json`),bytes=await fs.readFile(destination),report=JSON.parse(bytes.toString("utf8"));
 if(!report.status.startsWith("VERIFIED_REAL_LOCAL_INFERENCE")||report.requestedDevice!==device)throw new Error("Recheck needs a completed matching real evaluation");
 const selected=device==="cpu"?samples.filter(s=>s.language.startsWith("en")):samples;
 if(report.samples.length!==selected.length)throw new Error("Recheck sample selection changed");
 for(const [i,sample]of report.samples.entries()){
  const original=selected[i];if(sample.id!==original.id||sample.text!==original.text||sample.spokenText!==applyPronunciations(original.text,original.language,original.dictionary)||sha(await fs.readFile(sample.file))!==sample.audioSha256)throw new Error("Recheck source/selection identity mismatch");
  const matches=report.asr.results.filter((r:any)=>r.file===sample.file);if(matches.length!==1)throw new Error("Recheck ASR identity mismatch");
  sample.roundTrip=reviewNarration(sample.spokenText,matches[0].text,sample.language,matches[0].language);
  sample.captions=buildStudioCaptions([{text:sample.text,file:sample.file,durationSec:sample.waveform.seconds+.3,audioDurationSec:sample.waveform.seconds}],report.vad,{width:1080,fontSize:56,maxChars:38}).evidence;
 }
 report.summary.roundTripPass=report.samples.filter((s:any)=>s.roundTrip.status==="pass").length;report.summary.roundTripFlagged=report.samples.length-report.summary.roundTripPass;
 report.summary.captionFindings=report.samples.reduce((sum:number,s:any)=>sum+s.captions.readability.findings.length,0);
 report.deterministicRecheck={at:new Date().toISOString(),sourceReportSha256:sha(bytes),voiceQaSha256:sha(await fs.readFile(path.join(root,"packages/quality/src/voice.ts"))),captionQaSha256:sha(await fs.readFile(path.join(root,"packages/media/src/subtitles.ts"))),inferencePerformed:false,priorModelOutputsPreserved:true};
 await fs.writeFile(destination,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,summary:report.summary,recheck:report.deterministicRecheck}));
}

async function main(){
 const device=process.env.ACS_VOICE_EVAL_DEVICE??"cuda";
 if(!["cuda","cpu"].includes(device))throw new Error("Evaluation device must be explicitly cpu or cuda");
 if(process.argv.includes("--recheck"))return recheck(device);
 // VieNeu's configured checkpoint is CUDA-only. CPU evaluation intentionally
 // selects English before inference and makes no new Vietnamese TTS claim.
 const selected=device==="cpu"?samples.filter(s=>s.language.startsWith("en")):samples;
 for(const name of ["OMP_NUM_THREADS","MKL_NUM_THREADS","OPENBLAS_NUM_THREADS"])process.env[name]="4";
 const folder=path.resolve(process.env.ACS_VOICE_EVAL_RESUME??path.join(root,".local/p0-voice",String(Date.now())));
 if(!folder.startsWith(path.join(root,".local/p0-voice")+path.sep))throw new Error("Evaluation directory must remain inside .local/p0-voice");
 await fs.mkdir(folder,{recursive:true});
 const ctx=await buildContext({dataDir:path.join(folder,"data")}),studio=new StudioStore(ctx.store);
 const prior=JSON.parse(await fs.readFile(path.join(root,".local/native-smoke/data/config/studio.json"),"utf8"));
 await studio.saveConfig({...prior,ttsDevice:device,asrDevice:device,vadModel:path.join(root,".local/models/silero-vad/silero_vad.jit"),vadSha256:"e1122837f4154c511485fe0b9c64455f7b929c96fbb8d79fbdb336383ebd3720",pythonVad:path.join(root,".local/engines/asr/Scripts/python.exe")});
 const config=await studio.config(),report:any={status:"RUNNING",at:new Date().toISOString(),folder,requestedDevice:device,selection:`${selected.length} fixed original authored samples selected before inference; raw and dictionary numeric pairs retained even when review fails`,scope:"Small regression set for pronunciation, numbers, pauses and caption grouping; not representative quality certification",vietnameseSkipped:device==="cpu"?"Configured VieNeu engine requires CUDA; CPU English subset deliberately selected before inference":null,localOnly:true,productionConfigChanged:false,expectedTextSentToASR:false,wordAlignment:"NOT_PROVIDED",humanListening:"NOT_REVIEWED",publicPosting:false,samples:selected.map(s=>({...s,spokenText:applyPronunciations(s.text,s.language,s.dictionary)}))};
 const destination=path.join(root,`docs/evidence/acs-p0-voice-${device==="cpu"?"cpu-":""}evaluation.json`),save=async()=>fs.writeFile(destination,JSON.stringify(report,null,2));
 await save();
 try{
  for(const sample of report.samples){
   const output=path.join(folder,`${sample.id}.wav`),receipt=path.join(folder,`${sample.id}.tts.json`),identity=sha(JSON.stringify({text:sample.spokenText,language:sample.language,dictionary:sample.dictionary,config}));
   const cached=await fs.readFile(receipt,"utf8").then(JSON.parse,()=>null);
   if(cached){if(cached.identity!==identity||sha(await fs.readFile(output))!==cached.audioSha256)throw new Error("Resume cache identity mismatch; preserve original evaluation folder");sample.inference=cached.inference;sample.reusedPriorActualInference=true;}
   else{sample.inference=await invokeLocalEngine(ctx,config,{op:"tts",language:sample.language,text:sample.spokenText,output},path.join(folder,`${sample.id}.request.json`));await fs.writeFile(receipt,JSON.stringify({identity,audioSha256:sha(await fs.readFile(output)),inference:sample.inference},null,2));sample.reusedPriorActualInference=false;}
   if(sample.inference.device!==device||sample.inference.language!==sample.language)throw new Error("Voice did not honor explicit locale and execution device");
   const bytes=await fs.readFile(output);sample.file=output;sample.audioSha256=sha(bytes);sample.waveform=pcmStats(bytes);
   const decode=await runProcess(config.ffmpeg,["-v","error","-i",output,"-f","null","-"],{timeoutMs:30000});if(decode.code!==0)throw new Error("Actual TTS audio failed full FFmpeg decode");sample.fullDecode="PASS";
   await save();console.log(JSON.stringify({completed:sample.id,seconds:sample.waveform.seconds,clippedSamples:sample.waveform.clippedSamples}));
  }
  const audio=report.samples.map((s:any)=>s.file);
  report.asr=await invokeLocalEngine(ctx,config,{op:"asr",audio},path.join(folder,"asr.request.json"));
  report.vad=await invokeLocalEngine(ctx,config,{op:"vad",audio},path.join(folder,"vad.request.json"));
  if(report.asr.device!==device||report.asr.results.length!==selected.length)throw new Error("ASR result count/device mismatch");
  for(const sample of report.samples){
   const matches=report.asr.results.filter((r:any)=>r.file===sample.file);if(matches.length!==1)throw new Error("ASR audio identity missing or duplicate");
   sample.roundTrip=reviewNarration(sample.spokenText,matches[0].text,sample.language,matches[0].language);
   const captions=buildStudioCaptions([{text:sample.text,file:sample.file,durationSec:sample.waveform.seconds+.3,audioDurationSec:sample.waveform.seconds}],report.vad,{width:1080,fontSize:56,maxChars:38});
   sample.captions=captions.evidence;sample.captionSourcePreserved=captions.cues.map((c:any)=>c.text).join(" ")===sample.text;
   await fs.writeFile(path.join(folder,`${sample.id}.srt`),toSrt(captions.cues),"utf8");
   await fs.writeFile(path.join(folder,`${sample.id}.ass`),toAss(captions.cues,{width:1080,height:1920,fontSize:56,marginV:200,fontName:"Arial"}),"utf8");
   if(!sample.captionSourcePreserved||sha(await fs.readFile(sample.file))!==sample.audioSha256)throw new Error("Caption generation changed source text or audio");
  }
  report.status="VERIFIED_REAL_LOCAL_INFERENCE_OWNER_REVIEW_PENDING";
  report.summary={clips:report.samples.length,audioSeconds:report.samples.reduce((sum:number,s:any)=>sum+s.waveform.seconds,0),roundTripPass:report.samples.filter((s:any)=>s.roundTrip.status==="pass").length,roundTripFlagged:report.samples.filter((s:any)=>s.roundTrip.status!=="pass").length,clippingFlagged:report.samples.filter((s:any)=>s.waveform.clippedSamples>0).length,captionFindings:report.samples.reduce((sum:number,s:any)=>sum+s.captions.readability.findings.length,0),locales:[...new Set(selected.map(s=>s.language))],voices:{vi:device==="cpu"?"NOT_EVALUATED":config.voiceVi,enUS:config.voiceEn,enGB:config.voiceEnGb}};
  report.limitations=["Strict token edit distance compares words literally. ASR may output digits for spoken numbers; numeric pairs are retained for listening, not automatically declared correct.","VAD measures speech activity and silence only. Caption times remain phrase estimates; no word timestamps or subtitle synchronization acceptance is inferred.","No listening by owner, broad accent/long-form evaluation, expressive voice or pronunciation approval has occurred.","Dictionary entries are explicit authored evaluation settings, not automatic factual/number rewriting or a universally validated pronunciation preset."];
  await save();console.log(JSON.stringify({status:report.status,summary:report.summary,report:destination}));
 }catch(error:any){report.status="BLOCKED_OR_FAILED";report.error=error.message;await save();throw error;}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
