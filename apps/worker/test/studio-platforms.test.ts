import {describe,it,expect} from "vitest";
import * as fs from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {StudioStore,StudioPublishingStore,StudioReviewStore,ReviewCategory,AccountKeysStore} from "@ttm/automation";
import {writeJsonAtomic,SecretStore} from "@ttm/storage";
import {buildContext} from "../src/context.js";
import {executeStudioPublication,checkStudioPublication,checkStudioChannel,studioPublisher} from "../src/studio-publishing.js";
import {tmpDir} from "../../../packages/storage/test/helpers.js";

/** A recorded fake HTTP server: every request is logged and answered from the route table. No real network. */
function fakeHttp(routes:[RegExp,string,(url:URL,body:any)=>any][]){
 const calls:string[]=[];
 const impl=async(input:any,init?:RequestInit)=>{const url=new URL(String(input)),method=(init?.method??"GET").toUpperCase();calls.push(`${method} ${url.hostname}${url.pathname}`);
  const route=routes.find(([re,m])=>m===method&&re.test(url.hostname+url.pathname));if(!route)return new Response(JSON.stringify({error:{message:`unexpected ${method} ${url.pathname}`}}),{status:404});
  let body:any=init?.body;if(typeof body==="string"&&body.startsWith("{"))body=JSON.parse(body);
  const out=route[2](url,body);return new Response(JSON.stringify(out),{status:200,headers:{"content-type":"application/json"}});};
 return {impl:impl as any,calls};
}
async function fixture(platform:"facebook_reels"|"instagram_reels"|"tiktok",expectedRemoteId:string,extra:Record<string,unknown>={}){
 const ctx=await buildContext({dataDir:await tmpDir(`acs-${platform}-`)}),studio=new StudioStore(ctx.store),store=new StudioPublishingStore(ctx.store),review=new StudioReviewStore(ctx.store),now=new Date().toISOString();
 const a=await studio.saveAutopilot({id:randomUUID(),name:"Platform protocol fixture",brief:"Internal protocol fixture only",rights:"AUTHORIZED_REUSE",rightsEvidence:"Test-only owned byte fixture, not an actual publishable video",createdAt:now,updatedAt:now}),{id}=await studio.enqueue(a,"en-US",randomUUID()),run=(await studio.run(id))!;
 await studio.saveRun({...run,state:"ready",outputs:["final.mp4","qa.json"]});await writeJsonAtomic(ctx.store.p("studio","artifacts",id,"qa.json"),{technical:true});await fs.writeFile(ctx.store.p("studio","artifacts",id,"final.mp4"),"test protocol bytes; not real video");
 const context=await review.context(id);for(const category of ReviewCategory.options)await review.decide({runId:id,category,decision:"APPROVED",fingerprint:context.fingerprint,evidence:"Synthetic isolated test approval, no real user approval created"},"contract-test");
 const channel=await store.saveChannel({id:randomUUID(),name:`Fake ${platform}`,platform,expectedRemoteId,enabled:true,...extra},{accessToken:"fake-token-0123456789-abcdefghij"});await store.setPostingEnabled(true);
 return {ctx,store,id,channel,context};
}
const request=(f:Awaited<ReturnType<typeof fixture>>,privacy:"private"|"public")=>f.store.request({runId:f.id,channelId:f.channel.id,fingerprint:f.context.fingerprint,title:"Protocol fixture",description:"No real external requests",privacy,containsSyntheticMedia:true,authorize:true});

describe("Studio Facebook / Instagram / TikTok publishing through the channel flow (fake HTTP only)",()=>{
 it("validates the expected account ID and credential shape per platform",async()=>{
  const ctx=await buildContext({dataDir:await tmpDir("acs-platform-ids-")}),store=new StudioPublishingStore(ctx.store);
  await expect(store.saveChannel({id:randomUUID(),name:"Bad page",platform:"facebook_reels",expectedRemoteId:"UC"+"X".repeat(22)})).rejects.toThrow("Facebook Page ID");
  await expect(store.saveChannel({id:randomUUID(),name:"Bad creds",platform:"tiktok",expectedRemoteId:"fixture_creator"},{clientId:"x",clientSecret:"y",refreshToken:"z"})).rejects.toThrow();
  const ok=await store.saveChannel({id:randomUUID(),name:"IG",platform:"instagram_reels",expectedRemoteId:"17841400000000000"},{accessToken:"fake-token-0123456789-abcdefghij"});expect(ok.revision).toBe(1);
  await expect(request({store,id:randomUUID(),channel:{...ok,enabled:true},context:{fingerprint:"x"}} as any,"private")).rejects.toThrow();
 });
 it("uploads a Facebook Page Reel as a draft for private visibility, then reconciles status and metrics",async()=>{
  const f=await fixture("facebook_reels","123456789012345"),http=fakeHttp([
   [/graph\.facebook\.com\/v21\.0\/123456789012345$/,"GET",()=>({id:"123456789012345",name:"Fixture Page"})],
   [/graph\.facebook\.com\/v21\.0\/123456789012345\/video_reels$/,"POST",(u)=>u.searchParams.get("upload_phase")==="start"?{video_id:"9001",upload_url:"https://rupload.facebook.com/video-upload/v21.0/9001"}:(expect(u.searchParams.get("video_state")).toBe("DRAFT"),{success:true})],
   [/rupload\.facebook\.com\//,"POST",()=>({success:true})],
   [/graph\.facebook\.com\/v21\.0\/9001$/,"GET",()=>({status:{video_status:"ready"},permalink_url:"/reel/9001"})],
   [/graph\.facebook\.com\/v21\.0\/9001\/video_insights$/,"GET",()=>({data:[{name:"total_video_views",values:[{value:42}]},{name:"total_video_impressions",values:[{value:99}]}]})],
  ]);
  const {id}=await request(f,"private"),factory=(c:any)=>studioPublisher(f.ctx,c,http.impl);
  const result=await executeStudioPublication(f.ctx,id,factory);expect(result).toMatchObject({state:"available",remoteId:"9001"});
  const snapshot=await checkStudioPublication(f.ctx,id,factory);expect(snapshot.metrics).toMatchObject({views:42,impressions:99});
  expect(http.calls.filter(c=>c.startsWith("POST rupload"))).toHaveLength(1);
 });
 it("publishes an Instagram Reel container only after it reports FINISHED and refuses private visibility",async()=>{
  const f=await fixture("instagram_reels","17841400000000000");await expect(request(f,"private")).rejects.toThrow("does not support private");
  const http=fakeHttp([
   [/v21\.0\/17841400000000000$/,"GET",()=>({id:"17841400000000000",username:"fixture_ig"})],
   [/v21\.0\/17841400000000000\/media$/,"POST",()=>({id:"c1",uri:"https://rupload.facebook.com/ig-api-upload/v21.0/c1"})],
   [/rupload\.facebook\.com\//,"POST",()=>({success:true})],
   [/v21\.0\/c1$/,"GET",()=>({status_code:"FINISHED"})],
   [/v21\.0\/17841400000000000\/media_publish$/,"POST",()=>({id:"m1"})],
   [/v21\.0\/m1$/,"GET",()=>({id:"m1",permalink:"https://www.instagram.com/reel/fixture/"})],
   [/v21\.0\/m1\/insights$/,"GET",()=>({data:[{name:"reach",values:[{value:7}]},{name:"likes",values:[{value:2}]}]})],
  ]);
  const {id}=await request(f,"public"),factory=(c:any)=>studioPublisher(f.ctx,c,http.impl);
  expect(await executeStudioPublication(f.ctx,id,factory)).toMatchObject({state:"available",remoteId:"m1",url:"https://www.instagram.com/reel/fixture/"});
  expect((await checkStudioPublication(f.ctx,id,factory)).metrics).toMatchObject({reach:7,likes:2});
 });
 it("holds TikTok uploads for an unaudited app without sending bytes, and uploads chunks when audited",async()=>{
  const held=await fixture("tiktok","fixture_creator"),none=fakeHttp([]);
  const first=await request(held,"private");await expect(executeStudioPublication(held.ctx,first.id,(c:any)=>studioPublisher(held.ctx,c,none.impl))).rejects.toThrow("audit");
  expect(none.calls).toHaveLength(0);expect((await held.store.get(first.id))?.state).toBe("needs_input");
  const f=await fixture("tiktok","fixture_creator",{tiktokAudited:true}),http=fakeHttp([
   [/open\.tiktokapis\.com\/v2\/post\/publish\/creator_info\/query\/$/,"POST",()=>({data:{creator_username:"fixture_creator",creator_nickname:"Fixture"},error:{code:"ok"}})],
   [/open\.tiktokapis\.com\/v2\/post\/publish\/video\/init\/$/,"POST",(_u,b)=>(expect(b.post_info.privacy_level).toBe("SELF_ONLY"),{data:{publish_id:"p1",upload_url:"https://open-upload.tiktokapis.com/video/?upload_id=1"},error:{code:"ok"}})],
   [/open-upload\.tiktokapis\.com\//,"PUT",()=>({})],
   [/open\.tiktokapis\.com\/v2\/post\/publish\/status\/fetch\/$/,"POST",()=>({data:{status:"PUBLISH_COMPLETE",publicaly_available_post_id:["7300"]},error:{code:"ok"}})],
  ]);
  const {id}=await request(f,"private");expect(await executeStudioPublication(f.ctx,id,(c:any)=>studioPublisher(f.ctx,c,http.impl))).toMatchObject({state:"available",remoteId:"7300"});
 });
 it("records a wrong-account check and never uploads to it",async()=>{
  const f=await fixture("facebook_reels","123456789012345"),http=fakeHttp([[/v21\.0\/123456789012345$/,"GET",()=>({id:"999999999999",name:"Someone else"})]]);
  const check=await checkStudioChannel(f.ctx,f.channel.id,(c:any)=>studioPublisher(f.ctx,c,http.impl));expect(check.canPublish).toBe(false);
  const {id}=await request(f,"public");await expect(executeStudioPublication(f.ctx,id,(c:any)=>studioPublisher(f.ctx,c,http.impl))).rejects.toThrow("identity");
  expect(http.calls.some(c=>c.includes("video_reels"))).toBe(false);
 });
 it("Accounts & Keys: channel credential removal disables the channel and the publication falls back to manual export",async()=>{
  const f=await fixture("facebook_reels","123456789012345"),accounts=new AccountKeysStore(f.ctx.store);
  expect((await accounts.overview()).channels[0]).toMatchObject({platform:"facebook_reels",present:true,state:"set"});
  await accounts.remove(`channel:${f.channel.id}`);const after=(await accounts.overview()).channels[0];expect(after).toMatchObject({present:false,state:"not_set",enabled:false});
  expect(JSON.stringify(await accounts.overview())).not.toContain("fake-token-0123456789");
  expect(await new SecretStore(f.ctx.store).has(f.store.secretRef((await f.store.channel(f.channel.id))!))).toBe(false);
 });
 it("schedules one read-only metrics check per published post per day",async()=>{
  const f=await fixture("facebook_reels","123456789012345"),http=fakeHttp([
   [/v21\.0\/123456789012345$/,"GET",()=>({id:"123456789012345",name:"Fixture Page"})],[/video_reels$/,"POST",(u)=>u.searchParams.get("upload_phase")==="start"?{video_id:"9001",upload_url:"https://rupload.facebook.com/video-upload/v21.0/9001"}:{success:true}],
   [/rupload\.facebook\.com\//,"POST",()=>({success:true})],[/v21\.0\/9001$/,"GET",()=>({status:{video_status:"ready"},permalink_url:"/reel/9001"})],[/video_insights$/,"GET",()=>({data:[]})]]);
  const {id}=await request(f,"public");await executeStudioPublication(f.ctx,id,(c:any)=>studioPublisher(f.ctx,c,http.impl));
  const now=new Date();expect(await f.store.scheduleMetricChecks(now)).toEqual([id]);expect(await f.store.scheduleMetricChecks(now)).toEqual([]);
  await checkStudioPublication(f.ctx,id,(c:any)=>studioPublisher(f.ctx,c,http.impl));expect(await f.store.scheduleMetricChecks(new Date(now.getTime()+3600_000))).toEqual([]);
  expect(await f.store.scheduleMetricChecks(new Date(now.getTime()+30*3600_000))).toEqual([id]);
 });
});
