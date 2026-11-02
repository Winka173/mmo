import {z} from "zod";
import {DataStore,SecretStore,readJson,writeJsonAtomic,withLock} from "@ttm/storage";
import {FileQueue} from "./queue.js";
import {StudioStore,hash} from "./studio.js";
import {StudioReviewStore} from "./review.js";
import {ProductEvidence,ProductSettings,ResearchBundle,validateProductPublicationMetadata,productResearchDisclosure} from "@ttm/core";

export const STUDIO_PLATFORMS=["youtube_long","youtube_shorts","facebook_reels","instagram_reels","tiktok"] as const;
export type StudioPlatform=typeof STUDIO_PLATFORMS[number];
/** Identity each platform reports for the connected account; uploads stop when it differs. */
export const CHANNEL_REMOTE_ID:Record<StudioPlatform,{pattern:RegExp;vi:string;en:string}>={
 youtube_long:{pattern:/^UC[A-Za-z0-9_-]{22}$/,vi:"YouTube Channel ID (UC…)",en:"YouTube Channel ID (UC…)"},
 youtube_shorts:{pattern:/^UC[A-Za-z0-9_-]{22}$/,vi:"YouTube Channel ID (UC…)",en:"YouTube Channel ID (UC…)"},
 facebook_reels:{pattern:/^\d{5,25}$/,vi:"Facebook Page ID (số)",en:"Facebook Page ID (digits)"},
 instagram_reels:{pattern:/^\d{5,25}$/,vi:"Instagram user ID (số, tài khoản Business/Creator)",en:"Instagram user ID (digits, Business/Creator account)"},
 tiktok:{pattern:/^[A-Za-z0-9._]{2,30}$/,vi:"TikTok username (không có @)",en:"TikTok username (without @)"},
};
/** Credential fields stored per channel revision on the Accounts & Keys page. */
export const CHANNEL_CREDENTIAL_FIELDS:Record<StudioPlatform,{key:string;vi:string;en:string}[]>={
 youtube_long:[{key:"clientId",vi:"OAuth Client ID",en:"OAuth Client ID"},{key:"clientSecret",vi:"OAuth Client secret",en:"OAuth Client secret"},{key:"refreshToken",vi:"Refresh token",en:"Refresh token"}],
 youtube_shorts:[{key:"clientId",vi:"OAuth Client ID",en:"OAuth Client ID"},{key:"clientSecret",vi:"OAuth Client secret",en:"OAuth Client secret"},{key:"refreshToken",vi:"Refresh token",en:"Refresh token"}],
 facebook_reels:[{key:"accessToken",vi:"Page access token",en:"Page access token"}],
 instagram_reels:[{key:"accessToken",vi:"Access token (Instagram Graph)",en:"Access token (Instagram Graph)"}],
 tiktok:[{key:"accessToken",vi:"Access token (video.publish)",en:"Access token (video.publish)"}],
};
const ChannelCredentials:Record<StudioPlatform,z.ZodTypeAny>={
 youtube_long:z.object({clientId:z.string().trim().min(1).max(2000),clientSecret:z.string().trim().min(1).max(2000),refreshToken:z.string().trim().min(1).max(8000)}).strict(),
 youtube_shorts:z.object({clientId:z.string().trim().min(1).max(2000),clientSecret:z.string().trim().min(1).max(2000),refreshToken:z.string().trim().min(1).max(8000)}).strict(),
 facebook_reels:z.object({accessToken:z.string().trim().min(20).max(8000)}).strict(),
 instagram_reels:z.object({accessToken:z.string().trim().min(20).max(8000)}).strict(),
 tiktok:z.object({accessToken:z.string().trim().min(10).max(8000)}).strict(),
};
/** Visibility each platform accepts through its publishing API. */
export const PLATFORM_PRIVACY:Record<StudioPlatform,("private"|"unlisted"|"public")[]>={youtube_long:["private","unlisted","public"],youtube_shorts:["private","unlisted","public"],facebook_reels:["private","public"],instagram_reels:["public"],tiktok:["private","public"]};
export const StudioChannel=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(160),platform:z.enum(STUDIO_PLATFORMS),expectedRemoteId:z.string().trim().min(2).max(128),tiktokAudited:z.boolean().optional(),enabled:z.boolean().default(false),revision:z.number().int().positive(),createdAt:z.string(),updatedAt:z.string()});
export type StudioChannel=z.infer<typeof StudioChannel>;
export const StudioPolicyProvenance=z.object({actor:z.literal("studio-delivery-policy"),policyId:z.string().uuid(),policyRevision:z.number().int().positive(),reservationId:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const StudioPublication=z.object({id:z.string().uuid(),runId:z.string().uuid(),channel:StudioChannel,videoHash:z.string(),reviewFingerprint:z.string(),authorization:z.object({actor:z.string(),at:z.string(),scope:z.enum(["ONE_VERSION_ONE_CHANNEL","POLICY_REVIEWED_VERSION"]),policy:z.object({id:z.string().uuid(),revision:z.number().int().positive(),reservationId:z.string().regex(/^[a-f0-9]{64}$/)}).optional(),privacy:z.enum(["private","unlisted","public"])}),title:z.string().min(1).max(100),description:z.string().max(5000),tags:z.array(z.string().max(80)).max(20),containsSyntheticMedia:z.boolean(),state:z.enum(["queued","uploading","processing","available","needs_input","failed"]),upload:z.object({sessionUri:z.string().optional(),remoteId:z.string().optional()}).default({}),remoteId:z.string().nullable().default(null),url:z.string().nullable().default(null),actualPrivacy:z.string().nullable().default(null),error:z.string().nullable().default(null),createdAt:z.string(),updatedAt:z.string()});
export type StudioPublication=z.infer<typeof StudioPublication>;
export class StudioPublishingStore{
 constructor(readonly store:DataStore){}
 async postingEnabled(){return (await readJson(this.store.p("studio","posting-policy.json"),z.object({enabled:z.boolean()})))?.enabled??false;}
 async setPostingEnabled(enabled:boolean){await writeJsonAtomic(this.store.p("studio","posting-policy.json"),{enabled,scope:"STUDIO_EXPLICIT_VERSION_AUTHORIZATION_ONLY",at:new Date().toISOString()});await this.store.audit({actor:"studio-ui",action:"studio.posting-policy",subject:"studio",detail:{enabled}});}
 channels(){return new StudioStore(this.store).list("channels",StudioChannel);}
 channel(id:string){z.string().uuid().parse(id);return readJson(this.store.p("studio","channels",`${id}.json`),StudioChannel);}
 get(id:string){z.string().uuid().parse(id);return readJson(this.store.p("studio","publications",`${id}.json`),StudioPublication);}
 async list(){return Promise.all((await new StudioStore(this.store).list("publications",StudioPublication)).map(async({upload,...p})=>{
  const fs=await import("node:fs/promises"),dir=this.store.p("studio","metrics",p.id),names=(await fs.readdir(dir).catch(()=>[] as string[])).filter(n=>/^\d+\.json$/.test(n)).sort().reverse();
  const metricsSnapshot=names[0]?await fs.readFile(this.store.p("studio","metrics",p.id,names[0]),"utf8").then(JSON.parse,()=>null):null;
  return {...p,hasUploadSession:!!upload.sessionUri,metricsSnapshot};
 }));}
 /** Daily metrics ingestion: one read-only check per published post per day; nothing is posted. */
 async scheduleMetricChecks(now=new Date()){
  const day=now.toISOString().slice(0,10),queued:string[]=[];
  for(const p of await this.list()){
   if(!p.remoteId||p.state!=="available")continue;
   const last=p.metricsSnapshot?.at?Date.parse(p.metricsSnapshot.at):0;if(now.getTime()-last<20*3600_000)continue;
   const job=await new FileQueue(this.store).enqueue({kind:"STUDIO_PUBLICATION_CHECK",idempotencyKey:`studio-metrics:${p.id}:${day}`,payload:{publicationId:p.id},usesGpu:false,maxAttempts:3});if(job.created!==false)queued.push(p.id);
  }
  return queued;
 }
 async save(row:StudioPublication){row=StudioPublication.parse({...row,updatedAt:new Date().toISOString()});await writeJsonAtomic(this.store.p("studio","publications",`${row.id}.json`),row);return row;}
 async saveChannel(input:unknown,credentials?:unknown){
  const value=StudioChannel.omit({revision:true,createdAt:true,updatedAt:true}).extend({revision:z.number().optional()}).parse(input);
  if(!CHANNEL_REMOTE_ID[value.platform].pattern.test(value.expectedRemoteId))throw new Error(`Expected account ID must be a ${CHANNEL_REMOTE_ID[value.platform].en}`);
  const creds=credentials?ChannelCredentials[value.platform].parse(credentials):null;
  return withLock(this.store.p("locks",`studio-channel-${value.id}.lock`),async()=>{
   const old=await this.channel(value.id);if(old&&old.revision!==value.revision)throw new Error("Channel changed. Reload first.");
   const now=new Date().toISOString(),row=StudioChannel.parse({...value,revision:(old?.revision??0)+1,createdAt:old?.createdAt??now,updatedAt:now});
   // A new immutable credential reference per revision prevents a concurrent upload from switching accounts.
   if(creds)await new SecretStore(this.store).set(this.secretRef(row),JSON.stringify(creds));
   else if(old){const prior=await new SecretStore(this.store).get(this.secretRef(old));if(prior)await new SecretStore(this.store).set(this.secretRef(row),prior);}
   await writeJsonAtomic(this.store.p("studio","channels",`${row.id}.json`),row);await this.store.audit({actor:"studio-ui",action:"studio.channel.save",subject:row.id,detail:{revision:row.revision,enabled:row.enabled}});return row;
  });
 }
 secretRef(channel:StudioChannel){return `acs.${channel.id}.r${channel.revision}`;}
 async eligibility(runId:string,description?:string){
  const c=await new StudioReviewStore(this.store).context(runId),a=c.run.snapshot;
  if(!c.contentApproved)throw new Error("All four content review scopes and technical QA must pass for this exact version");
  const independentlyAuthored=["facts","product"].includes(a.family)&&!a.sourceFolder&&!!c.research&&c.qa?.rights==="ORIGINAL_GRAPHICS_WITH_SOURCE_CITATIONS";
  const current=await new StudioStore(this.store).autopilot(a.id);if(!current||!independentlyAuthored&&current.rights!=="AUTHORIZED_REUSE")throw new Error("Current source rights were revoked or removed");
  const currentRights=current.reusePermissions;if(currentRights.expiresAt&&Date.parse(currentRights.expiresAt)<=Date.now()||["shorts","localization"].includes(a.family)&&(!currentRights.cut||!currentRights.redistribute||a.family==="localization"&&(!currentRights.translate||!currentRights.dub)))throw new Error("Current source reuse permissions expired or were revoked");
  if((a.rights!=="AUTHORIZED_REUSE"&&!independentlyAuthored)||a.rightsEvidence.trim().length<12)throw new Error("Source rights and evidence are required for publication");
  if(a.reusePermissions.expiresAt&&Date.parse(a.reusePermissions.expiresAt)<=Date.now())throw new Error("Source rights expired");
  if(["localization","shorts"].includes(a.family)&&(!a.reusePermissions.cut||!a.reusePermissions.redistribute||(a.family==="localization"&&(!a.reusePermissions.translate||!a.reusePermissions.dub))))throw new Error("Source transformation rights are incomplete");
  const timeline=await new StudioStore(this.store).timeline(runId);if(timeline?.clips.some(clip=>clip.rightsExpiresAt&&Date.parse(clip.rightsExpiresAt)<=Date.now()))throw new Error("A timeline asset license expired");
  if(a.schedule.embargoUntil&&Date.parse(a.schedule.embargoUntil)>Date.now())throw new Error("Embargo has not elapsed");
  if(a.schedule.expiresAt&&Date.parse(a.schedule.expiresAt)<=Date.now())throw new Error("Content topic expired");
  if(a.family==="product"){
   const fs=await import("node:fs/promises"),dir=this.store.p("studio","artifacts",runId);
   if(await fs.access(this.store.p("studio","artifacts",runId,"product-invalidation.json")).then(()=>true,()=>false))throw new Error("Product evidence was invalidated; create and review a new draft");
   const evidence=ProductEvidence.parse(JSON.parse(await fs.readFile(`${dir}/product-evidence.json`,"utf8")));
   if(hash(ProductSettings.parse(a.productSettings))!==hash(evidence.settings)||hash(ProductSettings.parse(current.productSettings))!==hash(evidence.settings))throw new Error("Product partner settings changed; create and review a new draft");
   if(description===undefined)throw new Error("Product publication requires its dated disclosure and affiliate description");
   const bundle=ResearchBundle.parse(c.research);
   validateProductPublicationMetadata(bundle,evidence,description,c.run.language,a.timezone);
   if(c.run.shots.map(s=>s.text).join("\n")!==bundle.draft.shots.map(s=>s.text).join("\n"))throw new Error("Product narration changed after research; create and verify updated product research");
   const disclosures=[productResearchDisclosure(c.run.language,evidence.record.retrievedAt,a.timezone),...(evidence.settings.affiliateEnabled?[evidence.settings.affiliateDisclosure]:[])];
   for(const text of disclosures){
    const shot=c.run.shots.find(s=>s.text===text);
    if(!shot||!timeline?.clips.some(clip=>clip.track==="dialogue"&&clip.text===text&&clip.sourceIn===0&&clip.duration>=shot.durationSec-0.301&&clip.gain>0))throw new Error("Product disclosure audio was removed, trimmed or muted; preserve the complete spoken disclosure");
   }
  }
  return c;
 }
 async request(input:unknown,internalPolicy?:z.infer<typeof StudioPolicyProvenance>){
  const value=z.object({runId:z.string().uuid(),channelId:z.string().uuid(),fingerprint:z.string(),title:z.string().trim().min(1).max(100),description:z.string().max(5000).default(""),tags:z.array(z.string().max(80)).max(20).default([]),privacy:z.enum(["private","unlisted","public"]),containsSyntheticMedia:z.boolean(),authorize:z.literal(true)}).parse(input);
  const provenance=internalPolicy?StudioPolicyProvenance.parse(internalPolicy):null;
  if(provenance){const policyStore=new (await import("./studio-delivery-policy.js")).StudioDeliveryPolicyStore(this.store),candidate=await policyStore.validateReservation(provenance.reservationId);if(hash(candidate.payload)!==hash(value)||hash(candidate.provenance)!==hash(provenance))throw new Error("Delivery authorization does not match the reserved publication");}
  const channel=await this.channel(value.channelId);if(!channel?.enabled)throw new Error("Channel is disabled or missing");
  if(!PLATFORM_PRIVACY[channel.platform].includes(value.privacy))throw new Error(`${channel.platform} does not support ${value.privacy} visibility through its API`);
  const c=await this.eligibility(value.runId,value.description);if(c.fingerprint!==value.fingerprint)throw new Error("Reviewed output changed. Reload first.");
  const settings=await this.store.getSettings();if(!await this.postingEnabled()||settings.paused||settings.killSwitch)throw new Error("Studio posting must be explicitly enabled and production resumed");
  const key=`studio-publish:${value.runId}:${channel.id}:${c.videoHash}`,digest=hash(key),id=`${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
  return withLock(this.store.p("locks",`studio-publication-${id}.lock`),async()=>{
   const old=await this.get(id);if(old){if(provenance&&(old.authorization.scope!=="POLICY_REVIEWED_VERSION"||old.authorization.policy?.reservationId!==provenance.reservationId))throw new Error("Existing upload has a separate authorization; reconcile that request first");if(old.authorization.privacy!==value.privacy||old.title!==value.title||old.description!==value.description||old.containsSyntheticMedia!==value.containsSyntheticMedia||JSON.stringify(old.tags)!==JSON.stringify(value.tags))throw new Error("An upload already exists for this version/channel. Reconcile it before changing publication settings.");}
   else{const now=new Date().toISOString();await this.save(StudioPublication.parse({id,runId:value.runId,channel,videoHash:c.videoHash,reviewFingerprint:c.fingerprint,authorization:{actor:provenance?.actor??"studio-ui",at:now,scope:provenance?"POLICY_REVIEWED_VERSION":"ONE_VERSION_ONE_CHANNEL",...(provenance?{policy:{id:provenance.policyId,revision:provenance.policyRevision,reservationId:provenance.reservationId}}:{}),privacy:value.privacy},title:value.title,description:value.description,tags:value.tags,containsSyntheticMedia:value.containsSyntheticMedia,state:"queued",createdAt:now,updatedAt:now}));await this.store.audit({actor:provenance?.actor??"studio-ui",action:"studio.publish.authorized",subject:id,detail:{runId:value.runId,channelId:channel.id,privacy:value.privacy,videoHash:c.videoHash}});}
   const job=await new FileQueue(this.store).enqueue({kind:"STUDIO_PUBLISH",idempotencyKey:key,payload:{publicationId:id},usesGpu:false});return {id,jobId:job.job.id};
  });
 }
}
