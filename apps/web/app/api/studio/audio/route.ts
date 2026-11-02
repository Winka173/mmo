import * as fs from "node:fs/promises";
import path from "node:path";
import {randomUUID,createHash} from "node:crypto";
import {StudioStore} from "@ttm/automation";
import {runProcess} from "@ttm/media";
import {getStore} from "../../../lib/data";
export async function POST(request:Request){
 if(request.headers.get("origin")!==`http://${request.headers.get("host")}`)return Response.json({error:"Invalid origin"},{status:403});
 let filePath:string|undefined;
 try{
  const bytes=Number(request.headers.get("content-length"));if(!bytes||bytes>64*1024*1024)throw new Error("Audio upload limit 64 MiB");
  const form=await request.formData(),file=form.get("file");if(!(file instanceof File))throw new Error("Select an audio file");
  const ext=path.extname(file.name).toLowerCase();if(![".wav",".mp3",".m4a",".flac",".ogg"].includes(ext))throw new Error("Unsupported audio format");
  const store=await getStore(),studio=new StudioStore(store),id=String(form.get("runId")),run=await studio.run(id),timeline=await studio.timeline(id);if(run?.state!=="ready"||!timeline)throw new Error("Select a completed editable version");
  const data=Buffer.from(await file.arrayBuffer());filePath=store.p("studio","audio-imports",`${randomUUID()}${ext}`);await fs.mkdir(path.dirname(filePath),{recursive:true});await fs.writeFile(filePath,data);
  const probe=await runProcess(run.config.ffprobe,["-v","error","-show_format","-show_streams","-of","json",filePath],{timeoutMs:30000});if(probe.code)throw new Error("Cannot decode the selected audio");const metadata=JSON.parse(probe.stdout);if(!metadata.streams.some((s:any)=>s.codec_type==="audio"))throw new Error("File has no audio stream");
  const start=Number(form.get("start")||0),available=Number(metadata.format.duration),requested=Number(form.get("duration")||available);if(!Number.isFinite(available)||available<=0)throw new Error("Audio duration unavailable");
  const child=await studio.editTimeline(id,[{kind:"add_audio",track:String(form.get("track")),start,duration:Math.min(available,requested,timeline.duration-start),source:filePath,sha256:createHash("sha256").update(data).digest("hex"),gain:Number(form.get("gain")??.15),rightsEvidence:String(form.get("rightsEvidence")||""),rightsExpiresAt:form.get("rightsExpiresAt")?new Date(String(form.get("rightsExpiresAt"))).toISOString():null}]);
  return Response.json(child);
 }catch(error:any){if(filePath)await fs.rm(filePath,{force:true}).catch(()=>{});return Response.json({error:error.message},{status:400});}
}
