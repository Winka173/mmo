import {SemanticStore} from "@ttm/automation";
import {getStore} from "../../../lib/data";
export const dynamic="force-dynamic";
export async function GET(){const registry=new SemanticStore(await getStore()),tasks=(await registry.tasks()).slice(0,12).map(({config:_,configHash:__,...task})=>task);return Response.json({index:await registry.summary(),tasks},{headers:{"cache-control":"private, no-store"}});}
export async function POST(request:Request){
 if(request.headers.get("origin")!==`http://${request.headers.get("host")}`)return Response.json({error:"Invalid origin"},{status:403});
 try{const task=await new SemanticStore(await getStore()).enqueue(await request.json());const {config:_,configHash:__,...safe}=task;return Response.json(safe);}catch(error:any){return Response.json({error:error.message},{status:400});}
}
