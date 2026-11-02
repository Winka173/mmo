import {runProcess} from "@ttm/media";
type Finding={criterion:string;status:"pass"|"fail"|"unknown";evidence:unknown;severity:"info"|"warning"|"error";recommendedFix:string;timestamp:string;modelVersion:null;confidence:null;relevantFiles:string[]};
/** One real decode pass; content heuristics are flags, never factual or rights approvals. */
export async function inspectStudioMedia(file:string,config:{ffmpeg:string;ffprobe:string},expected?:{width:number;height:number;duration:number}){
 const timestamp=new Date().toISOString(),findings:Finding[]=[];
 const add=(criterion:string,status:Finding["status"],evidence:unknown,severity:Finding["severity"]="error",recommendedFix="")=>findings.push({criterion,status,evidence,severity,recommendedFix,timestamp,modelVersion:null,confidence:null,relevantFiles:[file]});
 const probe=await runProcess(config.ffprobe,["-v","error","-show_format","-show_streams","-of","json",file],{timeoutMs:60000});
 let data:any=null;try{data=JSON.parse(probe.stdout);}catch{}
 const video=data?.streams?.find((s:any)=>s.codec_type==="video"),audio=data?.streams?.find((s:any)=>s.codec_type==="audio"),duration=Number(data?.format?.duration||0);
 add("container_and_codec",probe.code===0&&video?.codec_name==="h264"&&audio?.codec_name==="aac"&&duration>0?"pass":"fail",{probeExit:probe.code,video:video?.codec_name,audio:audio?.codec_name,duration},"error","Re-encode the existing timeline");
 if(expected){add("resolution",video?.width===expected.width&&video?.height===expected.height?"pass":"fail",{actual:[video?.width,video?.height],expected:[expected.width,expected.height]},"error","Reframe / encode only");add("duration",Math.abs(duration-expected.duration)<=Math.max(.25,expected.duration*.005)?"pass":"fail",{actual:duration,expected:expected.duration},"error","Check timeline boundaries and encode only");}
 const decode=await runProcess(config.ffmpeg,["-hide_banner","-nostats","-v","info","-i",file,"-vf","blackdetect=d=0.5:pix_th=0.08,freezedetect=n=-50dB:d=2","-af","silencedetect=n=-45dB:d=0.8,loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json","-f","null","-"],{timeoutMs:900000});
 add("full_decode",decode.code===0?"pass":"fail",{exitCode:decode.code,errorTail:decode.code?decode.stderr.slice(-2000):null},"error","Re-encode the existing timeline; preserve original files");
 const black=[...decode.stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)].map(m=>({start:Number(m[1]),end:Number(m[2]),duration:Number(m[3])}));
 const freezes=[...decode.stderr.matchAll(/freeze_start:\s*([\d.]+)/g)].map(m=>({start:Number(m[1])}));
 const silence=[...decode.stderr.matchAll(/silence_start:\s*([\d.]+)/g)].map(m=>({start:Number(m[1])}));
 add("black_intervals",decode.code===0&&!black.length?"pass":"unknown",black,"warning","Inspect flagged clips; replace or trim only affected intervals");
 add("freeze_candidates",decode.code===0&&!freezes.length?"pass":"unknown",{intervals:freezes,note:"Static original graphics may be intentional; review their visual pacing"},"warning","Review static / frozen footage in context");
 add("silence_candidates",decode.code===0&&!silence.length?"pass":"unknown",silence,"warning","Listen to pauses; repair only unintended silence");
 const loudnessText=decode.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0];let loudness:any=null;try{if(loudnessText)loudness=JSON.parse(loudnessText);}catch{}
 const integrated=Number(loudness?.input_i),peak=Number(loudness?.input_tp);
 add("audio_loudness",loudness&&Number.isFinite(integrated)&&integrated>=-20&&integrated<=-12&&Number.isFinite(peak)&&peak<=-.5?"pass":"unknown",loudness,"warning","Adjust mix / normalize without generating new voice");
 const technical=findings.filter(f=>f.severity==="error").every(f=>f.status==="pass");
 return {technical,findings,heuristicsRequireReview:findings.some(f=>f.severity==="warning"&&f.status!=="pass"),duration,video,audio,measuredAt:timestamp};
}
