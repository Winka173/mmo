import {it,expect} from "vitest";
import path from "node:path";
import * as fs from "node:fs/promises";
import {createHash} from "node:crypto";
import sharp from "sharp";
import {Timeline,applyTimelineEdits} from "@ttm/core";
import {renderTimeline,runProcess} from "../src/index.js";
import {tmpDir} from "../../storage/test/helpers.js";

it("keeps a real still-image timeline decodable after a ripple cut seeks past its sole input frame",async()=>{
 const dir=await tmpDir("acs-still-cut-"),source=path.join(dir,"owned.png"),before=await sharp({create:{width:640,height:360,channels:3,background:"#593c8d"}}).png().toBuffer();await fs.writeFile(source,before);
 const hash=createHash("sha256").update(before).digest("hex"),timeline=Timeline.parse({schemaVersion:1,width:640,height:360,fps:30,duration:10,createdAt:new Date().toISOString(),clips:[{id:"still",track:"video",source,sha256:hash,start:0,duration:10}]});
 const child=applyTimelineEdits(timeline,[{kind:"remove_range",start:5,end:8}]);expect(child.clips[1].sourceIn).toBe(8);expect(child.duration).toBe(7);
 const ffmpeg=path.join(process.cwd(),".local/tools/ffmpeg.exe"),ffprobe=path.join(process.cwd(),".local/tools/ffprobe.exe");
 await renderTimeline(child,{dir,ffmpeg});
 const result=await runProcess(ffprobe,["-v","error","-show_format","-show_streams","-of","json",path.join(dir,"final.mp4")]),probe=JSON.parse(result.stdout);
 expect(probe.streams.find((stream:any)=>stream.codec_type==="video")).toMatchObject({codec_name:"h264",width:640,height:360});expect(probe.streams.find((stream:any)=>stream.codec_type==="audio").codec_name).toBe("aac");expect(Number(probe.format.duration)).toBeCloseTo(7,1);
 const decode=await runProcess(ffmpeg,["-v","error","-i",path.join(dir,"final.mp4"),"-f","null","-"]);expect(decode.code).toBe(0);expect(decode.stderr.trim()).toBe("");expect(await fs.readFile(source)).toEqual(before);expect(timeline.duration).toBe(10);
},60000);
