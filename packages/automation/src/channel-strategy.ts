import {randomUUID,createHash} from "node:crypto";
import {z} from "zod";
import {DataStore,readJson,writeJsonAtomic,withLock} from "@ttm/storage";
import {StudioStore} from "./studio.js";
import {StudioPublishingStore} from "./studio-publishing.js";

/**
 * Channel building (ALL_APP_FLOWS section 12): strategy -> pillars/series -> weekly plan -> owner approval per idea ->
 * draft Autopilot routed to an existing factory -> the usual 4-scope review + per-version publish authorization ->
 * real metrics per pillar/series -> suggestions only with enough samples. Reels/video only; text/image posts are not built.
 */
const Pillar=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(120),description:z.string().max(1000).default("")});
const Series=z.object({id:z.string().uuid(),pillarId:z.string().uuid(),name:z.string().trim().min(1).max(120),family:z.enum(["game","facts","product","custom"]).default("custom"),perWeek:z.number().int().min(1).max(7).default(1),ideas:z.array(z.string().trim().min(3).max(500)).max(200).default([])});
export const ChannelStrategy=z.object({id:z.string().uuid(),channelId:z.string().uuid(),revision:z.number().int().positive(),goal:z.string().trim().min(3).max(1000),audience:z.string().max(500).default(""),language:z.enum(["vi-VN","en-US","en-GB"]).default("vi-VN"),tone:z.string().max(200).default("clear"),cta:z.string().max(300).default(""),avoid:z.array(z.string().max(200)).max(50).default([]),pillars:z.array(Pillar).min(1).max(12),series:z.array(Series).min(1).max(30),updatedAt:z.string()});
export type ChannelStrategy=z.infer<typeof ChannelStrategy>;
export const PlanItem=z.object({id:z.string().uuid(),strategyId:z.string().uuid(),strategyRevision:z.number().int(),seriesId:z.string().uuid(),pillarId:z.string().uuid(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),idea:z.string(),brief:z.string(),state:z.enum(["proposed","approved","rejected"]),autopilotId:z.string().uuid().nullable().default(null),decidedAt:z.string().nullable().default(null),note:z.string().max(1000).default("")});
export type PlanItem=z.infer<typeof PlanItem>;
const MIN_SAMPLES=5;
const ideaKey=(seriesId:string,idea:string)=>createHash("sha256").update(`${seriesId}\n${idea.trim().toLowerCase()}`).digest("hex");

export class ChannelStrategyStore{
 constructor(readonly store:DataStore){}
 private file(id:string){return this.store.p("studio","strategies",`${z.string().uuid().parse(id)}.json`);}
 private planFile(id:string){return this.store.p("studio","strategy-plans",`${z.string().uuid().parse(id)}.json`);}
 get(id:string){return readJson(this.file(id),ChannelStrategy);}
 async list(){return new StudioStore(this.store).list("strategies",ChannelStrategy);}
 async plan(id:string){return (await readJson(this.planFile(id),z.array(PlanItem)))??[];}
 async save(input:unknown){
  const raw=z.object({id:z.string().uuid().optional(),revision:z.number().optional()}).passthrough().parse(input),id=raw.id??randomUUID();
  return withLock(this.store.p("locks",`strategy-${id}.lock`),async()=>{
   const old=await this.get(id);if(old&&old.revision!==raw.revision)throw new Error("Strategy changed. Reload first.");
   const channel=await new StudioPublishingStore(this.store).channel(String((raw as any).channelId));if(!channel)throw new Error("Channel not found");
   const row=ChannelStrategy.parse({...raw,id,revision:(old?.revision??0)+1,updatedAt:new Date().toISOString()});
   const pillars=new Set(row.pillars.map(p=>p.id));if(row.series.some(s=>!pillars.has(s.pillarId)))throw new Error("Every series needs an existing pillar");
   await writeJsonAtomic(this.file(id),row);await this.store.audit({actor:"studio-ui",action:"strategy.save",subject:id,detail:{revision:row.revision,channelId:row.channelId}});return row;
  });
 }
 /** Proposes one week from each series' idea backlog. Ideas already planned (any state) are never proposed again. */
 async generateWeek(id:string,weekStart:string){
  const strategy=await this.get(id);if(!strategy)throw new Error("Strategy not found");
  const start=new Date(`${z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(weekStart)}T00:00:00Z`);
  return withLock(this.store.p("locks",`strategy-${id}.lock`),async()=>{
   const plan=await this.plan(id),used=new Set(plan.map(p=>ideaKey(p.seriesId,p.idea))),added:PlanItem[]=[],held:string[]=[];
   for(const series of strategy.series){
    const fresh=series.ideas.filter(i=>!used.has(ideaKey(series.id,i))&&!strategy.avoid.some(a=>a.trim()&&i.toLowerCase().includes(a.trim().toLowerCase())));
    if(fresh.length<series.perWeek)held.push(`${series.name}: ${fresh.length}/${series.perWeek} new ideas in backlog`);
    fresh.slice(0,series.perWeek).forEach((idea,i)=>{
     const day=new Date(start.getTime()+Math.floor((i+0.5)*7/series.perWeek)*86400000).toISOString().slice(0,10),pillar=strategy.pillars.find(p=>p.id===series.pillarId)!;
     const brief=[`Idea: ${idea}`,`Series: ${series.name} (pillar: ${pillar.name}${pillar.description?` — ${pillar.description}`:""})`,`Channel goal: ${strategy.goal}`,strategy.audience&&`Audience: ${strategy.audience}`,`Tone: ${strategy.tone}`,strategy.cta&&`Call to action: ${strategy.cta}`,strategy.avoid.length?`Avoid: ${strategy.avoid.join("; ")}`:"","Use only facts supplied by the owner or cited sources; do not invent features, prices or dates."].filter(Boolean).join("\n");
     const item=PlanItem.parse({id:randomUUID(),strategyId:id,strategyRevision:strategy.revision,seriesId:series.id,pillarId:series.pillarId,date:day,idea,brief,state:"proposed"});added.push(item);used.add(ideaKey(series.id,idea));
    });
   }
   await writeJsonAtomic(this.planFile(id),[...plan,...added]);return {added,held};
  });
 }
 /** Owner gate per idea. Approval creates a disabled draft Autopilot in the series' factory; it never produces or posts by itself. */
 async decide(id:string,itemId:string,decision:"approved"|"rejected",note=""){
  return withLock(this.store.p("locks",`strategy-${id}.lock`),async()=>{
   const strategy=await this.get(id),plan=await this.plan(id),item=plan.find(p=>p.id===itemId);if(!strategy||!item)throw new Error("Plan item not found");
   if(item.state!=="proposed")throw new Error("This idea was already decided");
   const series=strategy.series.find(s=>s.id===item.seriesId);if(!series)throw new Error("Series was removed from the strategy");
   let autopilotId:string|null=null;
   if(decision==="approved"){const now=new Date().toISOString(),pilot=await new StudioStore(this.store).saveAutopilot({id:randomUUID(),name:`${series.name}: ${item.idea}`.slice(0,160),family:series.family,brief:item.brief,languages:[strategy.language],audience:strategy.audience,tone:strategy.tone,targets:[strategy.channelId],mode:"REVIEW_REQUIRED",enabled:false,step:2,createdAt:now,updatedAt:now});autopilotId=pilot.id;}
   const next=plan.map(p=>p.id===itemId?PlanItem.parse({...p,state:decision,autopilotId,decidedAt:new Date().toISOString(),note}):p);
   await writeJsonAtomic(this.planFile(id),next);await this.store.audit({actor:"studio-ui",action:`strategy.idea.${decision}`,subject:itemId,detail:{strategyId:id,autopilotId}});return next.find(p=>p.id===itemId)!;
  });
 }
 /** Real metrics per pillar/series from reconciled publications of the approved ideas; suggestions need MIN_SAMPLES posts. */
 async performance(id:string){
  const strategy=await this.get(id);if(!strategy)throw new Error("Strategy not found");
  const plan=await this.plan(id),runs=await new StudioStore(this.store).runs(),pubs=await new StudioPublishingStore(this.store).list();
  const rows=strategy.series.map(series=>{
   const pilots=new Set(plan.filter(p=>p.seriesId===series.id&&p.autopilotId).map(p=>p.autopilotId!)),runIds=new Set(runs.filter(r=>pilots.has(r.autopilotId)).map(r=>r.id));
   const posts=pubs.filter(p=>runIds.has(p.runId)&&p.remoteId&&p.channel.id===strategy.channelId),views=posts.map(p=>p.metricsSnapshot?.remoteId===p.remoteId?p.metricsSnapshot.metrics?.views:null).filter((v:any):v is number=>typeof v==="number");
   return {seriesId:series.id,series:series.name,pillar:strategy.pillars.find(p=>p.id===series.pillarId)?.name??"",approved:pilots.size,produced:[...runIds].filter(r=>runs.find(x=>x.id===r)?.state==="ready").length,posts:posts.length,withViews:views.length,averageViews:views.length?views.reduce((a,b)=>a+b,0)/views.length:null};
  });
  const eligible=rows.filter(r=>r.withViews>=MIN_SAMPLES).sort((a,b)=>b.averageViews!-a.averageViews!);
  const suggestions=eligible.length>=2?[`More of "${eligible[0].series}" (average ${Math.round(eligible[0].averageViews!)} views over ${eligible[0].withViews} posts); review "${eligible.at(-1)!.series}" before adding ideas.`]:[`Not enough data yet: a suggestion needs at least two series with ${MIN_SAMPLES} posts that report views. Views do not prove followers, revenue or conversions.`];
  return {rows,suggestions,minSamples:MIN_SAMPLES};
 }
}
