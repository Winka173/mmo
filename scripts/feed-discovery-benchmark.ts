import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {StudioStore,OpportunityStore} from '@ttm/automation';
import {buildContext} from '../apps/worker/src/context.js';
import {pollOpportunities} from '../apps/worker/src/opportunities.js';
async function main(){
 const ctx=await buildContext({dataDir:path.join(process.cwd(),'.local/feed-discovery',String(Date.now()),'data')}),studio=new StudioStore(ctx.store),now=new Date().toISOString();
 const a=await studio.saveAutopilot({id:randomUUID(),name:'NASA public feed discovery benchmark',family:'facts',brief:'Research newly published science stories using actual source text and keep qualifications. Metadata is untrusted discovery input. No third-party media or publication authority.',languages:['vi-VN','en-US'],discovery:{enabled:true,feeds:['https://www.nasa.gov/feed/'],feedConsent:true,maxAgeDays:365},enabled:false,rights:'DISCOVERY_ONLY',rightsEvidence:'Internal offered-feed metadata/research benchmark, no copied footage or permission to publish.',createdAt:now,updatedAt:now});
 const report:any={status:'RUNNING',at:now,data:ctx.store.root,publicPosting:false,AIInference:false};
 try{const state=await pollOpportunities(ctx,a,new Date(),true),selected=await studio.prepareSource(a),again=await studio.prepareSource(a);if(!state?.items.length||!selected?.opportunity||again?.opportunity?.id!==selected.opportunity.id)throw new Error(state?.errors.join('; ')||'No eligible actual feed entry');report.status='VERIFIED_REAL_PUBLIC_FEED_METADATA_ONLY';report.feed=a.discovery.feeds[0];report.items=state.items;report.errors=state.errors;report.selection=selected.opportunity;report.rights=selected.rights;report.queueCounts=await ctx.queue.counts();if(Object.values(report.queueCounts).some(value=>Number(value)>0))throw new Error('Metadata benchmark unexpectedly enqueued work');console.log(JSON.stringify({status:report.status,items:state.items.length,selection:selected.opportunity.title}));}
 catch(error){report.status='FAILED_OR_BLOCKED';report.error=String(error);throw error;}finally{await fs.writeFile('docs/evidence/acs-feed-discovery.json',JSON.stringify(report,null,2));}
}
main().catch(error=>{console.error(String(error));process.exitCode=1;});
