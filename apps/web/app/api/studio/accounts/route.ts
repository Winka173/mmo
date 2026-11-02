import {z} from "zod";
import {AccountKeysStore,FileQueue} from "@ttm/automation";
import {randomUUID} from "node:crypto";
import {getStore} from "../../../lib/data";
export const dynamic="force-dynamic";
export const runtime="nodejs";
const headers={"Cache-Control":"no-store","Referrer-Policy":"no-referrer"};
/** The only endpoint that accepts credentials. Responses never contain a stored secret value. */
export async function GET(){return Response.json(await new AccountKeysStore(await getStore()).overview(),{headers});}
const Mutation=z.discriminatedUnion("action",[
 z.object({action:z.literal("save"),id:z.string().max(80),values:z.record(z.string().max(8000))}).strict(),
 z.object({action:z.literal("remove"),id:z.string().max(200)}).strict(),
 z.object({action:z.literal("test"),id:z.string().max(80)}).strict(),
 z.object({action:z.literal("channel-credentials"),channelId:z.string().uuid(),values:z.record(z.string().max(8000))}).strict(),
 z.object({action:z.literal("channel-test"),channelId:z.string().uuid()}).strict(),
 z.object({action:z.literal("telegram"),enabled:z.boolean(),chatIds:z.string().max(2000),userIds:z.string().max(2000)}).strict(),
]);
export async function POST(request:Request){
 try{
  const body=Mutation.parse(await request.json()),store=await getStore(),accounts=new AccountKeysStore(store);
  switch(body.action){
   case "save":return Response.json(await accounts.save(body.id,body.values),{headers});
   case "remove":return Response.json(await accounts.remove(body.id),{headers});
   case "test":return Response.json(await accounts.test(body.id),{headers});
   case "channel-credentials":{const row=await accounts.saveChannelCredentials(body.channelId,Object.fromEntries(Object.entries(body.values).map(([k,v])=>[k,v.trim()]).filter(([,v])=>v)));return Response.json({ok:true,revision:row.revision},{headers});}
   case "channel-test":{const job=await new FileQueue(store).enqueue({kind:"STUDIO_CHANNEL_CHECK",idempotencyKey:`channel-check:${body.channelId}:${randomUUID()}`,payload:{channelId:body.channelId},usesGpu:false});return Response.json({ok:true,jobId:job.job.id},{headers});}
   case "telegram":return Response.json(await accounts.saveTelegramPolicy(body),{headers});
  }
 }catch(error){
  // Validation messages never include submitted values.
  const message=error instanceof z.ZodError?"Invalid request":error instanceof Error?error.message:"Request failed";
  return Response.json({error:message.slice(0,300)},{status:400,headers});
 }
}
