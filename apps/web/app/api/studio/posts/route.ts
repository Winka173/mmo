import {z} from "zod";
import {StudioPostStore,StudioPublishingStore,postFingerprint,FileQueue} from "@ttm/automation";
import {getStore} from "../../../lib/data";
export const dynamic="force-dynamic";
const h={"Cache-Control":"no-store"};
export async function GET(){const store=await getStore(),posts=new StudioPostStore(store);const rows=await posts.list();
 return Response.json({posts:rows.map(p=>({...p,images:p.images.map(i=>({name:i.name,sha256:i.sha256,size:i.size})),fingerprint:postFingerprint(p),approved:posts.approved(p)})),channels:(await new StudioPublishingStore(store).channels()).map(c=>({id:c.id,name:c.name,platform:c.platform,enabled:c.enabled}))},{headers:h});}
const Json=z.discriminatedUnion("action",[z.object({action:z.literal("decide"),id:z.string().uuid(),category:z.enum(["editorial","rights"]),decision:z.enum(["APPROVED","REJECTED","DEFERRED"]),fingerprint:z.string(),evidence:z.string()}),z.object({action:z.literal("request"),id:z.string().uuid(),channelId:z.string().uuid(),privacy:z.enum(["private","public"]),authorize:z.literal(true)}),z.object({action:z.literal("check"),id:z.string().uuid(),channelId:z.string().uuid()})]);
export async function POST(request:Request){
 try{const store=await getStore(),posts=new StudioPostStore(store);
  if((request.headers.get("content-type")??"").startsWith("multipart/form-data")){const f=await request.formData(),files=await Promise.all(f.getAll("images").filter((x):x is File=>x instanceof File&&x.size>0).map(async x=>({name:x.name,bytes:Buffer.from(await x.arrayBuffer())})));
   return Response.json(await posts.create({title:f.get("title"),kind:f.get("kind"),text:f.get("text")??"",link:f.get("link")?String(f.get("link")):null,aiGenerated:f.get("aiGenerated")==="on"},files),{headers:h});}
  const b=Json.parse(await request.json());
  if(b.action==="decide")return Response.json(await posts.decide(b.id,b),{headers:h});
  if(b.action==="request")return Response.json(await posts.request(b.id,b),{headers:h});
  const job=await new FileQueue(store).enqueue({kind:"STUDIO_POST_CHECK",idempotencyKey:`post-check:${b.id}:${b.channelId}:${Date.now()}`,payload:{postId:b.id,channelId:b.channelId},usesGpu:false});return Response.json({jobId:job.job.id},{headers:h});
 }catch(e){return Response.json({error:e instanceof z.ZodError?"Invalid request":e instanceof Error?e.message.slice(0,300):"Failed"},{status:400,headers:h});}
}
