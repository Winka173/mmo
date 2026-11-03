import {ABTestingEngine} from "@ttm/insights";
import {BudgetRouter,costPerPublishedPost} from "@ttm/governance";
import {readJsonl} from "@ttm/storage";
import {z} from "zod";
import {getStore} from "../../../lib/data";
export const dynamic="force-dynamic";
/** A/B experiments and budget for the Studio pages, from the same stored data the legacy pages used. */
export async function GET(){
 const store=await getStore(),s=await store.getSettings(),month=new Date().toISOString().slice(0,7);
 const [experiments,spend,cpp,costs]=await Promise.all([new ABTestingEngine(store).list(),new BudgetRouter(store,[],()=>store.getSettings()).spend(),costPerPublishedPost(store,month),readJsonl<any>(store.p("costs",`${month}.jsonl`))]);
 return Response.json({experiments,month,spend,cpp,records:costs.records.slice(-50).reverse(),caps:{daily:s.spend.dailyUsdCap,weekly:s.spend.weeklyUsdCap,monthly:s.budgets.monthlyUsdCap,perVideo:s.budgets.perVideoUsdCap},paidProviders:s.spend.paidProviderAllowlist},{headers:{"Cache-Control":"no-store"}});
}
const Body=z.discriminatedUnion("action",[
 z.object({action:z.literal("budget"),daily:z.number().min(0),weekly:z.number().min(0),monthly:z.number().min(0),perVideo:z.number().min(0)}),
 z.object({action:z.literal("experiment"),id:z.string().trim().min(3).max(80),hypothesis:z.string().trim().min(10).max(1000),variable:z.string(),design:z.string(),metric:z.string(),platform:z.string().max(40),owner:z.string().max(80).default("studio"),minSample:z.number().int().min(2).max(1000),armA:z.string().trim().min(1).max(300),armB:z.string().trim().min(1).max(300),sameFeed:z.boolean(),affiliate:z.boolean()}),
]);
export async function POST(request:Request){
 try{const b=Body.parse(await request.json()),store=await getStore();
  if(b.action==="budget"){await store.updateSettings(s=>({...s,budgets:{...s.budgets,monthlyUsdCap:b.monthly,perVideoUsdCap:b.perVideo},spend:{...s.spend,dailyUsdCap:b.daily,weeklyUsdCap:b.weekly}}),"studio-ui");return Response.json({ok:true});}
  const r=await new ABTestingEngine(store).create({id:b.id,hypothesis:b.hypothesis,variable:b.variable as any,design:b.design as any,owner:b.owner||"studio",platform:b.platform,primaryMetric:b.metric as any,minSamplePerArm:b.minSample,arms:[{id:"A",description:b.armA},{id:"B",description:b.armB}]} as any,{sameFeedSimultaneous:b.sameFeed,affiliate:b.affiliate});
  if(!r.experiment)return Response.json({error:r.issues.join("; ")},{status:400});return Response.json(r.experiment);
 }catch(e){return Response.json({error:e instanceof z.ZodError?"Invalid input":e instanceof Error?e.message.slice(0,300):"Failed"},{status:400});}
}
