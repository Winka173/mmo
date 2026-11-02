import {StudioStore,studioContentInsights} from "@ttm/automation";
import {getStore} from "../../../lib/data";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{return Response.json(await studioContentInsights(new StudioStore(await getStore()),new URL(request.url).searchParams.get("runId")??""),{headers:{"cache-control":"private, no-store"}});}catch(error:any){return Response.json({error:error.message},{status:400});}}
