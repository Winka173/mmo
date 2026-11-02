import {randomUUID} from "node:crypto";
import {z} from "zod";
import {BrandStyle} from "./brand.js";
export const TrackKind=z.enum(["video","dialogue","music","sfx","caption","title"]);
export const TimelineClip=z.object({
 rightsEvidence:z.string().default(""),rightsExpiresAt:z.string().datetime().nullable().default(null),
 id:z.string(),track:TrackKind,start:z.number().nonnegative(),duration:z.number().positive(),source:z.string().default(""),sourceIn:z.number().nonnegative().default(0),sha256:z.string().default(""),text:z.string().max(6000).default(""),language:z.string().default(""),gain:z.number().min(0).max(4).default(1),zoom:z.number().min(1).max(2.5).default(1),
});
export type TimelineClip=z.infer<typeof TimelineClip>;
export const Timeline=z.object({schemaVersion:z.literal(1),width:z.number().int().positive(),height:z.number().int().positive(),fps:z.number().min(1).max(120),duration:z.number().positive(),clips:z.array(TimelineClip).max(400),captionTiming:z.enum(["estimated","aligned","manually_edited"]).default("estimated"),brand:BrandStyle.optional(),createdAt:z.string()});
export type Timeline=z.infer<typeof Timeline>;
export const EditOperation=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("remove_range"),start:z.number().nonnegative(),end:z.number().positive()}),
 z.object({kind:z.literal("set_caption"),clipId:z.string(),text:z.string().min(1).max(1000)}),
 z.object({kind:z.literal("set_caption_timing"),clipId:z.string(),start:z.number().nonnegative(),end:z.number().positive()}),
 z.object({kind:z.literal("set_gain"),track:z.enum(["dialogue","music","sfx"]),gain:z.number().min(0).max(4)}),
 z.object({kind:z.literal("zoom"),start:z.number().nonnegative(),end:z.number().positive(),factor:z.number().min(1).max(2.5)}),
 z.object({kind:z.literal("move_clip"),clipId:z.string(),start:z.number().nonnegative()}),
 z.object({kind:z.literal("trim_clip"),clipId:z.string(),inSeconds:z.number().nonnegative(),outSeconds:z.number().positive()}),
 z.object({kind:z.literal("add_title"),start:z.number().nonnegative(),duration:z.number().positive().max(30),text:z.string().min(1).max(150)}),
 z.object({kind:z.literal("add_audio"),track:z.enum(["music","sfx"]),start:z.number().nonnegative(),duration:z.number().positive(),source:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/),gain:z.number().min(0).max(4),rightsEvidence:z.string().trim().min(12).max(6000),rightsExpiresAt:z.string().datetime().nullable().default(null)}),
]);
export type EditOperation=z.infer<typeof EditOperation>;
const epsilon=0.0001;
/** Ripple all tracks together; audio/video source offsets always preserve original meaning. */
export function applyTimelineEdits(input:Timeline,operations:EditOperation[]):Timeline{
 let timeline=Timeline.parse(structuredClone(input));
 for(const raw of operations){const op=EditOperation.parse(raw);
  if(op.kind==="remove_range"){
   if(op.end<=op.start||op.end>timeline.duration||op.end-op.start>=timeline.duration-epsilon)throw new Error("Cut must preserve some content and stay inside the timeline");
   const removed=op.end-op.start;const result:TimelineClip[]=[];
   for(const clip of timeline.clips){const stop=clip.start+clip.duration;
    if(stop<=op.start){result.push(clip);continue;}if(clip.start>=op.end){result.push({...clip,start:clip.start-removed});continue;}
    const left=Math.max(0,op.start-clip.start),right=Math.max(0,stop-op.end);
    const words=clip.text.split(/\s+/).filter(Boolean);
    if(left>epsilon)result.push({...clip,duration:left,text:clip.track==="caption"?words.slice(0,Math.max(1,Math.round(words.length*left/clip.duration))).join(" "):clip.text});
    if(right>epsilon)result.push({...clip,id:left>epsilon?randomUUID():clip.id,start:Math.max(clip.start,op.end)-removed,duration:right,sourceIn:clip.sourceIn+Math.max(0,op.end-clip.start),text:clip.track==="caption"?words.slice(Math.min(words.length-1,Math.floor(words.length*(clip.duration-right)/clip.duration))).join(" "):clip.text});
   }timeline.clips=result;timeline.duration-=removed;
  }else if(op.kind==="set_caption"){
   const clip=timeline.clips.find(c=>c.id===op.clipId&&c.track==="caption");if(!clip)throw new Error("Caption not found");clip.text=op.text;timeline.captionTiming="manually_edited";
  }else if(op.kind==="set_caption_timing"){
   const clip=timeline.clips.find(c=>c.id===op.clipId&&c.track==="caption");if(!clip)throw new Error("Caption not found");
   if(op.end<=op.start||op.end>timeline.duration+epsilon)throw new Error("Caption timing is outside the video");
   if(timeline.clips.some(c=>c.track==="caption"&&c.id!==clip.id&&op.start<c.start+c.duration-epsilon&&op.end>c.start+epsilon))throw new Error("Caption timing overlaps another caption; adjust its neighbor first");
   clip.start=op.start;clip.duration=op.end-op.start;timeline.captionTiming="manually_edited";
  }else if(op.kind==="set_gain")timeline.clips=timeline.clips.map(c=>c.track===op.track?{...c,gain:op.gain}:c);
  else if(op.kind==="add_audio"){
   if(op.start+op.duration>timeline.duration+epsilon)throw new Error("Audio is outside the video");if(op.rightsExpiresAt&&Date.parse(op.rightsExpiresAt)<=Date.now())throw new Error("Audio license has expired");timeline.clips.push(TimelineClip.parse({...op,id:randomUUID()}));
  }else if(op.kind==="add_title"){
   if(op.start+op.duration>timeline.duration+epsilon)throw new Error("Title is outside the video");timeline.clips.push(TimelineClip.parse({id:randomUUID(),track:"title",start:op.start,duration:op.duration,text:op.text}));
  }else if(op.kind==="zoom"){
   if(op.end<=op.start||op.end>timeline.duration+epsilon)throw new Error("Zoom range is outside the video");
   timeline.clips=timeline.clips.flatMap(c=>{
    if(c.track!=="video"||c.start>=op.end||c.start+c.duration<=op.start)return[c];
    const boundaries=[c.start,...[op.start,op.end].filter(t=>t>c.start&&t<c.start+c.duration),c.start+c.duration];
    return boundaries.slice(0,-1).map((start,i)=>({...c,id:i===0?c.id:randomUUID(),start,duration:boundaries[i+1]-start,sourceIn:c.sourceIn+start-c.start,zoom:start>=op.start&&start<op.end?op.factor:c.zoom}));
   });
  }else{
   const clip=timeline.clips.find(c=>c.id===op.clipId);if(!clip)throw new Error("Clip not found");
   if(op.kind==="move_clip"){if(op.start+clip.duration>timeline.duration+epsilon)throw new Error("Move is outside the timeline");clip.start=op.start;}
   else{if(op.outSeconds<=op.inSeconds||op.outSeconds>clip.duration+epsilon)throw new Error("Trim is outside the clip");clip.sourceIn+=op.inSeconds;clip.start+=op.inSeconds;clip.duration=op.outSeconds-op.inSeconds;}
  }
 }
 // Video overlap is ambiguous; the initial editor uses one video lane plus title/caption overlays.
 const video=timeline.clips.filter(c=>c.track==="video").sort((a,b)=>a.start-b.start);
 for(let i=1;i<video.length;i++)if(video[i].start<video[i-1].start+video[i-1].duration-epsilon)throw new Error("Video clips overlap; move or trim to keep one video lane");
 return Timeline.parse(timeline);
}

const seconds=(v:string)=>v.includes(":")?v.split(":").map(Number).reduce((a,b)=>a*60+b,0):Number(v);
export function planTimelinePrompt(prompt:string,timeline:Timeline):{summary:string;operations:EditOperation[];changesClaims:false}{
 const range="(\\d{1,2}:\\d{2}(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)";
 const cut=new RegExp(`^(?:cut|cắt)\\s+${range}\\s*[-–]\\s*${range}\\s*$`,"i").exec(prompt.trim());
 if(cut)return{summary:"Remove the selected interval and ripple all tracks",operations:[{kind:"remove_range",start:seconds(cut[1]),end:seconds(cut[2])}],changesClaims:false};
 const zoom=new RegExp(`^(?:zoom|phóng to)(?:\\s+.+?)?\\s+${range}\\s*[-–]\\s*${range}(?:\\s+(\\d+(?:\\.\\d+)?)x)?$`,"i").exec(prompt.trim());
 if(zoom)return{summary:"Center zoom during the selected interval; no object detection. Retain dialogue and claims",operations:[{kind:"zoom",start:seconds(zoom[1]),end:seconds(zoom[2]),factor:zoom[3]?Number(zoom[3]):1.15}],changesClaims:false};
 if(/^(make (?:it|the intro) more exciting|make (?:it|the intro) more suspenseful|làm (?:hấp dẫn|hào hứng|hồi hộp) hơn)$/i.test(prompt.trim()))return{summary:"Add a controlled punch-in during the opening; reduce music under dialogue; keep script and factual claims unchanged",operations:[{kind:"zoom",start:0,end:Math.min(3,timeline.duration),factor:1.15},{kind:"set_gain",track:"music",gain:0.12}],changesClaims:false};
 throw new Error("Use Cut 00:05–00:08, Zoom 00:02–00:04 1.2x, or Make it more exciting / Dùng lệnh cắt, zoom hoặc làm hấp dẫn hơn");
}
