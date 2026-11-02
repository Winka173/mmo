import {randomUUID} from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
import {DataStore,readJson,withLock,writeJsonAtomic} from "@ttm/storage";
import {Autopilot,StudioStore,hash,type StudioRun} from "./studio.js";
import {StudioPublishingStore} from "./studio-publishing.js";

const Privacy=z.enum(["private","unlisted","public"]);
const PolicyFields=z.object({
  name:z.string().trim().min(1).max(160),autopilotId:z.string().uuid(),channelId:z.string().uuid(),
  enabled:z.boolean().default(false),languages:z.array(z.enum(["vi-VN","en-US","en-GB"])).min(1).max(3),
  privacy:Privacy.default("private"),descriptionPrefix:z.string().max(2500).default(""),containsSyntheticMedia:z.boolean().default(true),
  dailyLimit:z.number().int().min(1).max(20).default(1),weeklyLimit:z.number().int().min(1).max(100).default(5),
  timezone:z.string().min(1).default("Asia/Ho_Chi_Minh"),startHour:z.number().int().min(0).max(23).default(8),endHour:z.number().int().min(1).max(24).default(22),
  weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7).default([0,1,2,3,4,5,6]),
  embargoUntil:z.string().datetime().nullable().default(null),expiresAt:z.string().datetime(),
});
export const StudioDeliveryPolicy=PolicyFields.extend({
  id:z.string().uuid(),revision:z.number().int().positive(),autopilotRevision:z.number().int().positive(),
  safetyHash:z.string(),configHash:z.string(),channelRevision:z.number().int().positive(),family:Autopilot.shape.family,
  authorizedBy:z.literal("studio-ui"),authorizedAt:z.string().datetime(),createdAt:z.string().datetime(),updatedAt:z.string().datetime(),
  scope:z.literal("AUTOMATIC_DELIVERY_AFTER_FOUR_CONTENT_REVIEWS"),
});
export type StudioDeliveryPolicy=z.infer<typeof StudioDeliveryPolicy>;
const Payload=z.object({runId:z.string().uuid(),channelId:z.string().uuid(),fingerprint:z.string(),title:z.string().min(1).max(100),description:z.string().max(5000),tags:z.array(z.string()).default([]),privacy:Privacy,containsSyntheticMedia:z.boolean(),authorize:z.literal(true)});
export const StudioDeliveryReservation=z.object({
  id:z.string().regex(/^[a-f0-9]{64}$/),policyId:z.string().uuid(),policyRevision:z.number().int().positive(),
  runId:z.string().uuid(),channelId:z.string().uuid(),reviewFingerprint:z.string(),videoHash:z.string(),payload:Payload,
  state:z.enum(["reserved","queued"]),reservedAt:z.string().datetime(),publicationId:z.string().uuid().nullable().default(null),
});
export type StudioDeliveryReservation=z.infer<typeof StudioDeliveryReservation>;
export type DeliveryCandidate={reservationId:string;policyId:string;policyRevision:number;payload:z.infer<typeof Payload>;provenance:{actor:"studio-delivery-policy";policyId:string;policyRevision:number;reservationId:string}};

/** Operational timestamps are mutable; settings and the exact pilot revision remain bound separately. */
export function studioDeliverySafetyHash(input:Autopilot){
  const {createdAt,updatedAt,nextRunAt,sourceItem,opportunity,...a}=Autopilot.parse(input);
  // Watch intake pins a copy; its original top-level folder is the authorized source scope.
  if(a.sourceWatch.enabled&&sourceItem)a.sourceFolder=path.dirname(sourceItem.originalFile);
  return hash(a);
}
function wall(now:Date,timezone:string){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:timezone,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"numeric",weekday:"short"}).formatToParts(now);
  const get=(kind:string)=>parts.find(p=>p.type===kind)!.value,day=`${get("year")}-${get("month")}-${get("day")}`,weekday=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(get("weekday"));
  const monday=new Date(`${day}T12:00:00Z`);monday.setUTCDate(monday.getUTCDate()-(weekday+6)%7);
  return {day,week:monday.toISOString().slice(0,10),weekday,hour:Number(get("hour"))};
}
function windowHold(policy:StudioDeliveryPolicy,now:Date){
  if(!policy.enabled)return "Delivery policy disabled or revoked";
  if(now.getTime()>=Date.parse(policy.expiresAt))return "Delivery policy expired";
  if(policy.embargoUntil&&now.getTime()<Date.parse(policy.embargoUntil))return "Delivery policy embargo";
  const local=wall(now,policy.timezone),hours=policy.startHour<policy.endHour?local.hour>=policy.startHour&&local.hour<policy.endHour:local.hour>=policy.startHour||local.hour<policy.endHour;
  if(!policy.weekdays.includes(local.weekday)||!hours)return "Outside authorized delivery hours / weekdays";
  return null;
}
const candidate=(row:StudioDeliveryReservation):DeliveryCandidate=>({reservationId:row.id,policyId:row.policyId,policyRevision:row.policyRevision,payload:row.payload,provenance:{actor:"studio-delivery-policy",policyId:row.policyId,policyRevision:row.policyRevision,reservationId:row.id}});

/** Reserves local work only. It cannot approve content, contact providers or upload. */
export class StudioDeliveryPolicyStore{
  constructor(readonly store:DataStore){}
  list(){return new StudioStore(this.store).list("delivery-policies",StudioDeliveryPolicy);}
  get(id:string){z.string().uuid().parse(id);return readJson(this.store.p("studio","delivery-policies",`${id}.json`),StudioDeliveryPolicy);}
  reservations(){return new StudioStore(this.store).list("delivery-reservations",StudioDeliveryReservation);}
  reservation(id:string){z.string().regex(/^[a-f0-9]{64}$/).parse(id);return readJson(this.store.p("studio","delivery-reservations",`${id}.json`),StudioDeliveryReservation);}
  async save(input:unknown){
    const value=PolicyFields.extend({id:z.string().uuid().optional(),revision:z.number().int().nonnegative().optional(),authorize:z.literal(true)}).strict().parse(input);
    const id=value.id??randomUUID();
    return withLock(this.store.p("locks","studio-delivery-policy.lock"),async()=>{
      const old=await this.get(id);if(old&&old.revision!==value.revision)throw new Error("Delivery policy changed; reload before authorizing");
      const studio=new StudioStore(this.store),pilot=await studio.autopilot(value.autopilotId),channel=await new StudioPublishingStore(this.store).channel(value.channelId);
      if(!pilot||!channel?.enabled)throw new Error("Select an existing Autopilot and enabled channel");
      if(value.languages.some(language=>!pilot.languages.includes(language)))throw new Error("Policy languages must be selected on the Autopilot");
      if(value.startHour===value.endHour)throw new Error("Delivery window must span at least one hour");
      const now=new Date().toISOString();wall(new Date(now),value.timezone);
      if(Date.parse(value.expiresAt)<=Date.parse(now)||value.embargoUntil&&Date.parse(value.embargoUntil)>=Date.parse(value.expiresAt))throw new Error("Policy needs a future expiry after its embargo");
      const row=StudioDeliveryPolicy.parse({...value,id,revision:(old?.revision??0)+1,autopilotRevision:pilot.revision,safetyHash:studioDeliverySafetyHash(pilot),configHash:hash(await studio.config()),channelRevision:channel.revision,family:pilot.family,authorizedBy:"studio-ui",authorizedAt:now,createdAt:old?.createdAt??now,updatedAt:now,scope:"AUTOMATIC_DELIVERY_AFTER_FOUR_CONTENT_REVIEWS"});
      await writeJsonAtomic(this.store.p("studio","delivery-policy-revisions",id,`r${row.revision}.json`),row);
      await writeJsonAtomic(this.store.p("studio","delivery-policies",`${id}.json`),row);
      await this.store.audit({actor:"studio-ui",action:"studio.delivery-policy.authorized",subject:id,detail:{revision:row.revision,channelId:row.channelId,autopilotRevision:row.autopilotRevision,enabled:row.enabled,privacy:row.privacy}});return row;
    });
  }
  async revoke(id:string,revision:number){
    return withLock(this.store.p("locks","studio-delivery-policy.lock"),async()=>{
      const old=await this.get(id);if(!old||old.revision!==revision)throw new Error("Delivery policy changed; reload first");
      const row=StudioDeliveryPolicy.parse({...old,enabled:false,revision:old.revision+1,updatedAt:new Date().toISOString()});
      await writeJsonAtomic(this.store.p("studio","delivery-policy-revisions",id,`r${row.revision}.json`),row);await writeJsonAtomic(this.store.p("studio","delivery-policies",`${id}.json`),row);
      await this.store.audit({actor:"studio-ui",action:"studio.delivery-policy.revoked",subject:id,detail:{revision:row.revision}});return row;
    });
  }
  private async globalHold(){const flags=await this.store.getSettings();return flags.paused||flags.killSwitch||!await new StudioPublishingStore(this.store).postingEnabled()?"Posting disabled, paused or stopped":null;}
  private async scopedContext(policy:StudioDeliveryPolicy,run:StudioRun,now:Date){
    const hold=windowHold(policy,now);if(hold)throw new Error(hold);
    const studio=new StudioStore(this.store),current=await studio.autopilot(policy.autopilotId),publishing=new StudioPublishingStore(this.store),channel=await publishing.channel(policy.channelId);
    if(!current?.enabled||current.revision!==policy.autopilotRevision||studioDeliverySafetyHash(current)!==policy.safetyHash)throw new Error("Autopilot settings/revision changed or disabled; renew delivery authorization");
    if(!channel?.enabled||channel.revision!==policy.channelRevision)throw new Error("Channel revision changed or disabled; renew delivery authorization");
    if(hash(await studio.config())!==policy.configHash||hash(run.config)!==policy.configHash)throw new Error("Local production settings changed; renew delivery authorization");
    if(run.autopilotId!==policy.autopilotId||run.snapshot.revision!==policy.autopilotRevision||run.snapshot.family!==policy.family||!policy.languages.includes(run.language)||studioDeliverySafetyHash(run.snapshot)!==policy.safetyHash||run.snapshotHash!==hash({a:run.snapshot,config:run.config}))throw new Error("Production snapshot is outside this policy's exact content/settings scope");
    let description=policy.descriptionPrefix;
    if(run.snapshot.family==="product")description+="\n"+await fs.readFile(this.store.p("studio","artifacts",run.id,"product-publication-description.txt"),"utf8");
    const context=await publishing.eligibility(run.id,description.trim());
    if(!context.videoHash)throw new Error("A reviewed completed output is required");
    const title=String(context.research?.draft?.title??run.title).trim().slice(0,100);
    const payload=Payload.parse({runId:run.id,channelId:policy.channelId,fingerprint:context.fingerprint,title,description:description.trim(),tags:[],privacy:policy.privacy,containsSyntheticMedia:policy.containsSyntheticMedia,authorize:true});
    return {context,payload};
  }
  private async quotaHold(policy:StudioDeliveryPolicy,now:Date,excludeId?:string,projected:DeliveryCandidate[]=[]){
    const rows=await this.reservations(),publications=await new StudioStore(this.store).list("publications",(await import("./studio-publishing.js")).StudioPublication);
    const excluded=rows.find(row=>row.id===excludeId),excludedKey=excluded?`${excluded.runId}:${excluded.channelId}`:null;
    const usage=new Map<string,string>();
    for(const row of rows)if(row.channelId===policy.channelId&&row.id!==excludeId)usage.set(`${row.runId}:${row.channelId}`,row.reservedAt);
    for(const row of publications)if(row.channel.id===policy.channelId&&`${row.runId}:${row.channel.id}`!==excludedKey)usage.set(`${row.runId}:${row.channel.id}`,row.createdAt);
    for(const item of projected)if(item.payload.channelId===policy.channelId)usage.set(`${item.payload.runId}:${item.payload.channelId}`,now.toISOString());
    const local=wall(now,policy.timezone),past=[...usage.values()].map(at=>wall(new Date(at),policy.timezone));
    if(past.filter(at=>at.day===local.day).length>=policy.dailyLimit)return "Channel daily delivery limit reached";
    if(past.filter(at=>at.week===local.week).length>=policy.weeklyLimit)return "Channel weekly delivery limit reached";
    return null;
  }
  async tick({now=new Date(),dryRun=false}:{now?:Date;dryRun?:boolean}={}){
    return withLock(this.store.p("locks","studio-delivery-policy.lock"),async()=>{
      const candidates:DeliveryCandidate[]=[],holds:{policyId:string;runId:string|null;reason:string}[]=[];
      const global=await this.globalHold();if(global)return {dryRun,candidates,holds:[{policyId:"",runId:null,reason:global}]};
      const studio=new StudioStore(this.store),runs=(await studio.runs()).filter(run=>run.state==="ready").sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
      const publications=await new StudioPublishingStore(this.store).list(),selected=new Set<string>();
      for(const policy of(await this.list()).filter(p=>p.enabled))for(const run of runs.filter(r=>r.autopilotId===policy.autopilotId&&policy.languages.includes(r.language))){
        const key=`${run.id}:${policy.channelId}`;if(selected.has(key)||publications.some(p=>p.runId===run.id&&p.channel.id===policy.channelId))continue;
        try{
          const {context,payload}=await this.scopedContext(policy,run,now),id=hash({key,videoHash:context.videoHash,policyId:policy.id,revision:policy.revision});
          const old=await this.reservation(id);
          if(old?.state==="queued")continue;
          if(old&&(old.reviewFingerprint!==context.fingerprint||hash(old.payload)!==hash(payload)))throw new Error("Reserved version changed; create and review a new production version");
          const quota=await this.quotaHold(policy,now,old?.id,candidates);if(quota)throw new Error(quota);
          const row=StudioDeliveryReservation.parse(old?{...old,reservedAt:now.toISOString()}:{id,policyId:policy.id,policyRevision:policy.revision,runId:run.id,channelId:policy.channelId,reviewFingerprint:context.fingerprint,videoHash:context.videoHash,payload,state:"reserved",reservedAt:now.toISOString()});
          if(!dryRun)await writeJsonAtomic(this.store.p("studio","delivery-reservations",`${id}.json`),row);
          candidates.push(candidate(row));selected.add(key);
        }catch(error){holds.push({policyId:policy.id,runId:run.id,reason:error instanceof Error?error.message:"Delivery held"});}
      }
      return {dryRun,candidates,holds};
    });
  }
  async validateReservation(id:string,{now=new Date()}:{now?:Date}={}){
    const row=await this.reservation(id);if(!row)throw new Error("Delivery reservation not found");
    const global=await this.globalHold();if(global)throw new Error(global);
    const policy=await this.get(row.policyId);if(!policy||policy.revision!==row.policyRevision)throw new Error("Delivery policy revision changed or revoked");
    if(wall(now,policy.timezone).day!==wall(new Date(row.reservedAt),policy.timezone).day)throw new Error("Delivery reservation expired at local midnight; run the planner again");
    const run=await new StudioStore(this.store).run(row.runId);if(!run)throw new Error("Production no longer exists");
    const {context,payload}=await this.scopedContext(policy,run,now);
    if(context.fingerprint!==row.reviewFingerprint||context.videoHash!==row.videoHash||hash(payload)!==hash(row.payload))throw new Error("Reserved output or evidence changed");
    const quota=await this.quotaHold(policy,now,row.id);if(quota)throw new Error(quota);
    return candidate(row);
  }
  async markQueued(id:string,publicationId:string){
    z.string().uuid().parse(publicationId);
    return withLock(this.store.p("locks","studio-delivery-policy.lock"),async()=>{
      const row=await this.reservation(id),publication=await new StudioPublishingStore(this.store).get(publicationId);
      if(!row||!publication||publication.runId!==row.runId||publication.channel.id!==row.channelId||publication.videoHash!==row.videoHash||publication.reviewFingerprint!==row.reviewFingerprint||publication.authorization.scope!=="POLICY_REVIEWED_VERSION"||publication.authorization.policy?.reservationId!==id||publication.authorization.policy.id!==row.policyId||publication.authorization.policy.revision!==row.policyRevision)throw new Error("Publication does not match reserved output and policy authorization");
      const next=StudioDeliveryReservation.parse({...row,state:"queued",publicationId});await writeJsonAtomic(this.store.p("studio","delivery-reservations",`${id}.json`),next);return next;
    });
  }
}
