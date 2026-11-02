import * as fs from "node:fs/promises";
import {randomUUID,createHash} from "node:crypto";
import sharp from "sharp";
import {BrandPresetStore} from "@ttm/automation";
import {getStore} from "../../../lib/data";
export const dynamic="force-dynamic";
export async function GET(){return Response.json({presets:await new BrandPresetStore(await getStore()).list()});}
export async function POST(request:Request){
 if(request.headers.get("origin")!==`http://${request.headers.get("host")}`)return Response.json({error:"Invalid origin"},{status:403});
 try{const store=await getStore();
  if(request.headers.get("content-type")?.includes("multipart/form-data")){
   const form=await request.formData(),file=form.get("logo"),evidence=String(form.get("rightsEvidence")??"").trim();
   if(!(file instanceof File)||file.size>4*1024*1024||evidence.length<12)throw new Error("Select a logo under 4 MB and describe your rights / Chọn logo dưới 4 MB và ghi quyền sử dụng");
   const input=sharp(Buffer.from(await file.arrayBuffer()),{limitInputPixels:16000000}),meta=await input.metadata();if(!["png","webp","jpeg"].includes(meta.format??""))throw new Error("Choose a PNG, WebP or JPEG logo");
   const bytes=await input.resize({width:1024,height:1024,fit:"inside",withoutEnlargement:true}).png().toBuffer(),id=randomUUID(),folder=store.p("studio","artifacts",id);await fs.mkdir(folder,{recursive:true});const destination=store.p("studio","artifacts",id,"brand-logo.png");await fs.writeFile(destination,bytes,{flag:"wx"});
   return Response.json({logo:{file:destination,sha256:createHash("sha256").update(bytes).digest("hex"),rightsEvidence:evidence},preview:`/api/studio/media/${id}/brand-logo.png`});
  }
  return Response.json(await new BrandPresetStore(store).save(await request.json()));
 }catch(error:any){return Response.json({error:error.message},{status:400});}
}
