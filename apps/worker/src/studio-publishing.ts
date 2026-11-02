import * as fs from "node:fs/promises";
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {FactoryError} from "@ttm/core";
import {StudioPublishingStore,StudioStore,StudioDeliveryPolicyStore,type StudioChannel} from "@ttm/automation";
import {withLock,writeJsonAtomic} from "@ttm/storage";
import {YouTubePublisher,MetaPublisher,TikTokPublisher,type PlatformPublisher,type PublishPackage} from "@ttm/platforms";
import type {Ctx} from "./context.js";
import {assertFreshProductPublication} from "./product-research.js";

export type StudioPublisherFactory=(channel:StudioChannel)=>Promise<PlatformPublisher>;
const hold=(message:string)=>new FactoryError("STUDIO_PUBLISH_HOLD","HUMAN_REQUIRED",message);
async function digest(file:string){const h=createHash("sha256");for await(const bytes of createReadStream(file))h.update(bytes);return h.digest("hex");}
/** Network transport for publishers: no redirects, bounded time, and errors that never echo URLs or tokens. */
export function publisherFetch(platform:string){
 return async(input:string|URL|Request,init?:RequestInit)=>{try{return await fetch(input,{...init,signal:AbortSignal.timeout(120000),redirect:"error"});}catch{throw new FactoryError(`${platform.toUpperCase()}_NETWORK`,"RETRYABLE",`${platform} network request interrupted; saved upload state will be reconciled before retry`);}};
}
export async function studioPublisher(ctx:Ctx,channel:StudioChannel,fetchImpl?:typeof fetch):Promise<PlatformPublisher>{
 const raw=await ctx.secrets.get(new StudioPublishingStore(ctx.store).secretRef(channel));if(!raw)throw hold("Missing encrypted credentials for this channel revision; add them in Settings › Accounts & Keys or use the manual export package");
 const creds=JSON.parse(raw);
 switch(channel.platform){
  case "youtube_long":case "youtube_shorts":return new YouTubePublisher(channel.platform,creds,{expectedChannelId:channel.expectedRemoteId,fetchImpl:(fetchImpl??publisherFetch("youtube")) as any});
  case "facebook_reels":return new MetaPublisher("facebook",{accessToken:creds.accessToken,pageId:channel.expectedRemoteId,expectedId:channel.expectedRemoteId,publishState:"PUBLISHED",fetchImpl:(fetchImpl??publisherFetch("meta")) as any});
  case "instagram_reels":return new MetaPublisher("instagram",{accessToken:creds.accessToken,igUserId:channel.expectedRemoteId,expectedId:channel.expectedRemoteId,fetchImpl:(fetchImpl??publisherFetch("meta")) as any});
  case "tiktok":return new TikTokPublisher({accessToken:creds.accessToken,audited:channel.tiktokAudited===true,expectedOpenId:channel.expectedRemoteId,fetchImpl:(fetchImpl??publisherFetch("tiktok")) as any});
 }
}
export async function checkStudioChannel(ctx:Ctx,id:string,factory:StudioPublisherFactory=c=>studioPublisher(ctx,c)){
 const store=new StudioPublishingStore(ctx.store),channel=await store.channel(id);if(!channel)throw hold("Channel not found");
 let caps;try{caps=await(await factory(channel)).validateCapabilities();}catch(error){caps={configured:false,canPublish:false,accountId:null,blockers:[error instanceof Error?error.message:"Connection check failed"]};}
 const result={channelId:id,revision:channel.revision,checkedAt:new Date().toISOString(),...caps};await writeJsonAtomic(ctx.store.p("studio","channel-checks",`${id}.json`),result);return result;
}
export async function executeStudioPublication(ctx:Ctx,id:string,factory:StudioPublisherFactory=c=>studioPublisher(ctx,c)){
 return withLock(ctx.store.p("locks",`studio-publication-${id}.lock`),async()=>{
  const store=new StudioPublishingStore(ctx.store);let row=await store.get(id);if(!row)throw hold("Publication not found");
  if(["available","processing"].includes(row.state)&&row.remoteId)return {id,state:row.state,remoteId:row.remoteId};
  try{
   const channel=await store.channel(row.channel.id);if(!channel?.enabled||channel.revision!==row.channel.revision)throw hold("Channel was changed or disabled after authorization; reconnect/review before continuing");
   const context=await store.eligibility(row.runId,row.description).catch(e=>{throw hold(e.message);});if(context.fingerprint!==row.reviewFingerprint||context.videoHash!==row.videoHash)throw hold("Approved output/evidence changed; publication authorization is invalid");
   const settings=await ctx.settings();if(settings.paused||settings.killSwitch||!await store.postingEnabled())throw hold("Studio posting disabled, paused or stopped");
   if(row.authorization.scope==="POLICY_REVIEWED_VERSION"){
    if(!row.authorization.policy)throw hold("Delivery policy provenance missing");
    await new StudioDeliveryPolicyStore(ctx.store).validateReservation(row.authorization.policy.reservationId).catch(e=>{throw hold(e.message);});
   }
   const frozen=ctx.store.p("studio","publish-files",`${id}.mp4`);await fs.mkdir(ctx.store.p("studio","publish-files"),{recursive:true});
   if(!await fs.access(frozen).then(()=>true,()=>false))await fs.copyFile(ctx.store.p("studio","artifacts",row.runId,"final.mp4"),frozen,fs.constants.COPYFILE_EXCL);
   if(await digest(frozen)!==row.videoHash)throw hold("Frozen upload bytes do not match the approved video");
   const pub=await factory(channel),caps=await pub.validateCapabilities();
   if(!caps.canPublish||caps.accountId!==channel.expectedRemoteId)throw hold(`Channel identity/permission check failed: ${caps.blockers.join("; ")}`);
   await assertFreshProductPublication(ctx,context.run,row.description);
   if(row.authorization.scope==="POLICY_REVIEWED_VERSION")await new StudioDeliveryPolicyStore(ctx.store).validateReservation(row.authorization.policy!.reservationId).catch(e=>{throw hold(e.message);});
   const fresh=await store.channel(channel.id),flags=await ctx.settings(),approval=await store.eligibility(row.runId,row.description);
   if(!fresh?.enabled||fresh.revision!==channel.revision||flags.paused||flags.killSwitch||!await store.postingEnabled()||approval.fingerprint!==row.reviewFingerprint)throw hold("Channel, rights, approvals or posting policy changed during preflight");
   const pkg:PublishPackage={projectId:row.runId,idempotencyKey:`studio-publication:${id}`,videoFile:frozen,videoSha256:row.videoHash,thumbnailFile:null,title:row.title,description:row.description,tags:row.tags,privacy:row.authorization.privacy,publishAt:null,containsSyntheticMedia:row.containsSyntheticMedia,language:context.run.language,madeForKids:false};
   row=await store.save({...row,state:"uploading",error:null});
   const result=await pub.upload(pkg,async upload=>{row=await store.save({...row!,upload:{...row!.upload,...upload}});},row.upload);
   if("reason" in result)throw hold(result.reason);
   const raw=result.raw as {privacyStatus?:string}|undefined;
   row=await store.save({...row,upload:{...row.upload,remoteId:result.remoteId},remoteId:result.remoteId,url:result.url,state:result.status==="PROCESSING"?"processing":"available",actualPrivacy:raw?.privacyStatus??null});
   await ctx.store.audit({actor:"studio-worker",action:"studio.publish.remote_confirmed",subject:id,detail:{remoteId:row.remoteId,privacy:row.actualPrivacy,state:row.state}});
   if(row.state==="processing")await ctx.queue.enqueue({kind:"STUDIO_PUBLICATION_CHECK",idempotencyKey:`studio-publication-check:${id}`,payload:{publicationId:id},notBefore:new Date(Date.now()+30000),usesGpu:false,maxAttempts:12});
   return {id,state:row.state,remoteId:row.remoteId,url:row.url,actualPrivacy:row.actualPrivacy};
  }catch(error){await store.save({...row,state:error instanceof FactoryError&&error.errorClass==="HUMAN_REQUIRED"?"needs_input":"failed",error:error instanceof Error?error.message:"Upload failed"});throw error;}
 });
}
/** Local reservations and publication requests are durable; this never fabricates reviews. */
export async function dispatchStudioDeliveries(ctx:Ctx){
 const policies=new StudioDeliveryPolicyStore(ctx.store),plan=await policies.tick(),publishing=new StudioPublishingStore(ctx.store),queued=[];
 for(const candidate of plan.candidates){
  try{
   const current=await policies.validateReservation(candidate.reservationId);
   const publication=await publishing.request(current.payload,current.provenance);
   await policies.markQueued(candidate.reservationId,publication.id);queued.push(publication.id);
  }catch(error){plan.holds.push({policyId:candidate.policyId,runId:candidate.payload.runId,reason:error instanceof Error?error.message:"Delivery dispatch held"});}
 }
 await writeJsonAtomic(ctx.store.p("studio","delivery-plan.json"),{at:new Date().toISOString(),queued,holds:plan.holds});return {queued,holds:plan.holds};
}
export async function checkStudioPublication(ctx:Ctx,id:string,factory:StudioPublisherFactory=c=>studioPublisher(ctx,c)){
 return withLock(ctx.store.p("locks",`studio-publication-${id}.lock`),async()=>{
  const store=new StudioPublishingStore(ctx.store),row=await store.get(id);if(!row?.remoteId)throw hold("No confirmed remote ID; resume/reconcile the original upload job first");
  const channel=await store.channel(row.channel.id);if(!channel?.enabled||channel.revision!==row.channel.revision)throw hold("Channel changed or disabled");
  const pub=await factory(channel),caps=await pub.validateCapabilities();if(caps.accountId!==channel.expectedRemoteId)throw hold("Channel identity cannot be verified");
  const status=await pub.pollStatus(row.remoteId),metrics=await pub.fetchMetrics(row.remoteId).catch(()=>null);
  const snapshot={publicationId:id,runId:row.runId,channelId:channel.id,remoteId:row.remoteId,at:new Date().toISOString(),status,metrics:{...Object.fromEntries(Object.entries(metrics??{}).filter(([,v])=>typeof v==="number"||v===null)),views:metrics?.views??null,likes:metrics?.likes??null,comments:metrics?.comments??null,watchTime:null,retention:null,revenue:null,wishlists:null}};
  await writeJsonAtomic(ctx.store.p("studio","metrics",id,`${Date.now()}.json`),snapshot);
  await store.save({...row,state:status.state==="PUBLISHED"?"available":status.state==="PROCESSING"?"processing":status.state==="FAILED"?"failed":"needs_input",actualPrivacy:status.privacy??null,error:status.state==="FAILED"||status.state==="UNKNOWN"?status.detail:null});
  if(status.state==="PROCESSING")throw new FactoryError("STUDIO_REMOTE_PROCESSING","RETRYABLE","Platform still processing the confirmed remote video",{retryAfter:new Date(Date.now()+60000).toISOString()});
  return snapshot;
 });
}
