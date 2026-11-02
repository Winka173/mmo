import * as fs from "node:fs/promises";
import sharp from "sharp";
import {StudioMediaCatalog,StudioStore} from "@ttm/automation";
import {runProcess,probeMedia} from "@ttm/media";
import {withLock} from "@ttm/storage";
import {getStore} from "../../../lib/data";
import {serveFile} from "../../../lib/serve";
export const dynamic="force-dynamic";
const safeTask=({config:_,configHash:__,sourceFile:___,...row}:any)=>row;
export async function GET(request:Request){
 try{
  const url=new URL(request.url),runId=url.searchParams.get("runId")??"",sourceSha=url.searchParams.get("sha256")??"",view=url.searchParams.get("view")??"list",store=await getStore(),catalog=new StudioMediaCatalog(store);
  if(view==="list")return Response.json({assets:await catalog.list(runId),visions:(await catalog.visions(runId)).map(safeTask)},{headers:{"cache-control":"private, no-store"}});
  if(view==="manifest")return Response.json(await catalog.manifest(runId),{headers:{"content-disposition":'attachment; filename="acs-media.json"',"cache-control":"private, no-store"}});
  if(view==="vision-frame"){const task=await catalog.vision(url.searchParams.get("taskId")??""),index=Number(url.searchParams.get("index"));if(!task||task.runId!==runId||task.state!=="ready"||!Number.isInteger(index)||index<0||index>2||!(task.result?.frames as any[])?.[index])throw new Error("Vision frame unavailable");await catalog.source(task.runId,task.sourceSha256);return serveFile(request,store.p("studio","media-vision",task.id,`frame-${index}.jpg`));}
  if(view!=="thumbnail"&&view!=="source")throw new Error("Unsupported media view");
  const {source}=await catalog.source(runId,sourceSha);
  if(view==="source")return serveFile(request,source.file);
  const target=store.p("studio","media-thumbnails",`${sourceSha}.jpg`);
  await withLock(store.p("locks",`studio-thumbnail-${sourceSha}.lock`),async()=>{
   if(await fs.stat(target).catch(()=>null))return;await fs.mkdir(store.p("studio","media-thumbnails"),{recursive:true});
   const temporary=target.replace(/\.jpg$/,".tmp.jpg");
   if(/\.(mp4|mov|mkv|webm)$/i.test(source.file)){const config=await new StudioStore(store).config(),result=await runProcess(config.ffmpeg,["-y","-i",source.file,"-frames:v","1","-vf","scale=400:225:force_original_aspect_ratio=decrease","-threads","2","-q:v","4",temporary],{timeoutMs:30000});if(result.code!==0)throw new Error("Thumbnail generation failed; check FFmpeg in Models & Tools");}
   else await sharp(source.file,{limitInputPixels:40000000}).rotate().resize({width:400,height:225,fit:"inside",withoutEnlargement:true}).jpeg({quality:80}).toFile(temporary);
   await fs.rename(temporary,target);
  });
  return serveFile(request,target);
 }catch(error:any){return Response.json({error:error.message},{status:400});}
}
export async function POST(request:Request){
 if(request.headers.get("origin")!==`http://${request.headers.get("host")}`)return Response.json({error:"Invalid origin"},{status:403});
 try{
  const {action,...input}=await request.json(),catalog=new StudioMediaCatalog(await getStore());
  if(action==="suggest")return Response.json(safeTask(await catalog.enqueueVision(input)));
  if(action!=="save")throw new Error("Unsupported media action");
  if(input.segments?.length){const {source}=await catalog.source(input.runId,input.sha256),config=await new StudioStore(catalog.store).config(),probe=await probeMedia(source.file,config.ffprobe);if(!probe.hasVideo||input.segments.some((scene:any)=>typeof scene.endSec!=="number"||scene.endSec>probe.durationSec+.001))throw new Error("Scene interval exceeds actual source duration");}
  return Response.json(await catalog.save(input));
 }catch(error:any){return Response.json({error:error.message},{status:400});}
}
