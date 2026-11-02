import {z} from "zod";
import {ChannelStrategyStore} from "@ttm/automation";
import {getStore} from "../../../lib/data";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};
export async function GET(){const s=new ChannelStrategyStore(await getStore()),list=await s.list();return Response.json({strategies:await Promise.all(list.map(async r=>({...r,plan:await s.plan(r.id),performance:await s.performance(r.id)})))},{headers});}
const Body=z.discriminatedUnion("action",[z.object({action:z.literal("save"),value:z.record(z.any())}),z.object({action:z.literal("week"),id:z.string().uuid(),weekStart:z.string()}),z.object({action:z.literal("decide"),id:z.string().uuid(),itemId:z.string().uuid(),decision:z.enum(["approved","rejected"]),note:z.string().max(1000).default("")})]);
export async function POST(request:Request){
 try{const b=Body.parse(await request.json()),s=new ChannelStrategyStore(await getStore());
  if(b.action==="save")return Response.json(await s.save(b.value),{headers});
  if(b.action==="week")return Response.json(await s.generateWeek(b.id,b.weekStart),{headers});
  return Response.json(await s.decide(b.id,b.itemId,b.decision,b.note),{headers});
 }catch(e){return Response.json({error:e instanceof z.ZodError?e.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; ").slice(0,300):e instanceof Error?e.message:"Request failed"},{status:400,headers});}
}
