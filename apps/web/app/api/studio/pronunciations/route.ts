import {GlobalPronunciationStore} from "@ttm/automation";
import {getStore} from "../../../lib/data";
export const dynamic="force-dynamic";
export async function GET(){return Response.json({entries:await new GlobalPronunciationStore(await getStore()).list()},{headers:{"Cache-Control":"no-store"}});}
export async function POST(request:Request){try{const body=await request.json();return Response.json({entries:await new GlobalPronunciationStore(await getStore()).save(body.entries)});}catch(e){return Response.json({error:e instanceof Error?e.message.slice(0,300):"Invalid"},{status:400});}}
