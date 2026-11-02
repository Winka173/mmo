import * as fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {BrandStyle,type TimelineClip} from "@ttm/core";
import {toAss,type Cue} from "./subtitles.js";
import type {RunResult} from "./exec.js";
export function brandAss(cues:Cue[],width:number,height:number,input:unknown,titles:Pick<TimelineClip,"start"|"duration"|"text">[]=[]){
 const brand=BrandStyle.parse(input??{});let ass=toAss(cues,{width,height,fontSize:Math.round(width*.052*brand.captionScale),marginV:Math.round(height*brand.captionMargin),fontName:brand.font,color:brand.captionColor});
 const stamp=(n:number)=>`${Math.floor(n/3600)}:${String(Math.floor(n/60)%60).padStart(2,"0")}:${(n%60).toFixed(2).padStart(5,"0")}`;
 const color=brand.accent.slice(1),bgr=color.slice(4,6)+color.slice(2,4)+color.slice(0,2);
 for(const title of titles)ass+=`Dialogue: 1,${stamp(title.start)},${stamp(title.start+title.duration)},Default,,0,0,0,,{\\an8\\fs${Math.round(width*.045)}\\c&H${bgr}&}${title.text.replace(/[{}\\\r\n]/g," ")}\n`;
 return ass;
}
export async function applyBrandLogo(brandInput:unknown,width:number,dir:string,ffmpeg:string,command:(bin:string,args:string[])=>Promise<RunResult>){
 const brand=BrandStyle.parse(brandInput??{});if(!brand.logo)return;
 if(!/\.(png|webp)$/i.test(brand.logo.file))throw new Error("Brand logo must be a PNG or WebP image");
 const state=createHash("sha256");for await(const chunk of createReadStream(brand.logo.file))state.update(chunk);if(state.digest("hex")!==brand.logo.sha256)throw new Error("Brand logo changed after approval; select a new pinned version");
 const w=Math.round(width*brand.logoWidth),margin=Math.round(width*.04),position=brand.logoCorner==="top_left"?`${margin}:${margin}`:`W-w-${margin}:${margin}`;
 await command(ffmpeg,["-y","-i","final.mp4","-i",brand.logo.file,"-filter_complex",`[1:v]scale=${w}:-1[logo];[0:v][logo]overlay=${position}:eof_action=repeat[v]`,"-map","[v]","-map","0:a:0","-c:v","libx264","-preset","fast","-crf","20","-pix_fmt","yuv420p","-c:a","copy","-movflags","+faststart","brand-final.mp4"]);
 await fs.rename(path.join(dir,"brand-final.mp4"),path.join(dir,"final.mp4"));
}
