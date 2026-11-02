import {createHash,randomUUID} from "node:crypto";
import {createReadStream} from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
import {DataStore,writeJsonAtomic,withLock,readJson} from "@ttm/storage";
import {StudioStore,hash,type StudioRun} from "./studio.js";
export const ReviewCategory=z.enum(["editorial","voice","facts","rights"]);
export const ReviewDecision=z.object({id:z.string().uuid(),runId:z.string().uuid(),category:ReviewCategory,decision:z.enum(["APPROVED","REJECTED","DEFERRED"]),fingerprint:z.string(),evidence:z.string().trim().min(12).max(6000),highRiskAcknowledged:z.boolean().default(false),actor:z.string(),createdAt:z.string()});
export type ReviewDecision=z.infer<typeof ReviewDecision>;
async function fileHash(file:string){const digest=createHash("sha256");for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest("hex");}
const json=(file:string)=>fs.readFile(file,"utf8").then(JSON.parse,()=>null);
/** Decisions authorize exactly one immutable output and evidence bundle; children never inherit approvals. */
export class StudioReviewStore{
 constructor(readonly store:DataStore){}
 async context(id:string){
  const run=await new StudioStore(this.store).run(id);if(!run)throw new Error("Production not found");
  const dir=this.store.p("studio","artifacts",id),qa=await json(path.join(dir,"qa.json")),research=await json(path.join(dir,"research.json"));
  const videoHash=run.state==="ready"&&run.outputs.includes("final.mp4")?await fileHash(path.join(dir,"final.mp4")):null;
  const provenance:Record<string,string|null>={};for(const name of["timeline.json","localization-transcript.json","localization-translation.json","shorts-transcript.json","shorts-selection.json","manifest.json","product-evidence.json","product-invalidation.json","caption-quality.json","source-analysis.json"])provenance[name]=await fileHash(path.join(dir,name)).catch(()=>null);
  const fingerprint=hash({runId:run.id,snapshot:run.snapshotHash,sources:run.sources,videoHash,qa,research,provenance,edit:run.edit});
  const decisions=(await new StudioStore(this.store).list("reviews",ReviewDecision)).filter(r=>r.runId===id&&r.fingerprint===fingerprint).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const gates=ReviewCategory.options.map(category=>{
   const decision=decisions.find(r=>r.category===category);const quoteBlocked=category==="facts"&&research?.claims?.some((c:any)=>c.status==="UNVERIFIED");
   return {category,status:quoteBlocked?"BLOCKED":decision?.decision??"NEEDS_REVIEW",decision:decision??null,reason:quoteBlocked?"A cited quote is absent from retrieved evidence; revise the script or source first":category==="rights"?"Review source ownership, platforms, scope, expiry and voice/graphic rights":category==="facts"?"Check claims against independent evidence; matching text does not establish truth":category==="voice"?"Listen to pronunciation, language, pacing and synchronization":"Review hook, narrative, visual agreement, captions and brand"};
  });
  const productPublicationDescription=run.snapshot.family==="product"?await fs.readFile(path.join(dir,"product-publication-description.txt"),"utf8").catch(()=>""):"";
  return {run,qa,research,productPublicationDescription,videoHash,fingerprint,gates,contentApproved:run.state==="ready"&&qa?.technical===true&&gates.every(g=>g.status==="APPROVED")};
 }
 async decide(input:unknown,actor="studio-ui"){
  const value=z.object({requestId:z.string().uuid().optional(),runId:z.string().uuid(),category:ReviewCategory,decision:z.enum(["APPROVED","REJECTED","DEFERRED"]),fingerprint:z.string(),evidence:z.string().trim().min(12).max(6000),highRiskAcknowledged:z.boolean().default(false)}).parse(input);
  return withLock(this.store.p("locks",`studio-review-${value.runId}.lock`),async()=>{
   if(value.requestId){const prior=await readJson(this.store.p("studio","reviews",`${value.requestId}.json`),ReviewDecision);if(prior){if(prior.actor!==actor||prior.runId!==value.runId||prior.fingerprint!==value.fingerprint||prior.category!==value.category||prior.decision!==value.decision)throw new Error("Review request identity changed");return prior;}}
   const context=await this.context(value.runId);if(context.fingerprint!==value.fingerprint)throw new Error("Output or evidence changed. Reload and inspect the current version.");
   if(context.run.state!=="ready"||!context.videoHash)throw new Error("Review requires a completed real output");
   if(value.decision==="APPROVED"){
    if(!context.qa?.technical)throw new Error("Technical QA failed; repair the output first");
    if(context.gates.find(g=>g.category===value.category)?.status==="BLOCKED")throw new Error("Missing citation evidence cannot be bypassed with an approval");
    if(value.category==="facts"&&context.research?.claims?.some((c:any)=>c.status==="HIGH_RISK_REVIEW")&&!value.highRiskAcknowledged)throw new Error("High-risk claims require explicit acknowledgement and evidence");
   }
   const latest=Math.max(0,...context.gates.map(g=>Date.parse(g.decision?.createdAt??"")||0));
   const row=ReviewDecision.parse({...value,id:value.requestId??randomUUID(),actor,createdAt:new Date(Math.max(Date.now(),latest+1)).toISOString()});await writeJsonAtomic(this.store.p("studio","reviews",`${row.id}.json`),row);await this.store.audit({actor,action:"studio.review",subject:value.runId,detail:{category:value.category,decision:value.decision,fingerprint:value.fingerprint}});return row;
  });
 }
 async inbox(){const rows=[];for(const run of await new StudioStore(this.store).runs()){
  if(run.state==="ready"){const c=await this.context(run.id);if(!c.contentApproved)rows.push({run,kind:"QUALITY_REVIEW",gates:c.gates,fingerprint:c.fingerprint});}
  else if(["needs_input","failed"].includes(run.state))rows.push({run,kind:run.error?.includes("RIGHTS")?"NEEDS_RIGHTS":run.error?.includes("PROVIDER")?"PLATFORM_PERMISSION":"RETRY_EXHAUSTED",gates:[],fingerprint:null});
 }return rows.sort((a,b)=>b.run.updatedAt.localeCompare(a.run.updatedAt));}
}
