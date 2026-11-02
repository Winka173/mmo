import {StudioStore} from "@ttm/automation";
import {getStore} from "../../../../lib/data";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[a-f0-9-]{36}$/.test(id))return Response.json({error:"Invalid version"},{status:400});
 const timeline=await new StudioStore(await getStore()).timeline(id);if(!timeline)return Response.json({error:"No editable timeline in this version"},{status:404});
 return Response.json(timeline,{headers:{"cache-control":"private, no-store"}});
}
