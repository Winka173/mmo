import * as fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import type {Timeline} from "@ttm/core";
import {hash,type StudioRun} from "@ttm/automation";
import {renderTimeline,type RunResult} from "@ttm/media";
import type {Ctx} from "./context.js";
/** Scoped execution never invokes an AI engine; immutable parent files are read only. */
export async function executeStudioRepair(ctx:Ctx,run:StudioRun,timeline:Timeline,dir:string,command:(bin:string,args:string[],timeout?:number)=>Promise<RunResult>){
 if(!run.repair||!run.parentId)throw new Error("Repair ancestry unavailable");
 const saved=JSON.parse(await fs.readFile(path.join(dir,"repair-plan.json"),"utf8")),{selected,parentVersion,executionTimelineHash,sha256,...plan}=saved;
 if(hash(plan)!==run.repair.planSha256||sha256!==run.repair.planSha256||parentVersion!==run.parentId||selected?.kind!==run.repair.kind||hash(timeline)!==executionTimelineHash)throw new Error("Repair plan or track timeline changed after enqueue");
 const parentDir=ctx.store.p("studio","artifacts",run.parentId);
 if(run.repair.kind==="mix"){
  const video=path.join(parentDir,"final.mp4"),qa=JSON.parse(await fs.readFile(path.join(parentDir,"qa.json"),"utf8"));
  const sha=createHash("sha256");for await(const chunk of createReadStream(video))sha.update(chunk);
  if(!qa.videoSha256||sha.digest("hex")!==qa.videoSha256)throw new Error("Parent video changed; use the encode repair with pinned track sources");
  // Copy the encoded video stream exactly; only existing audio is normalized/encoded.
  await command(run.config.ffmpeg,["-y","-i",video,"-map","0:v:0","-map","0:a:0","-c:v","copy","-af","loudnorm=I=-16:TP=-1.5:LRA=11","-c:a","aac","-movflags","+faststart","final.mp4"]);
  for(const file of ["captions.srt","captions.ass"]){const source=path.join(parentDir,file);if(await fs.stat(source).catch(()=>null))await fs.copyFile(source,path.join(dir,file));}
 }else{
  await renderTimeline(timeline,{dir,ffmpeg:run.config.ffmpeg,run:command});
 }
 return{kind:run.repair.kind,attempt:run.repair.attempt,aiRequests:0,parentPreserved:true,videoStreamCopied:run.repair.kind==="mix"};
}
