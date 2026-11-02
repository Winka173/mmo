import {afterEach,describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import * as fs from 'node:fs/promises';
import {DataStore,SecretStore} from '@ttm/storage';
import {StudioPublishingStore} from '../src/studio-publishing.js';
import {StudioYouTubeOAuthStore,STUDIO_YOUTUBE_OAUTH_SCOPES} from '../src/studio-oauth.js';
import {tmpDir} from '../../storage/test/helpers.js';
const pending:{oauth:StudioYouTubeOAuthStore;id:string;owner:string}[]=[];
afterEach(async()=>{for(const p of pending.splice(0))await p.oauth.cancel(p.id,p.owner).catch(()=>{});});
async function fixture(change:{scopes?:string;remoteId?:string;refresh?:string;providerError?:boolean}={}){
 const store=new DataStore(await tmpDir('acs-oauth-contract-'));await store.init();let now=new Date(),opened='',calls=0,challenge='',exchanged=false;
 const input={name:'Contract channel, no external account',platform:'youtube_long',expectedRemoteId:`UC${'Z'.repeat(22)}`,clientId:'contract-test.apps.googleusercontent.com',clientSecret:'CONTRACT_CLIENT_SECRET',locale:'en'};
 const oauth=new StudioYouTubeOAuthStore(store,{now:()=>now,openBrowser:async url=>{opened=url;},fetchImpl:(async(url,init)=>{
  calls++;expect(init?.redirect).toBe('error');if(change.providerError)throw new Error('provider-secret-must-not-leak');
  if(String(url)==='https://oauth2.googleapis.com/token'){
   const body=init?.body as URLSearchParams;expect(body.get('client_secret')).toBe(input.clientSecret);expect(body.get('code')).toBe('CONTRACT_CODE');expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(challenge);exchanged=true;
   return Response.json({access_token:'CONTRACT_ACCESS_TOKEN',refresh_token:change.refresh??'CONTRACT_REFRESH_TOKEN',token_type:'Bearer',scope:change.scopes??STUDIO_YOUTUBE_OAUTH_SCOPES.join(' ')});
  }
  expect(String(url)).toBe('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true&maxResults=50');expect((init?.headers as Record<string,string>).authorization).toBe('Bearer CONTRACT_ACCESS_TOKEN');
  return Response.json({items:[{id:change.remoteId??input.expectedRemoteId}]});
 }) as typeof fetch});
 const started=await oauth.begin(input);pending.push({oauth,id:started.session.id,owner:started.ownerToken});
 const start=async()=>{const response=await fetch(started.startUrl,{redirect:'manual'}),auth=new URL(response.headers.get('location')!);challenge=auth.searchParams.get('code_challenge')!;return {response,auth,cookie:response.headers.get('set-cookie')!.split(';')[0],callback:auth.searchParams.get('redirect_uri')!};};
 return {store,oauth,input,started,start,setNow:(v:Date)=>{now=v;},calls:()=>calls,opened:()=>opened,exchanged:()=>exchanged};
}
describe('YouTube desktop OAuth, loopback and mock Google only',()=>{
 it('requires explicit open, random one-use state and PKCE, keeps client secrets out of local session JSON',async()=>{
  const f=await fixture();expect(f.calls()).toBe(0);expect(f.opened()).toBe('');await f.oauth.open(f.started.session.id,f.started.ownerToken);expect(f.opened()).toBe(f.started.startUrl);
  const s=await f.start();expect(s.response.status).toBe(303);expect(s.auth.origin).toBe('https://accounts.google.com');expect(s.auth.searchParams.get('code_challenge_method')).toBe('S256');expect(s.auth.searchParams.get('access_type')).toBe('offline');expect(s.response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Lax');expect((await fetch(f.started.startUrl,{redirect:'manual'})).status).toBe(403);
  const persisted=await fs.readFile(f.store.p('studio','oauth',`${f.started.session.id}.json`),'utf8');expect(persisted).not.toContain('CONTRACT_CLIENT_SECRET');expect(persisted).not.toContain(s.auth.searchParams.get('state'));expect(persisted).not.toContain(f.started.ownerToken);
 });
 it('rejects wrong owner, callback state or missing listener cookie before contacting Google',async()=>{
  const f=await fixture();await expect(f.oauth.status(f.started.session.id,'other-owner')).rejects.toThrow('unauthorized_session');const s=await f.start();
  expect((await fetch(`${s.callback}?code=CONTRACT_CODE&state=wrong`,{headers:{cookie:s.cookie}})).status).toBe(403);
  expect((await fetch(`${s.callback}?code=CONTRACT_CODE&state=${s.auth.searchParams.get('state')}`)).status).toBe(403);expect(f.calls()).toBe(0);
 });
 it('exchanges only fixed provider URLs, verifies identity/scopes, encrypts refresh token and leaves channel disabled',async()=>{
  const f=await fixture(),s=await f.start(),response=await fetch(`${s.callback}?code=CONTRACT_CODE&state=${s.auth.searchParams.get('state')}`,{headers:{cookie:s.cookie}});
  expect(response.status).toBe(200);expect(f.exchanged()).toBe(true);expect(f.calls()).toBe(2);const status=await f.oauth.status(f.started.session.id,f.started.ownerToken);expect(status.phase).toBe('connected');expect(JSON.stringify(status)).not.toContain('TOKEN');
  const publishing=new StudioPublishingStore(f.store),channel=(await publishing.channels())[0];expect(channel.enabled).toBe(false);expect(channel.expectedRemoteId).toBe(f.input.expectedRemoteId);const creds=await new SecretStore(f.store).get(publishing.secretRef(channel));expect(JSON.parse(creds!).refreshToken).toBe('CONTRACT_REFRESH_TOKEN');expect(await publishing.postingEnabled()).toBe(false);
 });
 it.each([
  {name:'missing scopes',change:{scopes:STUDIO_YOUTUBE_OAUTH_SCOPES[0]},code:'scope_missing'},
  {name:'extra scopes',change:{scopes:STUDIO_YOUTUBE_OAUTH_SCOPES.join(' ')+' https://www.googleapis.com/auth/drive'},code:'scope_unexpected'},
  {name:'wrong channel',change:{remoteId:`UC${'Q'.repeat(22)}`},code:'identity_mismatch'},
  {name:'missing refresh token',change:{refresh:''},code:'refresh_missing'},
  {name:'provider failure',change:{providerError:true},code:'provider_error'},
 ])('holds $name without saving credentials or exposing raw provider errors',async({change,code})=>{
  const f=await fixture(change),s=await f.start(),response=await fetch(`${s.callback}?code=CONTRACT_CODE&state=${s.auth.searchParams.get('state')}`,{headers:{cookie:s.cookie}});expect(response.status).toBe(400);expect(await response.text()).not.toContain('provider-secret');const status=await f.oauth.status(f.started.session.id,f.started.ownerToken);expect(status.errorCode).toBe(code);expect(await new StudioPublishingStore(f.store).channels()).toHaveLength(0);
 });
 it('expires and cancels attempts without provider calls; retry uses a new listener and security state',async()=>{
  const f=await fixture();f.setNow(new Date(Date.now()+11*60000));expect((await f.oauth.status(f.started.session.id,f.started.ownerToken)).phase).toBe('expired');expect(f.calls()).toBe(0);
  const g=await fixture(),s=await g.start();await g.oauth.cancel(g.started.session.id,g.started.ownerToken);expect((await g.oauth.status(g.started.session.id,g.started.ownerToken)).phase).toBe('cancelled');const retry=await g.oauth.retry(g.started.session.id,g.started.ownerToken,g.input);pending.push({oauth:g.oauth,id:retry.session.id,owner:retry.ownerToken});expect(retry.session.id).not.toBe(g.started.session.id);expect(retry.startUrl).not.toBe(g.started.startUrl);expect(g.calls()).toBe(0);expect(s.auth.searchParams.get('state')).toHaveLength(43);
 });
});
