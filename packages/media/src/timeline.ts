import * as fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {Timeline,type TimelineClip} from "@ttm/core";
import {toAss,toSrt} from "./subtitles.js";
import {runProcess,type RunResult} from "./exec.js";
import {writeJsonAtomic} from "@ttm/storage";
import {brandAss,applyBrandLogo} from "./branding.js";

/** Deterministic render from separate source tracks. No AI inference occurs here. */
export async function renderTimeline(input:Timeline,options:{dir:string;ffmpeg:string;run?:(bin:string,args:string[],timeout?:number)=>Promise<RunResult>}){
 const timeline=Timeline.parse(input),dir=options.dir;await fs.mkdir(dir,{recursive:true});
 const command=options.run??(async(bin,args)=>{const r=await runProcess(bin,args,{cwd:dir});if(r.code!==0)throw new Error(r.stderr.slice(-1800));return r;});
 const sourceHashes=new Map<string,string>();
 for(const clip of timeline.clips.filter(c=>!!c.source)){
  if(clip.rightsExpiresAt&&Date.parse(clip.rightsExpiresAt)<=Date.now())throw new Error(`Timeline source license expired: ${clip.id}`);
  let digest=sourceHashes.get(clip.source);if(!digest){const h=createHash("sha256");for await(const chunk of createReadStream(clip.source))h.update(chunk);digest=h.digest("hex");sourceHashes.set(clip.source,digest);}
  if(clip.sha256&&digest!==clip.sha256)throw new Error(`Timeline source hash changed: ${clip.id}`);
 }
 const video=timeline.clips.filter(c=>c.track==="video").sort((a,b)=>a.start-b.start);
 const sequence:(TimelineClip|null)[]=[];const durations:number[]=[];let at=0;
 for(const c of video){if(c.start>at+0.001){sequence.push(null);durations.push(c.start-at);}sequence.push(c);durations.push(c.duration);at=c.start+c.duration;}
 if(at<timeline.duration-0.001){sequence.push(null);durations.push(timeline.duration-at);}
 if(!sequence.length){sequence.push(null);durations.push(timeline.duration);}
 for(let i=0;i<sequence.length;i++){
  const clip=sequence[i],filename=`edit-video-${i}.mp4`,duration=durations[i];
  const base=`scale=${timeline.width}:${timeline.height}:force_original_aspect_ratio=decrease,pad=${timeline.width}:${timeline.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${timeline.fps}`;
  const zoom=clip&&clip.zoom>1?`,scale=trunc(iw*${clip.zoom}/2)*2:trunc(ih*${clip.zoom}/2)*2,crop=${timeline.width}:${timeline.height}`:"";
  // A still has one frame at timestamp zero. Seeking into it after a ripple cut
  // discards that frame and FFmpeg can exit zero with an empty MP4. Loop the
  // original frame for the bounded clip duration; sourceIn applies only to video.
  const still=clip&&/\.(png|jpe?g|webp)$/i.test(clip.source);
  const args=clip?(still?["-loop","1","-i",clip.source]:["-ss",String(clip.sourceIn),"-i",clip.source]):["-f","lavfi","-i",`color=c=0x171522:s=${timeline.width}x${timeline.height}:r=${timeline.fps}`];
  await command(options.ffmpeg,["-y",...args,"-t",String(duration),"-an","-vf",base+zoom+`,tpad=stop_mode=clone:stop_duration=${duration}`,"-c:v","libx264","-preset","fast","-crf","20","-pix_fmt","yuv420p",filename]);
 }
 await fs.writeFile(path.join(dir,"edit-concat.txt"),sequence.map((_,i)=>`file 'edit-video-${i}.mp4'`).join("\n"),"utf8");
 await command(options.ffmpeg,["-y","-f","concat","-safe","0","-i","edit-concat.txt","-an","-c:v","copy","edit-base.mp4"]);
 const audio=timeline.clips.filter(c=>["dialogue","music","sfx"].includes(c.track)&&!!c.source&&c.gain>0);
 if(audio.length>36)throw new Error("A timeline render supports at most 36 audio clips; split the project into chapters");
 const filters=audio.map((c,i)=>`[${i+1}:a]atrim=start=${c.sourceIn}:duration=${c.duration},asetpts=PTS-STARTPTS,volume=${c.gain},adelay=${Math.round(c.start*1000)}:all=1[a${i}]`);
 filters.push(`[0:a]${audio.map((_,i)=>`[a${i}]`).join("")}amix=inputs=${audio.length+1}:normalize=0:duration=first,loudnorm=I=-16:TP=-1.5:LRA=11[mix]`);
 await command(options.ffmpeg,["-y","-f","lavfi","-i",`anullsrc=r=48000:cl=stereo:d=${timeline.duration}`,...audio.flatMap(c=>["-i",c.source]),"-filter_complex",filters.join(";"),"-map","[mix]","-t",String(timeline.duration),"-c:a","pcm_s16le","edit-mix.wav"]);
 const cues=timeline.clips.filter(c=>c.track==="caption").sort((a,b)=>a.start-b.start).map(c=>({start:c.start,end:c.start+c.duration,text:c.text}));
 await fs.writeFile(path.join(dir,"captions.srt"),toSrt(cues),"utf8");
 const ass=brandAss(cues,timeline.width,timeline.height,timeline.brand,timeline.clips.filter(c=>c.track==="title"));
 await fs.writeFile(path.join(dir,"captions.ass"),ass,"utf8");
 await command(options.ffmpeg,["-y","-i","edit-base.mp4","-i","edit-mix.wav","-map","0:v:0","-map","1:a:0","-vf","ass=captions.ass","-t",String(timeline.duration),"-c:v","libx264","-preset","fast","-crf","20","-pix_fmt","yuv420p","-c:a","aac","-movflags","+faststart","final.mp4"]);
 await applyBrandLogo(timeline.brand,timeline.width,dir,options.ffmpeg,command);
 await writeJsonAtomic(path.join(dir,"timeline.json"),timeline);return{duration:timeline.duration,videoClips:video.length,audioClips:audio.length,captionTiming:timeline.captionTiming};
}
