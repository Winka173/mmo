import path from "node:path";
import os from "node:os";
import * as fs from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {StudioPostStore} from "@ttm/automation";
import {writeMediaArchive} from "@ttm/media";
import {getStore} from "../../../../lib/data";
export const dynamic="force-dynamic";
/** Manual posting package for a post (also the only route for YouTube community posts). */
export async function GET(request:Request){
 const id=new URL(request.url).searchParams.get("id")??"";if(!/^[0-9a-f-]{36}$/.test(id))return new Response("Invalid id",{status:400});
 try{const b=await new StudioPostStore(await getStore()).exportBundle(id),out=path.join(os.tmpdir(),`acs-post-${randomUUID()}.zip`);await writeMediaArchive(out,b.root,b.entries as any);const bytes=await fs.readFile(out);await fs.rm(out,{force:true});
  return new Response(bytes,{headers:{"content-type":"application/zip","content-disposition":`attachment; filename="ACS-post-${id.slice(0,8)}.zip"`,"Cache-Control":"no-store"}});}
 catch(e){return Response.json({error:e instanceof Error?e.message:"Failed"},{status:404});}
}
