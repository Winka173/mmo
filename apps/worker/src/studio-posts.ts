import {FactoryError} from "@ttm/core";
import {StudioPostStore,StudioPublishingStore,PageInboxStore,postFingerprint,type StudioChannel} from "@ttm/automation";
import {publishFacebookPost,publishInstagramPost,publishTikTokPhotos,fetchPostMetrics,listPageInbox,sendPageReply,type FetchLike} from "@ttm/platforms";
import {withLock} from "@ttm/storage";
import type {Ctx} from "./context.js";
import {publisherFetch} from "./studio-publishing.js";

const hold=(m:string)=>new FactoryError("STUDIO_POST_HOLD","HUMAN_REQUIRED",m);
async function token(ctx:Ctx,channel:StudioChannel){const raw=await ctx.secrets.get(new StudioPublishingStore(ctx.store).secretRef(channel));if(!raw)throw hold("Needs account: add this channel's token in Settings › Accounts & Keys, or use the manual export package");return String(JSON.parse(raw).accessToken??"");}

/** Publishes one authorized non-video post to one channel. Re-checks reviews, channel revision and posting policy first. */
export async function executeStudioPost(ctx:Ctx,postId:string,channelId:string,fetchImpl?:FetchLike){
 return withLock(ctx.store.p("locks",`post-${postId}.lock`),async()=>{
  const posts=new StudioPostStore(ctx.store),publishing=new StudioPublishingStore(ctx.store);let p=await posts.get(postId);if(!p)throw hold("Post not found");
  const idx=p.publications.findIndex(x=>x.channelId===channelId&&x.fingerprint===postFingerprint(p!));if(idx<0)throw hold("No authorization for this exact post and channel");
  const pub=p.publications[idx];if(pub.state==="available"&&pub.remoteId)return pub;
  const save=async(patch:Partial<typeof pub>)=>{p=await posts.get(postId);p!.publications[idx]={...p!.publications[idx],...patch};p=await posts.save(p!);return p.publications[idx];};
  try{
   const channel=await publishing.channel(channelId),settings=await ctx.settings();
   if(!channel?.enabled||channel.revision!==pub.channelRevision)throw hold("Channel changed or was disabled after authorization; authorize again");
   if(!posts.approved(p!))throw hold("Reviews no longer match this post");
   if(settings.paused||settings.killSwitch||!await publishing.postingEnabled())throw hold("Studio posting disabled, paused or stopped");
   const f=fetchImpl??publisherFetch(channel.platform) as unknown as FetchLike,accessToken=await token(ctx,channel),payload={kind:p!.kind,text:p!.text,link:p!.link,images:p!.images};
   await save({state:"publishing",error:null});
   const persist=async(s:any)=>{await save({progress:{...pub.progress,...s},...(s.remoteId?{remoteId:s.remoteId}:{})});};
   let result;
   if(channel.platform==="facebook_reels")result=await publishFacebookPost({pageId:channel.expectedRemoteId,accessToken,fetchImpl:f},payload,persist,{remoteId:pub.remoteId??undefined,children:pub.progress.children});
   else if(channel.platform==="instagram_reels"){const host=channel.hostPageChannelId?await publishing.channel(channel.hostPageChannelId):null;result=await publishInstagramPost({igUserId:channel.expectedRemoteId,accessToken,fetchImpl:f,pollMs:fetchImpl?1:3000,host:host?{pageId:host.expectedRemoteId,accessToken:await token(ctx,host),fetchImpl:f}:null},payload,persist,{remoteId:pub.remoteId??undefined});}
   else if(channel.platform==="tiktok")result=await publishTikTokPhotos({accessToken,audited:channel.tiktokAudited===true,verifiedUrlPrefix:channel.photoUrlPrefix??null,fetchImpl:f},payload,persist,{remoteId:pub.remoteId??undefined},pub.privacy);
   else throw hold("This platform has no API for this post type; use the manual export package");
   const done=await save({state:"available",remoteId:result.remoteId,url:result.url,error:null});
   await ctx.store.audit({actor:"studio-worker",action:"post.remote_confirmed",subject:postId,detail:{channelId,remoteId:result.remoteId}});return done;
  }catch(error:any){const waiting=error instanceof FactoryError&&error.errorClass==="RETRYABLE";await save({state:waiting?"processing":error instanceof FactoryError&&error.errorClass==="HUMAN_REQUIRED"?"needs_input":"failed",error:String(error.message).slice(0,500)});throw error;}
 });
}
export async function checkStudioPost(ctx:Ctx,postId:string,channelId:string,fetchImpl?:FetchLike){
 const posts=new StudioPostStore(ctx.store),p=await posts.get(postId),channel=await new StudioPublishingStore(ctx.store).channel(channelId);if(!p||!channel)throw hold("Post or channel missing");
 const i=p.publications.findIndex(x=>x.channelId===channelId&&x.remoteId);if(i<0)throw hold("No confirmed remote ID");
 const metrics=await fetchPostMetrics(channel.platform,{accessToken:await token(ctx,channel),fetchImpl:fetchImpl??(publisherFetch(channel.platform) as unknown as FetchLike)},p.publications[i].remoteId!);
 p.publications[i]={...p.publications[i],metrics,metricsAt:new Date().toISOString()};await posts.save(p);return metrics;
}
export async function syncPageInbox(ctx:Ctx,channelId:string,fetchImpl?:FetchLike){
 const channel=await new StudioPublishingStore(ctx.store).channel(channelId);if(!channel||channel.platform!=="facebook_reels")throw hold("Inbox sync needs a Facebook Page channel");
 const items=await listPageInbox({pageId:channel.expectedRemoteId,accessToken:await token(ctx,channel),fetchImpl:fetchImpl??(publisherFetch("meta") as unknown as FetchLike)});
 return new PageInboxStore(ctx.store).merge(channelId,items);
}
/** Sends only text the owner approved; the paused/stopped switches and the channel state are checked again first. */
export async function sendInboxReply(ctx:Ctx,itemId:string,fetchImpl?:FetchLike){
 const inbox=new PageInboxStore(ctx.store),row=(await inbox.list()).find(r=>r.id===itemId);if(!row)throw hold("Item not found");
 if(row.state==="sent")return row;if(row.state!=="approved"||!row.approvedText)throw hold("Reply was not approved by the owner");
 const settings=await ctx.settings(),channel=await new StudioPublishingStore(ctx.store).channel(row.channelId);
 if(settings.paused||settings.killSwitch)throw hold("Paused or stopped");if(!channel?.enabled)throw hold("Channel disabled");
 await inbox.update(itemId,{state:"sending"});
 try{const replyId=await sendPageReply({pageId:channel.expectedRemoteId,accessToken:await token(ctx,channel),fetchImpl:fetchImpl??(publisherFetch("meta") as unknown as FetchLike)},row,row.approvedText);await ctx.store.audit({actor:"studio-worker",action:"inbox.reply.sent",subject:itemId,detail:{kind:row.kind}});return inbox.update(itemId,{state:"sent",replyId,error:null});}
 catch(error:any){await inbox.update(itemId,{state:"failed",error:String(error.message).slice(0,300)});throw error;}
}
