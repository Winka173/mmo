import {StudioDeliveryPolicyStore} from "@ttm/automation";
import {getStore} from "../../../lib/data";
export const dynamic="force-dynamic";
export async function GET(){return Response.json({policies:await new StudioDeliveryPolicyStore(await getStore()).list()});}
export async function POST(request:Request){
  const origin=request.headers.get("origin");
  if(!origin||origin!==`http://${request.headers.get("host")}`)return Response.json({error:"Invalid origin"},{status:403});
  try{
    const body=await request.json(),store=new StudioDeliveryPolicyStore(await getStore());
    if(body.action==="save")return Response.json(await store.save(body.value));
    if(body.action==="revoke")return Response.json(await store.revoke(String(body.id),Number(body.revision)));
    // The UI can inspect a plan; only the worker dispatches durable reservations.
    if(body.action==="dry-run")return Response.json(await store.tick({dryRun:true}));
    return Response.json({error:"Unknown delivery policy action"},{status:400});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Delivery policy request failed"},{status:400});}
}
