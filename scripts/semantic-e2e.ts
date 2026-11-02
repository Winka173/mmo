import path from "node:path";
import * as fs from "node:fs/promises";
import {SemanticStore,ModelSetupStore} from "@ttm/automation";
import {executeModelSetup} from "../apps/worker/src/model-setup.js";
import {executeSemantic} from "../apps/worker/src/semantic.js";
import {seedSemanticFixture} from "./semantic-fixture.js";

async function main(){
 const root=process.cwd(),base=path.join(root,".local/semantic-e2e",String(Date.now())),fixture=await seedSemanticFixture(base),{ctx,studio,data,sources}=fixture,registry=new SemanticStore(ctx.store),setup=new ModelSetupStore(ctx.store);
 const report:any={status:"RUNNING",at:new Date().toISOString(),data,sources,requestedDevice:"cpu",productionConfigChanged:false,AICloud:false,publicPosting:false,humanReview:"NOT_REVIEWED"};
 try{
  const installed=await setup.enqueue({profile:"qwen-embedding",root,mode:"install"});await executeModelSetup(ctx,installed.id);report.setup=await setup.get(installed.id);
  const verified=await setup.enqueue({profile:"qwen-embedding",root,mode:"verify"});await executeModelSetup(ctx,verified.id);report.verification=await setup.get(verified.id);
  const index=await registry.enqueue({kind:"index"});await executeSemantic(ctx,index.id);report.index=await registry.summary();
  const searches=[];
  for(const query of ["Venus has a hot atmosphere and a slow rotation","sao Kim khí quyển và thời gian quay","clearly labeled software calibration test fixture"]){
   const task=await registry.enqueue({kind:"search",query});await executeSemantic(ctx,task.id);searches.push(await registry.get(task.id));
  }
  report.searches=searches.map(({config:_,...row}:any)=>row);
  const venus=new Set(sources.filter(row=>row.originalRunId!==sources.at(-1)!.originalRunId).map(row=>row.runId)),calibration=sources.at(-1)!.runId;
  const rankingMatched=searches.every((row,index)=>index<2?venus.has((row!.result!.matches as any[])[0].runId):(row!.result!.matches as any[])[0].runId===calibration);
  report.rankingMatched=rankingMatched;report.status=rankingMatched?"VERIFIED_REAL_LOCAL_EMBEDDINGS_SMALL_RETRIEVAL_FIXTURE_ONLY":"FLAGGED_RETRIEVAL_REQUIRES_REVIEW";
  report.evidence=(await registry.index())?.evidence;report.sourceTruthUnchanged=(await studio.runs()).length===sources.length;report.caveat="Three previously rendered drafts and three fixed search queries; not general retrieval, duplicate prevention, factual/rights approval or an originality certificate. Explicit CPU benchmark only; production GPU default unchanged.";
  console.log(JSON.stringify({status:report.status,index:report.index,searches:searches.map(row=>({query:row?.query,top:(row?.result?.matches as any[])?.[0]})),evidence:report.evidence}));
 }catch(error){report.status="BLOCKED_OR_FAILED";report.error=String(error);throw error;}finally{await fs.writeFile(path.join(root,"docs/evidence/acs-semantic-inference.json"),JSON.stringify(report,null,2));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
