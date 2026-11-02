import path from "node:path";
import * as fs from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {buildContext} from "../apps/worker/src/context.js";
import {StudioStore,discoverStudioTools,StudioReviewStore} from "@ttm/automation";
import {runJob} from "../apps/worker/src/handlers.js";
import {stopManagedLlm} from "../apps/worker/src/managed-llm.js";
async function main(){
 const root=process.cwd(),ctx=await buildContext({dataDir:process.env.ACS_RESEARCH_DATA??path.join(root,".local/research-e2e",String(Date.now()),"data")}),studio=new StudioStore(ctx.store),installed=JSON.parse(await fs.readFile(path.join(root,".local/llm-setup/data/config/studio.json"),"utf8"));
 const detected=await discoverStudioTools(root,installed);await studio.saveConfig({...detected.config,ttsDevice:"cuda",asrDevice:"cuda"});
 await ctx.store.updateSettings(s=>({...s,paused:false,killSwitch:false,externalPostingEnabled:false}),"research-fixture");
 const now=new Date().toISOString();const a=process.env.ACS_RESEARCH_DATA?(await studio.autopilots())[0]:await studio.saveAutopilot({id:randomUUID(),name:"Venus · sourced original explainer",family:"facts",researchUrls:["https://science.nasa.gov/venus/venus-facts/"],brief:"Explain why Venus is so hot. Use only verified facts from NASA about its atmosphere and surface temperature. Keep caveats and avoid unrelated figures. Create a concise engaging original video, with a clear beginning and ending.",languages:["vi-VN","en-US"],durationSec:30,rights:"DISCOVERY_ONLY",rightsEvidence:"NASA page used for short attributed evidence excerpts; all visuals are original font graphics; no third-party footage copied. Final public-use rights review is pending.",enabled:false,createdAt:now,updatedAt:now});
 if(!a)throw new Error("No benchmark Autopilot found");
 const report:any={status:"RUNNING",at:now,source:a.researchUrls,realGameplay:false,publicPosting:false,runs:[]};
 try{
  for(const language of a.languages){
   const existing=process.env.ACS_RESEARCH_DATA?(await studio.runs()).filter(r=>r.autopilotId===a.id&&r.language===language).sort((x,y)=>y.createdAt.localeCompare(x.createdAt))[0]:null;
   const queued=existing?{id:existing.id}:await studio.enqueue(a,language,`research-test:${randomUUID()}`);console.log(`${language} queued/resumed ${queued.id}`);report.activeRun={id:queued.id,language,dataDir:ctx.store.root};
   let run=await studio.run(queued.id);const deadline=Date.now()+15*60000;
   while(run?.state!=="ready"&&Date.now()<deadline){
    if(run&&["failed","needs_input","cancelled"].includes(run.state))throw new Error(`${language}: ${run.error??run.state}`);
    const job=await ctx.queue.claim({kinds:["STUDIO_RUN"],maxConcurrent:1,gpuSlots:1});if(job)await runJob(ctx,job);else await new Promise(r=>setTimeout(r,2000));run=await studio.run(queued.id);
   }
   if(run?.state!=="ready")throw new Error(`${language}: resource wait deadline reached; queued work retained`);
   const dir=ctx.store.p("studio","artifacts",run.id),research=JSON.parse(await fs.readFile(path.join(dir,"research.json"),"utf8")),qa=JSON.parse(await fs.readFile(path.join(dir,"qa.json"),"utf8")),review=await new StudioReviewStore(ctx.store).context(run.id);
   if(!qa.technical||review.contentApproved||!Array.isArray(qa.voiceReview)||qa.voiceReview.some((v:any)=>!v.languageMatch))throw new Error("Invalid QA / false approval");
   report.runs.push({id:run.id,language,final:path.join(dir,"final.mp4"),duration:qa.duration,technical:qa.technical,claims:research.claims,actualSources:research.documents.map((d:any)=>({url:d.url,sha256:d.sha256,fetchedAt:d.fetchedAt})),voiceReview:qa.voiceReview,voiceStatus:qa.voiceReview.every((v:any)=>v.status==="pass")?"ASR_MATCHED_LISTENING_REQUIRED":"FLAGGED_REQUIRES_REVIEW",humanReview:"NOT_REVIEWED",contentApproved:review.contentApproved,findings:qa.findings,outputs:run.outputs});console.log(`${language} rendered ${qa.duration}s`);
  }
  delete report.activeRun;report.status=report.runs.some((r:any)=>r.voiceStatus==="FLAGGED_REQUIRES_REVIEW")?"VERIFIED_TECHNICAL_DRAFT_WITH_VOICE_FLAGS":"VERIFIED_LOCAL_DRAFT_PIPELINE_NOT_FACT_OR_PUBLICATION_APPROVAL";
 }catch(error:any){report.status="BLOCKED_OR_FAILED";report.error=error.message;throw error;}finally{stopManagedLlm();await fs.writeFile(path.join(root,report.status.startsWith("VERIFIED")?"docs/evidence/acs-research-e2e.json":"docs/evidence/acs-research-e2e-latest-attempt.json"),JSON.stringify(report,null,2));}
}
main().catch(error=>{console.error(error);stopManagedLlm();process.exitCode=1;});
