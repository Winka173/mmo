import {createHash} from "node:crypto";
import * as fs from "node:fs/promises";
import {ImageStore,hash} from "@ttm/automation";
import {FactoryError} from "@ttm/core";
import {writeJsonAtomic} from "@ttm/storage";
import sharp from "sharp";
import {invokeLocalEngine} from "./local-engine.js";
import type {Ctx} from "./context.js";
export async function executeImage(ctx:Ctx,id:string){
 const images=new ImageStore(ctx.store);let row=await images.get(id);if(!row)throw new Error("Image request not found");if(row.configHash!==hash(row.config))throw new Error("Image config hash mismatch");const output=images.output(id);
 if(row.state==="ready"){if(createHash("sha256").update(await fs.readFile(output)).digest("hex")!==row.sha256){await images.save({...row,state:"failed",error:"Generated image bytes changed; create a new version"});throw new FactoryError("QUALITY_LOCK","HUMAN_REQUIRED","Generated image bytes changed; create a new version");}return {imageId:id,state:"ready",cached:true};}
 row=await images.save({...row,state:"running",error:null});
 try{
  const request=ctx.store.p("studio","images",`${id}.request.json`),evidenceFile=ctx.store.p("studio","images",`${id}.evidence.json`);
  // Recover only a fully validated completed artifact, never overwrite a previous image.
  let evidence=await fs.readFile(evidenceFile,"utf8").then(JSON.parse,()=>null);
  if(!evidence){if(await fs.stat(output).catch(()=>null))throw new FactoryError("QUALITY_LOCK","HUMAN_REQUIRED","Output exists without complete provenance; preserve it and create a new request");evidence=await invokeLocalEngine(ctx,row.config,{op:"image",...row.input,output},request);await writeJsonAtomic(evidenceFile,{...evidence,inputHash:hash(row.input),configHash:row.configHash});}
  else if(evidence.inputHash!==hash(row.input)||evidence.configHash!==row.configHash)throw new Error("Image checkpoint/provenance mismatch");
  const bytes=await fs.readFile(output),sha256=createHash("sha256").update(bytes).digest("hex"),metadata=await sharp(bytes).metadata(),stats=await sharp(bytes).stats();if(sha256!==evidence.output_sha256||metadata.format!=="png"||metadata.width!==row.input.width||metadata.height!==row.input.height)throw new Error("Image output hash/format/dimensions failed validation");
  const flat=stats.channels.every(c=>c.stdev<1);await images.save({...row,state:"ready",sha256,evidence:{...evidence,technical:{decode:true,dimensions:true,flatImage:flat,status:flat?"FLAGGED":"PASS"},editorialReview:"NOT_REVIEWED",factualEvidence:false},error:flat?"Flat image detected; visual review required":null});return {imageId:id,state:"ready",synthetic:true};
 }catch(error:any){const waiting=["GPU_BUSY","ENGINE_COOLDOWN","STUDIO_PAUSED"].includes(error.code);await images.save({...row,state:waiting?"queued":"failed",error:String(error.message??error)});throw error;}
}
