import {describe,it,expect} from 'vitest';
import * as fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {DataStore,writeJsonAtomic} from '@ttm/storage';
import {ResearchBundle,ProductEvidence,ProductSettings,productEvidenceHash,productResearchDisclosure,Timeline} from '@ttm/core';
import {StudioStore,StudioPublishingStore,StudioReviewStore,ReviewCategory} from '../src/index.js';
import {tmpDir} from '../../storage/test/helpers.js';

// Isolated byte/metadata contracts; these approvals never belong to an owner or live account.
async function fixture(){
 const store=new DataStore(await tmpDir('acs-product-eligibility-'));await store.init();
 const studio=new StudioStore(store),publishing=new StudioPublishingStore(store),review=new StudioReviewStore(store),now=new Date().toISOString();
 const pilot=await studio.saveAutopilot({id:randomUUID(),name:'Product protocol fixture',family:'product',sourceUrl:'https://merchant.example/item',rights:'DISCOVERY_ONLY',rightsEvidence:'Fixture original graphics and sourced evidence; no live permission',languages:['en-US'],brief:'Synthetic product research fixture',createdAt:now,updatedAt:now}),{id}=await studio.enqueue(pilot,'en-US',randomUUID()),run=(await studio.run(id))!;
 const evidence=ProductEvidence.parse({version:1,settings:ProductSettings.parse({}),record:{name:'Fixture product',brand:null,sku:'test',model:null,description:null,specifications:[],price:'5',currency:'USD',availability:null,url:pilot.sourceUrl,requestedUrl:pilot.sourceUrl,retrievedAt:now,sourceSha256:'fixture'},affiliate:null,researchIdentity:'fixture'});
 const description=productResearchDisclosure('en-US',now,pilot.timezone);
 const research=ResearchBundle.parse({id:randomUUID(),autopilotId:pilot.id,language:'en-US',createdAt:now,identity:'fixture',documents:[],draft:{title:'Fixture',claims:[{id:'c1',text:'Fixture text',risk:'low',quotes:[{url:pilot.sourceUrl,quote:'Fixture text'}]}],shots:[{text:'Fixture text',claimIds:['c1']},{text:description,claimIds:[]}]},claims:[{id:'c1',status:'EVIDENCE_FOUND',reasons:[]}],product:evidence.record,productEvidenceHash:productEvidenceHash(evidence),model:'mock-no-inference'});
 await studio.saveRun({...run,state:'ready',shots:research.draft.shots.map(s=>({text:s.text,asset:'',durationSec:5,sourceStart:0,sourceDuration:null})),outputs:['final.mp4','qa.json','research.json','product-evidence.json','timeline.json']});
 await writeJsonAtomic(store.p('studio','artifacts',id,'timeline.json'),Timeline.parse({schemaVersion:1,width:1080,height:1920,fps:30,duration:10,createdAt:now,clips:[{id:'disclosure',track:'dialogue',start:5,duration:4.7,text:description}]}));
 await writeJsonAtomic(store.p('studio','artifacts',id,'qa.json'),{technical:true,rights:'ORIGINAL_GRAPHICS_WITH_SOURCE_CITATIONS'});
 await writeJsonAtomic(store.p('studio','artifacts',id,'research.json'),research);await writeJsonAtomic(store.p('studio','artifacts',id,'product-evidence.json'),evidence);await fs.writeFile(store.p('studio','artifacts',id,'final.mp4'),'protocol bytes, not a video');
 const approve=async()=>{const c=await review.context(id);for(const category of ReviewCategory.options)await review.decide({runId:id,category,decision:'APPROVED',fingerprint:c.fingerprint,evidence:'Contract-only fixture approval, not human content approval'},'contract-test');return c.fingerprint;};
 await approve();return {store,studio,publishing,review,id,pilot,evidence,description,approve};
}
describe('Product eligibility integration, no external providers',()=>{
 it('requires approved evidence and exact dated disclosure, then rejects changed partner settings',async()=>{
  const f=await fixture();expect((await f.publishing.eligibility(f.id,f.description)).contentApproved).toBe(true);
  await expect(f.publishing.eligibility(f.id,'Generic description')).rejects.toThrow('disclosure');
  await f.studio.saveAutopilot({...f.pilot,productSettings:{...f.pilot.productSettings,maxPriceAgeHours:2}});
  await expect(f.publishing.eligibility(f.id,f.description)).rejects.toThrow('partner settings changed');
 });
 it('binds product evidence bytes into all reviews and never accepts an invalidated version after reapproval',async()=>{
  const f=await fixture(),original=(await f.review.context(f.id)).fingerprint;
  await writeJsonAtomic(f.store.p('studio','artifacts',f.id,'product-evidence.json'),{...f.evidence,record:{...f.evidence.record,price:'99'}});
  expect((await f.review.context(f.id)).fingerprint).not.toBe(original);expect((await f.review.context(f.id)).contentApproved).toBe(false);
  await f.approve();await expect(f.publishing.eligibility(f.id,f.description)).rejects.toThrow('approved research version');
  await writeJsonAtomic(f.store.p('studio','artifacts',f.id,'product-evidence.json'),f.evidence);
  await writeJsonAtomic(f.store.p('studio','artifacts',f.id,'product-invalidation.json'),{reason:'Contract stale source'});
  await f.approve();await expect(f.publishing.eligibility(f.id,f.description)).rejects.toThrow('invalidated');
 });
 it('holds a cut or muted spoken disclosure even after fresh scoped review decisions',async()=>{
  const f=await fixture(),timeline=(await f.studio.timeline(f.id))!;timeline.clips[0].duration=1;
  await writeJsonAtomic(f.store.p('studio','artifacts',f.id,'timeline.json'),timeline);await f.approve();
  await expect(f.publishing.eligibility(f.id,f.description)).rejects.toThrow('disclosure audio');
 });
});
