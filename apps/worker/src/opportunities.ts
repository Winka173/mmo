import {OpportunityStore,DiscoveryState,scoreOpportunity,type Autopilot,type SourceOpportunity} from '@ttm/automation';
import {fetchPublicSource,parsePublicFeed} from '@ttm/providers';
import {withLock} from '@ttm/storage';
import type {Ctx} from './context.js';
/** Fetches at most four explicitly configured publisher feeds; no media/accounts or AI. */
export async function pollOpportunities(ctx:Ctx,a:Autopilot,now=new Date(),force=false,retrieve=fetchPublicSource){
 const store=new OpportunityStore(ctx.store);if(!a.discovery.enabled)return null;
 return withLock(ctx.store.p('locks',`opportunities-${a.id}.lock`),async()=>{
  const prior=await store.get(a.id),flags=await ctx.settings();if(flags.paused||flags.killSwitch)return prior;
  if(a.family!=='facts'||!a.discovery.feedConsent||!a.discovery.feeds.length||a.sourceFolder||a.scriptText.trim())throw new Error('Configure permitted RSS/Atom feeds for original research-based facts only');
  if(!force&&prior?.configHash===store.configHash(a)&&Date.parse(prior.nextPollAt)>now.getTime())return prior;
  const state=DiscoveryState.parse({autopilotId:a.id,configHash:store.configHash(a),checkedAt:now.toISOString(),nextPollAt:new Date(now.getTime()+a.discovery.intervalMinutes*60000).toISOString(),items:prior?.items??[],errors:[]});
  for(const feedUrl of [...new Set(a.discovery.feeds)]){
   const current=await ctx.settings();if(current.paused||current.killSwitch)break;
   try{const source=await retrieve(feedUrl);for(const item of parsePublicFeed(source.html,source.url)){
    const existing=state.items.find(i=>i.id===item.id),scored=scoreOpportunity({...item,feedUrl,feedSha256:source.sha256,observedAt:existing?.observedAt??now.toISOString()},a.discovery,now);if(!scored)continue;
    if(existing)Object.assign(existing,scored);else if(state.items.length<1000)state.items.push(scored);
   }}catch(error){state.errors.push(`${new URL(feedUrl).hostname}: ${error instanceof Error?error.message:'Feed unavailable'}`);}
  }
  // Preserve history and first observation; expire eligibility during prepare rather than dropping identities.
  return store.save(state);
 });
}
