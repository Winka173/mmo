import {describe,it,expect,vi} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import * as fs from 'node:fs/promises';
const mocks=vi.hoisted(()=>({urls:[] as string[]}));
vi.mock('@ttm/providers',async()=>({...await vi.importActual<object>('@ttm/providers'),fetchPublicSource:async(url:string)=>{mocks.urls.push(url);return{url,requestedUrl:url,domain:'publisher.example',title:'Synthetic opportunity article',text:'Fixture instruments measure temperature in a controlled chamber. This is an isolated metadata routing test.',html:'fixture',mime:'text/html',fetchedAt:new Date().toISOString(),sha256:'f'.repeat(64)};}}));
vi.mock('../src/local-engine.js',()=>({invokeLocalEngine:async()=>({model:'MOCK_NO_AI_INFERENCE',script:{title:'Synthetic source routing test',claims:[{id:'c1',text:'Fixture measurement',risk:'low',quotes:[{url:'https://publisher.example/article',quote:'Fixture instruments measure temperature in a controlled chamber.'}]}],shots:[{text:'This isolated fixture explains a measurement described in the selected source article. It uses original narration and retains the source citation for a separate review.',claimIds:['c1']},{text:'The fixture instruments measure temperature in a controlled chamber. This test demonstrates source routing and does not provide actual scientific evidence.',claimIds:['c1']}]}})}));
import {StudioStore} from '@ttm/automation';
import {buildContext} from '../src/context.js';
import {researchRun} from '../src/research.js';
import {tmpDir} from '../../../packages/storage/test/helpers.js';
describe('Selected feed entry to research contract (mock HTTP and AI)',()=>{
 it('retrieves the selected article rather than treating feed metadata as cited research',async()=>{
  const ctx=await buildContext({dataDir:await tmpDir('acs-feed-research-')}),studio=new StudioStore(ctx.store),now=new Date().toISOString();
  const a=await studio.saveAutopilot({id:randomUUID(),name:'Synthetic feed routing fixture',family:'facts',brief:'Explain only sourced fixture information',durationSec:20,languages:['en-US'],discovery:{enabled:true,feeds:['https://publisher.example/feed'],feedConsent:true},createdAt:now,updatedAt:now});
  const opportunity={id:createHash('sha256').update('https://publisher.example/article').digest('hex'),url:'https://publisher.example/article',title:'Untrusted discovery headline',summary:'This summary is not citation evidence.',publishedAt:now,observedAt:now,feedUrl:'https://publisher.example/feed',feedSha256:'e'.repeat(64),score:.8,reasons:['Synthetic routing fixture']};
  const {id}=await studio.enqueue({...a,opportunity},'en-US','source-routing-fixture'),run=(await studio.run(id))!,dir=ctx.store.p('studio','artifacts',id);await fs.mkdir(dir,{recursive:true});const result=await researchRun(ctx,run,dir);
  expect(mocks.urls).toEqual(['https://publisher.example/article']);expect(result.documents[0].url).toBe(opportunity.url);expect(result.claims[0].status).toBe('EVIDENCE_FOUND');expect(result.factApproval).toBe('REQUIRED');expect(JSON.stringify(result.documents)).not.toContain(opportunity.summary);
 });
});
