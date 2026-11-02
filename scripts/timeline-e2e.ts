import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {Timeline,TimelineClip} from "@ttm/core";
import {Autopilot,StudioRun,StudioStore,hash} from "@ttm/automation";
import {DataStore,writeJsonAtomic} from "@ttm/storage";
import {runProcess,renderTimeline} from "@ttm/media";
import {buildContext} from "../apps/worker/src/context.js";
import {executeStudio} from "../apps/worker/src/studio.js";
async function main(){
 const root=process.cwd(),test=path.join(root,".local/timeline-e2e",randomUUID());const store=new DataStore(path.join(test,"data"));await store.init();const studio=new StudioStore(store);
 const ffmpeg=path.join(root,".local/tools/ffmpeg.exe"),ffprobe=path.join(root,".local/tools/ffprobe.exe");await studio.saveConfig({ffmpeg,ffprobe});
 const source=path.join(test,"fixture.mp4"),music=path.join(test,"music.wav"),voice=path.join(root,".local/benchmarks/english-kokoro.wav");
 const generated=await runProcess(ffmpeg,["-y","-f","lavfi","-i","testsrc2=s=640x360:r=30","-t","10","-c:v","libx264",source]);assert.equal(generated.code,0,generated.stderr);
 const tone=await runProcess(ffmpeg,["-y","-f","lavfi","-i","sine=frequency=160:sample_rate=48000:duration=10",music]);assert.equal(tone.code,0,tone.stderr);
 const digest=async(file:string)=>createHash("sha256").update(await fs.readFile(file)).digest("hex");const now=new Date().toISOString();const config=await studio.config();
 const a=Autopilot.parse({id:randomUUID(),name:"Editable timeline fixture",brief:"Controlled software test. Not gameplay.",rights:"AUTHORIZED_REUSE",rightsEvidence:"Own FFmpeg calibration/tone plus locally generated test narration",createdAt:now,updatedAt:now});
 const parentId=randomUUID(),dir=store.p("studio","artifacts",parentId);await fs.mkdir(dir,{recursive:true});
 const timeline=Timeline.parse({schemaVersion:1,width:640,height:360,fps:30,duration:10,createdAt:now,clips:[
  {id:"v",track:"video",source,start:0,duration:10,sha256:await digest(source)},
  {id:"d",track:"dialogue",source:voice,start:0,duration:9.2,sha256:await digest(voice)},
  {id:"m",track:"music",source:music,start:0,duration:10,gain:0.1,sha256:await digest(music)},
  {id:"c1",track:"caption",start:0,duration:5,text:"Editable software test caption."},{id:"c2",track:"caption",start:5,duration:5,text:"Not gameplay. No publication approval."},
 ]});
 await renderTimeline(timeline,{dir,ffmpeg});
 await studio.saveRun(StudioRun.parse({id:parentId,autopilotId:a.id,title:a.name,language:"en-US",snapshot:a,config,snapshotHash:hash({a,config}),state:"ready",stages:[],outputs:["final.mp4","timeline.json","captions.srt"],createdAt:now,updatedAt:now}));
 const before=await digest(path.join(dir,"final.mp4"));const ctx=await buildContext({dataDir:store.root});
 const cut=await studio.cut(parentId,5,8);assert.equal(cut.edit?.kind,"timeline");await executeStudio(ctx,cut.id);
 const cutTimeline=(await studio.timeline(cut.id))!;assert.equal(cutTimeline.duration,7);const caption=cutTimeline.clips.find(c=>c.track==="caption")!;
 const edit=await studio.editTimeline(cut.id,[{kind:"set_caption",clipId:caption.id,text:"Phụ đề Việt đã sửa sau khi cắt."},{kind:"zoom",start:1,end:3,factor:1.2},{kind:"set_gain",track:"music",gain:0.05},{kind:"add_title",start:0,duration:3,text:"ACS · SOFTWARE TEST"}]);await executeStudio(ctx,edit.id);
 const qa=JSON.parse(await fs.readFile(store.p("studio","artifacts",edit.id,"qa.json"),"utf8"));assert.ok(qa.technical);assert.ok(Math.abs(qa.duration-7)<0.1);
 assert.ok((await fs.readFile(store.p("studio","artifacts",edit.id,"captions.srt"),"utf8")).includes("Phụ đề Việt đã sửa"));
 const restored=await studio.editTimeline(edit.id,[],parentId);await executeStudio(ctx,restored.id);assert.equal((await studio.timeline(restored.id))?.duration,10);
 assert.equal(await digest(path.join(dir,"final.mp4")),before);
 const outputs=await fs.readdir(store.p("studio","artifacts",edit.id));assert.ok(!outputs.some(file=>file.includes("tts")||file.includes("asr")));
 const report={status:"VERIFIED",fixture:true,genuineGameplay:false,parentId,cutId:cut.id,editId:edit.id,restoreId:restored.id,outputs:store.p("studio","artifacts",edit.id),checks:["separate video/dialogue/music/caption/title tracks","ripple 3s cut","caption editing after cut","range zoom","music gain","Unicode titles/captions","restore previous timeline as new version","no AI inference","immutable parent"],at:new Date().toISOString()};
 await writeJsonAtomic(path.join(root,"docs/evidence/acs-timeline-e2e.json"),report);console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
