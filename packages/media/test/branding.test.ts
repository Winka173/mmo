import {describe,it,expect} from "vitest";
import path from "node:path";
import * as fs from "node:fs/promises";
import {createHash} from "node:crypto";
import sharp from "sharp";
import {BrandStyle,Timeline} from "@ttm/core";
import {renderTimeline} from "../src/timeline.js";
import {runProcess} from "../src/exec.js";
import {tmpDir} from "../../storage/test/helpers.js";
describe("Pinned brand rendering (actual FFmpeg/libass)",()=>{
 it("renders a Vietnamese caption/font/color, CTA and owned logo while retaining original bytes",async()=>{
  const dir=await tmpDir("acs-brand-render-"),image=path.join(dir,"owned.png"),logo=path.join(dir,"logo.png"),tone=path.join(dir,"tone.wav"),ffmpeg=path.resolve(".local/tools/ffmpeg.exe"),ffprobe=path.resolve(".local/tools/ffprobe.exe");
  await sharp({create:{width:640,height:360,channels:3,background:"#20334a"}}).png().toFile(image);await sharp({create:{width:80,height:50,channels:4,background:"#ffb400"}}).png().toFile(logo);
  const original=await fs.readFile(image),logoBytes=await fs.readFile(logo);expect((await runProcess(ffmpeg,["-y","-f","lavfi","-i","sine=frequency=220:duration=2",tone])).code).toBe(0);
  const timeline=Timeline.parse({schemaVersion:1,width:640,height:360,fps:30,duration:2,createdAt:new Date().toISOString(),brand:{font:"Arial",accent:"#ffb400",captionColor:"#ffffff",cta:"Theo dõi dự án",logo:{file:logo,sha256:createHash("sha256").update(logoBytes).digest("hex"),rightsEvidence:"Owned generated test logo; no commercial claims"}},clips:[{id:"v",track:"video",source:image,start:0,duration:2},{id:"a",track:"dialogue",source:tone,start:0,duration:2},{id:"c",track:"caption",start:0,duration:2,text:"Phụ đề có dấu tiếng Việt"},{id:"cta",track:"title",start:1,duration:1,text:"Theo dõi dự án"}]});
  await renderTimeline(timeline,{dir,ffmpeg});const probe=await runProcess(ffprobe,["-v","error","-show_format","-show_streams","-of","json",path.join(dir,"final.mp4")]);const data=JSON.parse(probe.stdout);expect(data.streams.find((s:any)=>s.codec_type==="video").nb_frames).toBe("60");expect(Math.abs(Number(data.format.duration)-2)).toBeLessThan(.05);
  const ass=await fs.readFile(path.join(dir,"captions.ass"),"utf8");expect(ass).toContain("Theo dõi dự án");expect(ass).toContain("Phụ đề có dấu tiếng Việt");expect(await fs.readFile(image)).toEqual(original);expect(await fs.readFile(logo)).toEqual(logoBytes);
  await fs.appendFile(logo,"tampered");await expect(renderTimeline(timeline,{dir,ffmpeg})).rejects.toThrow("Brand logo changed");
 },60000);
 it("rejects unsafe typography/color and preserves optional brand backwards compatibility",()=>{
  expect(()=>BrandStyle.parse({font:"Arial,Injected"})).toThrow();expect(()=>BrandStyle.parse({accent:"red;evil"})).toThrow();expect(()=>BrandStyle.parse({logo:{file:"a.png",sha256:"0".repeat(64),rightsEvidence:"no"}})).toThrow();
 });
});
