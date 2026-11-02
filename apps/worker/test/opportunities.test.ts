import {describe,it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {StudioStore,OpportunityStore,scoreOpportunity,DiscoveryConfig} from '@ttm/automation';
import {buildContext} from '../src/context.js';
import {pollOpportunities} from '../src/opportunities.js';
import {tmpDir} from '../../../packages/storage/test/helpers.js';
const now=new Date('2026-10-23T06:00:00Z'),feed='https://publisher.example/feed';
function response(items:string){const html=`<rss><channel>${items}</channel></rss>`;return {url:feed,requestedUrl:feed,html,text:'metadata',sha256:createHash('sha256').update(html).digest('hex'),fetchedAt:now.toISOString(),mime:'application/rss+xml',title:'Fixture',domain:'publisher.example'};}
const item=(name:string,date='2026-10-22T00:00:00Z')=>`<item><title>Space ${name}</title><link>https://publisher.example/${name}</link><description>New space research</description><pubDate>${date}</pubDate></item>`;
async function fixture(){const ctx=await buildContext({dataDir:await tmpDir('acs-feed-contract-')}),studio=new StudioStore(ctx.store),a=await studio.saveAutopilot({id:randomUUID(),name:'Feed protocol fixture',family:'facts',brief:'Explain new space research using actual independent evidence',languages:['vi-VN','en-US'],enabled:true,discovery:{enabled:true,feeds:[feed],terms:['space'],feedConsent:true},createdAt:now.toISOString(),updatedAt:now.toISOString()});return {ctx,studio,a};}
describe('Feed opportunity discovery, synthetic metadata with no AI',()=>{
 it('requires declared offered-feed consent and original graphics facts; a feed grants no reuse rights',async()=>{
  const f=await fixture();expect(f.a.rights).toBe('PERMISSION_PENDING');await expect(f.studio.saveAutopilot({...f.a,discovery:{...f.a.discovery,feedConsent:false}})).rejects.toThrow('consent');await expect(f.studio.saveAutopilot({...f.a,family:'localization'})).rejects.toThrow('facts');await expect(f.studio.saveAutopilot({...f.a,sourceFolder:'C:/footage'})).rejects.toThrow('no media folder');
 });
 it('persists source metadata/hash/first observation, filters stale/topic mismatch and never calls AI',async()=>{
  const f=await fixture(),retrieve=async()=>response(item('new')+item('old','2020-01-01T00:00:00Z'));const first=await pollOpportunities(f.ctx,f.a,now,true,retrieve);expect(first?.items).toHaveLength(1);expect(first?.items[0].feedSha256).toHaveLength(64);
  const second=await pollOpportunities(f.ctx,f.a,new Date(now.getTime()+3600000),true,retrieve);expect(second?.items[0].observedAt).toBe(now.toISOString());expect((await new OpportunityStore(f.ctx.store).prepare(f.a,[],now))?.opportunity?.url).toBe('https://publisher.example/new');expect((await f.ctx.queue.list('queued')).length).toBe(0);
 });
 it('selects partial multilingual work first and recovers one shared identity across concurrent schedulers',async()=>{
  const f=await fixture();await pollOpportunities(f.ctx,f.a,now,true,async()=>response(item('first')));const selected=(await f.studio.prepareSource(f.a,now))!;await f.studio.enqueue(selected,'vi-VN','fixture-partial');
  await pollOpportunities(f.ctx,f.a,now,true,async()=>response(item('newer','2026-10-23T05:00:00Z')+item('first')));const selectedAgain=(await f.studio.prepareSource(f.a,now))!;expect(selectedAgain.opportunity?.id).toBe(selected.opportunity?.id);
  const created=(await Promise.all([f.studio.tick(now),new StudioStore(f.ctx.store).tick(now)])).flat();expect(created).toHaveLength(1);expect(await f.studio.runs()).toHaveLength(2);expect(new Set((await f.studio.runs()).map(r=>r.snapshot.opportunity?.id)).size).toBe(1);
 });
 it('skips exhausted/stale topics, does not fabricate filler and does not read a feed while paused',async()=>{
  const f=await fixture();await pollOpportunities(f.ctx,f.a,now,true,async()=>response(item('only')));await f.studio.tick(now);const after=(await f.studio.autopilot(f.a.id))!;await f.studio.saveAutopilot({...after,nextRunAt:null});expect(await f.studio.tick(now)).toHaveLength(0);expect(await f.studio.runs()).toHaveLength(2);
  await f.ctx.store.updateSettings(s=>({...s,paused:true}),'contract-test');let read=false;await pollOpportunities(f.ctx,f.a,now,true,async()=>{read=true;return response('');});expect(read).toBe(false);
 });
 it('topic scores are lexical/recency heuristics and never certify truth or popularity',()=>{
  const config=DiscoveryConfig.parse({terms:['space']}),base={id:'a'.repeat(64),url:'https://publisher.example/a',title:'Space research',summary:'Unverified metadata',publishedAt:null,feedUrl:feed,feedSha256:'b'.repeat(64),observedAt:now.toISOString()};expect(scoreOpportunity(base,config,now)?.reasons.join(' ')).toContain('facts, visual rights and editorial value require');expect(scoreOpportunity({...base,title:'Unrelated',summary:''},config,now)).toBeNull();
 });
});
