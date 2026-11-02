import path from 'node:path';
import * as fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {StudioStore,StudioReviewStore,discoverStudioTools} from '@ttm/automation';
import {buildContext} from '../apps/worker/src/context.js';
import {runJob} from '../apps/worker/src/handlers.js';
import {stopManagedLlm} from '../apps/worker/src/managed-llm.js';
import {assertFreshProductPublication} from '../apps/worker/src/product-research.js';
async function main(){
 const root=process.cwd(),ctx=await buildContext({dataDir:process.env.ACS_PRODUCT_DATA??path.join(root,'.local/product-e2e',String(Date.now()),'data')}),studio=new StudioStore(ctx.store);
 const installed=JSON.parse(await fs.readFile('.local/llm-setup/data/config/studio.json','utf8'));
 await studio.saveConfig({...((await discoverStudioTools(root,installed)).config),ttsDevice:'cuda',asrDevice:'cuda',pythonVad:path.join(root,'.local/engines/asr/Scripts/python.exe'),vadModel:path.join(root,'.local/models/silero-vad/silero_vad.jit'),vadSha256:'e1122837f4154c511485fe0b9c64455f7b929c96fbb8d79fbdb336383ebd3720'});
 await ctx.store.updateSettings(s=>({...s,paused:false,killSwitch:false,externalPostingEnabled:false}),'internal-product-test');
 const now=new Date().toISOString(),pilot=process.env.ACS_PRODUCT_DATA?(await studio.autopilots())[0]:await studio.saveAutopilot({id:randomUUID(),name:'AirLift sourced research draft',family:'product',sourceUrl:'https://www.adafruit.com/product/4201',brief:'Explain the purpose of Adafruit AirLift ESP32 WiFi co-processor in plain language. Only sourced product information. No first-hand experience, no purchase recommendation, no affiliate links. Prefer the purpose and connection concept over fluctuating price. Use an engaging concise beginning and ending.',languages:['vi-VN','en-US'],durationSec:30,rights:'DISCOVERY_ONLY',rightsEvidence:'Internal source-based research test. Only original abstract font graphics; no copied product photo or footage. Source, factual, editorial and voice review still required.',enabled:false,createdAt:now,updatedAt:now});
 if(!pilot)throw new Error('No existing product benchmark');
 const report:any={status:'RUNNING',at:now,data:ctx.store.root,source:pilot.sourceUrl,targetDuration:pilot.durationSec,publicPosting:false,affiliateEnabled:false,humanApproval:'NOT_REVIEWED',runs:[]};
 try{for(const language of pilot.languages){
  const prior=process.env.ACS_PRODUCT_DATA?(await studio.runs()).find(r=>r.autopilotId===pilot.id&&r.language===language):null;
  const {id}=prior??await studio.enqueue(pilot,language,`product-test:${randomUUID()}`);report.activeRun={id,language};console.log(`${language} ${id}`);let run=await studio.run(id);const deadline=Date.now()+15*60000;
  while(run?.state!=='ready'&&Date.now()<deadline){if(run&&['failed','needs_input','cancelled'].includes(run.state))throw new Error(run.error??run.state);const job=await ctx.queue.claim({kinds:['STUDIO_RUN'],maxConcurrent:1,gpuSlots:1});if(job)await runJob(ctx,job);else await new Promise(r=>setTimeout(r,2000));run=await studio.run(id);}
  if(run?.state!=='ready')throw new Error('Resource wait deadline; queued work retained');
  const dir=ctx.store.p('studio','artifacts',id),qa=JSON.parse(await fs.readFile(path.join(dir,'qa.json'),'utf8')),research=JSON.parse(await fs.readFile(path.join(dir,'research.json'),'utf8')),description=await fs.readFile(path.join(dir,'product-publication-description.txt'),'utf8'),review=await new StudioReviewStore(ctx.store).context(id);
  if(!qa.technical||review.contentApproved||!run.outputs.includes('product-evidence.json')||!run.outputs.includes('product-publication-description.txt'))throw new Error('Invalid technical/evidence state');
  let fresh:any;try{fresh=await assertFreshProductPublication(ctx,run,description);}catch(error){fresh={status:'HELD_REQUIRES_NEW_VERSION',reason:String(error)};}
  report.runs.push({id,language,final:path.join(dir,'final.mp4'),duration:qa.duration,technical:qa.technical,findings:qa.findings,heuristicsRequireReview:qa.heuristicsRequireReview,product:research.product,claims:research.claims,description,voiceReview:qa.voiceReview,captionQuality:qa.captionQuality,preflight:fresh,contentApproved:review.contentApproved,humanReview:'NOT_REVIEWED',outputs:run.outputs});console.log(`${language} rendered ${qa.duration}s`);
 }delete report.activeRun;report.status='VERIFIED_REAL_SOURCE_LOCAL_VI_EN_TECHNICAL_DRAFT_NOT_PUBLISH_APPROVAL';
 }catch(error){report.status='BLOCKED_OR_FAILED';report.error=String(error);throw error;}finally{stopManagedLlm();await fs.writeFile(report.status.startsWith('VERIFIED')?'docs/evidence/acs-product-e2e.json':'docs/evidence/acs-product-e2e-latest-attempt.json',JSON.stringify(report,null,2));}
}
main().catch(error=>{console.error(error);stopManagedLlm();process.exitCode=1;});
