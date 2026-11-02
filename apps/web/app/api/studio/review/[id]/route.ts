import {StudioReviewStore} from "@ttm/automation";
import {getStore} from "../../../../lib/data";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){try{return Response.json(await new StudioReviewStore(await getStore()).context((await params).id));}catch(error:any){return Response.json({error:error.message},{status:400});}}
