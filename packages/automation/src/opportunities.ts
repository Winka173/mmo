import {z} from 'zod';
import {createHash} from 'node:crypto';
import {DataStore,readJson,writeJsonAtomic} from '@ttm/storage';
import type {Autopilot,StudioRun} from './studio.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const DiscoveryConfig=z.object({enabled:z.boolean().default(false),feeds:z.array(z.string().url()).max(4).default([]),terms:z.array(z.string().trim().min(2).max(80)).max(20).default([]),intervalMinutes:z.number().int().min(15).max(1440).default(60),maxAgeDays:z.number().int().min(1).max(365).default(30),feedConsent:z.boolean().default(false)});
export const SourceOpportunity=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),url:z.string().url(),title:z.string().max(500),summary:z.string().max(1500),publishedAt:z.string().datetime().nullable(),feedUrl:z.string().url(),feedSha256:z.string(),observedAt:z.string().datetime(),score:z.number().min(0).max(1),reasons:z.array(z.string())});
export type SourceOpportunity=z.infer<typeof SourceOpportunity>;
export const DiscoveryState=z.object({autopilotId:z.string().uuid(),configHash:z.string(),checkedAt:z.string().datetime(),nextPollAt:z.string().datetime(),items:z.array(SourceOpportunity).max(1000),errors:z.array(z.string()).max(10)});
export function scoreOpportunity(input:Omit<SourceOpportunity,'score'|'reasons'>,config:z.infer<typeof DiscoveryConfig>,now=new Date()):SourceOpportunity|null{
 const age=(now.getTime()-Date.parse(input.publishedAt??input.observedAt))/86400000;
 if(age< -1||age>config.maxAgeDays)return null;
 const normalize=(s:string)=>s.normalize('NFC').toLocaleLowerCase(),text=normalize(input.title+' '+input.summary),terms=[...new Set(config.terms.map(normalize))],matched=terms.filter(t=>text.includes(t));
 if(terms.length&&!matched.length)return null;
 const relevance=terms.length?matched.length/terms.length:.5,freshness=Math.max(0,1-Math.max(0,age)/config.maxAgeDays);
 return SourceOpportunity.parse({...input,score:Math.round((relevance*.7+freshness*.3)*1000)/1000,reasons:[terms.length?`Lexical topic matches: ${matched.join(', ')}`:'No topic filter supplied; selection uses recency among offered sources',input.publishedAt?'Publisher-supplied date, not an independently verified event date':'No publisher date; recency uses first observation', 'Metadata discovery only; facts, visual rights and editorial value require production evidence and review']});
}
export class OpportunityStore{
 constructor(readonly store:DataStore){}
 get(id:string){z.string().uuid().parse(id);return readJson(this.store.p('studio','opportunities',`${id}.json`),DiscoveryState);}
 async save(state:z.infer<typeof DiscoveryState>){state=DiscoveryState.parse(state);await writeJsonAtomic(this.store.p('studio','opportunities',`${state.autopilotId}.json`),state);return state;}
 configHash(a:Autopilot){return hash(a.discovery);}
 async prepare(a:Autopilot,runs:StudioRun[],now=new Date()):Promise<Autopilot|null>{
  if(!a.discovery.enabled||a.opportunity)return a;
  if(a.family!=='facts'||!a.discovery.feedConsent||a.sourceFolder||a.scriptText.trim())throw new Error('Feed discovery requires facts, metadata consent, original graphics and an independently researched script');
  const state=await this.get(a.id);if(!state||state.configHash!==this.configHash(a))return null;
  const previous=runs.filter(r=>r.autopilotId===a.id&&r.snapshot.opportunity),done=(id:string)=>a.languages.every(lang=>previous.some(r=>r.language===lang&&r.snapshot.opportunity?.id===id));
  const candidates=state.items.filter(item=>a.discovery.feeds.includes(item.feedUrl)&&!done(item.id)).map(item=>scoreOpportunity(item,a.discovery,now)).filter((item):item is SourceOpportunity=>!!item);
  const partial=(id:string)=>previous.some(r=>r.snapshot.opportunity?.id===id);
  candidates.sort((x,y)=>Number(partial(y.id))-Number(partial(x.id))||y.score-x.score||(y.publishedAt??y.observedAt).localeCompare(x.publishedAt??x.observedAt)||x.id.localeCompare(y.id));
  return candidates[0]?{...a,opportunity:candidates[0]}:null;
 }
}
