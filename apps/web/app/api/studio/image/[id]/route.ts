import {createHash} from "node:crypto";
import * as fs from "node:fs/promises";
import {ImageStore} from "@ttm/automation";
import {getStore} from "../../../../lib/data";
import {serveFile} from "../../../../lib/serve";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[a-f0-9-]{36}$/.test(id))return new Response("Invalid image ID",{status:400});const images=new ImageStore(await getStore()),row=await images.get(id);if(row?.state!=="ready")return new Response("Image not ready",{status:404});const bytes=await fs.readFile(images.output(id));if(createHash("sha256").update(bytes).digest("hex")!==row.sha256)return new Response("Image integrity check failed",{status:409});return serveFile(request,images.output(id));
}
