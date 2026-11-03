import {z} from "zod";
import {PageInboxStore} from "@ttm/automation";
import {getStore} from "../../../lib/data";
export const dynamic="force-dynamic";
export async function GET(){return Response.json({items:(await new PageInboxStore(await getStore()).list()).reverse()},{headers:{"Cache-Control":"no-store"}});}
const B=z.discriminatedUnion("action",[z.object({action:z.literal("sync"),channelId:z.string().uuid()}),z.object({action:z.literal("approve"),id:z.string(),text:z.string()}),z.object({action:z.literal("dismiss"),id:z.string()})]);
export async function POST(request:Request){try{const b=B.parse(await request.json()),inbox=new PageInboxStore(await getStore());
 if(b.action==="sync")return Response.json(await inbox.requestSync(b.channelId));if(b.action==="approve")return Response.json(await inbox.approve(b.id,b.text));return Response.json(await inbox.dismiss(b.id));
}catch(e){return Response.json({error:e instanceof z.ZodError?"Invalid request":e instanceof Error?e.message.slice(0,300):"Failed"},{status:400});}}
