import {afterEach,describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {DataStore,writeJsonAtomic} from "@ttm/storage";
import {Autopilot,StudioStore} from "../src/studio.js";
import {StudioReviewStore,ReviewCategory} from "../src/review.js";
import {StudioPublishingStore} from "../src/studio-publishing.js";
import {StudioDeliveryPolicyStore} from "../src/studio-delivery-policy.js";

// Contract-only fixtures. Dummy bytes are never sent to any provider or represented as real media.
const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await fs.rm(dir,{recursive:true,force:true});});
async function fixture({approved=true,extraRuns=0}:{approved?:boolean;extraRuns?:number}={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"acs-delivery-policy-fixture-"));dirs.push(dir);
  const store=new DataStore(dir);await store.init();const studio=new StudioStore(store),publishing=new StudioPublishingStore(store),review=new StudioReviewStore(store),policies=new StudioDeliveryPolicyStore(store),now=new Date();
  const pilot=await studio.saveAutopilot(Autopilot.parse({id:randomUUID(),name:"Synthetic delivery fixture",enabled:true,brief:"Synthetic reviewed-delivery contract fixture",sourceFolder:path.join(dir,"synthetic-authorized-source"),rights:"AUTHORIZED_REUSE",rightsEvidence:"Synthetic fixture rights evidence; no real content",languages:["en-US"],createdAt:now.toISOString(),updatedAt:now.toISOString()}));
  const channel=await publishing.saveChannel({id:randomUUID(),name:"Synthetic local test channel",platform:"youtube_long",expectedRemoteId:"UC"+"A".repeat(22),enabled:true});
  await publishing.setPostingEnabled(true);
  const runIds:string[]=[];
  for(let index=0;index<=extraRuns;index++){
    const {id}=await studio.enqueue(pilot,"en-US",`synthetic-policy-fixture-${index}`),run=(await studio.run(id))!;runIds.push(id);
    await studio.saveRun({...run,state:"ready",outputs:["final.mp4","qa.json"]});
    await writeJsonAtomic(store.p("studio","artifacts",id,"qa.json"),{technical:true,fixture:true});
    await fs.writeFile(store.p("studio","artifacts",id,"final.mp4"),`SYNTHETIC CONTRACT BYTES — NOT A REAL VIDEO ${index}`);
    if(approved){const context=await review.context(id);for(const category of ReviewCategory.options)await review.decide({runId:id,category,decision:"APPROVED",fingerprint:context.fingerprint,evidence:"Explicit synthetic fixture scoped review; not a real approval"},"synthetic-test-fixture");}
  }
  const input={name:"Synthetic scoped delivery authorization",autopilotId:pilot.id,channelId:channel.id,enabled:true,languages:["en-US"],privacy:"private",dailyLimit:2,weeklyLimit:5,timezone:"UTC",startHour:0,endHour:24,expiresAt:new Date(now.getTime()+7*86400000).toISOString(),authorize:true};
  return {dir,store,studio,publishing,review,policies,pilot,channel,now,runIds,input};
}

describe("Persistent delivery policy (local synthetic fixtures, no providers)",()=>{
  it("has no policy or delivery candidates by default and requires explicit authorization",async()=>{
    const f=await fixture();expect(await f.policies.list()).toEqual([]);expect((await f.policies.tick()).candidates).toEqual([]);
    await expect(f.policies.save({...f.input,authorize:false})).rejects.toThrow();
  });
  it("requires all four independently scoped content reviews; policy authorization never creates reviews",async()=>{
    const f=await fixture({approved:false});await f.policies.save(f.input);
    const context=await f.review.context(f.runIds[0]);
    for(const category of ["editorial","voice","facts"] as const)await f.review.decide({runId:f.runIds[0],category,decision:"APPROVED",fingerprint:context.fingerprint,evidence:"Explicit fixture scoped content review"},"synthetic-test-fixture");
    const result=await f.policies.tick();expect(result.candidates).toHaveLength(0);expect(result.holds[0].reason).toContain("four");
    expect((await f.review.context(f.runIds[0])).gates.find(g=>g.category==="rights")?.status).toBe("NEEDS_REVIEW");
  });
  it("dry-run projects quotas without writing reservations or publications",async()=>{
    const f=await fixture({extraRuns:2});await f.policies.save({...f.input,dailyLimit:1});
    const result=await f.policies.tick({dryRun:true});expect(result.candidates).toHaveLength(1);expect(result.holds).toHaveLength(2);
    expect(await f.policies.reservations()).toEqual([]);expect(await f.publishing.list()).toEqual([]);
  });
  it("reserves once, preserves idempotency across restarts and returns protected policy provenance",async()=>{
    const f=await fixture();const policy=await f.policies.save(f.input);
    const first=await f.policies.tick(),second=await new StudioDeliveryPolicyStore(f.store).tick();
    expect(first.candidates).toHaveLength(1);expect(second.candidates[0].reservationId).toBe(first.candidates[0].reservationId);
    expect(first.candidates[0].provenance).toMatchObject({actor:"studio-delivery-policy",policyId:policy.id,policyRevision:policy.revision});
    expect(await f.policies.reservations()).toHaveLength(1);expect(await f.publishing.list()).toEqual([]);
    await expect(f.policies.validateReservation(first.candidates[0].reservationId)).resolves.toMatchObject({payload:{runId:f.runIds[0]}});
  });
  it("counts pending reservations toward channel-wide quotas across policy revisions",async()=>{
    const f=await fixture({extraRuns:2});const policy=await f.policies.save({...f.input,dailyLimit:1});
    const first=await f.policies.tick();expect(first.candidates).toHaveLength(1);
    const {id,revision}=policy;await f.policies.save({...f.input,id,revision,dailyLimit:1});
    const second=await f.policies.tick();expect(second.candidates).toHaveLength(0);expect(second.holds.some(h=>h.reason.includes("limit"))).toBe(true);
  });
  it("prevents concurrent planners from exceeding durable caps",async()=>{
    const f=await fixture({extraRuns:2});await f.policies.save({...f.input,dailyLimit:1});
    const results=await Promise.all([f.policies.tick(),new StudioDeliveryPolicyStore(f.store).tick()]);
    expect(new Set(results.flatMap(r=>r.candidates.map(c=>c.reservationId))).size).toBe(1);expect(await f.policies.reservations()).toHaveLength(1);
  });
  it("supports revocation and keeps immutable authorization revisions",async()=>{
    const f=await fixture();const policy=await f.policies.save(f.input),candidate=(await f.policies.tick()).candidates[0];
    const revoked=await f.policies.revoke(policy.id,policy.revision);
    expect(revoked.enabled).toBe(false);expect(JSON.parse(await fs.readFile(f.store.p("studio","delivery-policy-revisions",policy.id,`r${policy.revision}.json`),"utf8")).enabled).toBe(true);
    await expect(f.policies.validateReservation(candidate.reservationId)).rejects.toThrow("revoked");
  });
  it("holds a disabled global posting policy, pause and kill switch",async()=>{
    const f=await fixture();await f.policies.save(f.input);await f.publishing.setPostingEnabled(false);
    expect((await f.policies.tick()).candidates).toHaveLength(0);
    await f.publishing.setPostingEnabled(true);
    await f.store.updateSettings(flags=>({...flags,paused:true}),"contract-test");
    expect((await f.policies.tick()).holds[0].reason).toContain("paused");
  });
  it("rejects changed pilot revisions and local production settings",async()=>{
    const f=await fixture();await f.policies.save(f.input);await f.studio.saveAutopilot({...f.pilot,tone:"changed fixture settings"});
    expect((await f.policies.tick()).holds[0].reason).toContain("revision");
    const g=await fixture();await g.policies.save(g.input);await g.studio.saveConfig({...await g.studio.config(),voiceEn:"changed-fixture-voice"});
    expect((await g.policies.tick()).holds[0].reason).toContain("production settings");
  });
  it("rejects changed channel identity revisions and edited reviewed bytes",async()=>{
    const f=await fixture();await f.policies.save(f.input);const candidate=(await f.policies.tick()).candidates[0];
    await f.publishing.saveChannel({...f.channel,name:"Changed fixture channel"});
    await expect(f.policies.validateReservation(candidate.reservationId)).rejects.toThrow("Channel revision");
    const g=await fixture();await g.policies.save(g.input);const second=(await g.policies.tick()).candidates[0];
    await fs.appendFile(g.store.p("studio","artifacts",g.runIds[0],"final.mp4"),"changed synthetic bytes");
    await expect(g.policies.validateReservation(second.reservationId)).rejects.toThrow("four");
  });
  it("holds embargo, posting hours and expiry at planning and preflight",async()=>{
    const f=await fixture(),hour=f.now.getUTCHours();
    await f.policies.save({...f.input,embargoUntil:new Date(f.now.getTime()+3600000).toISOString()});
    expect((await f.policies.tick({now:f.now})).holds[0].reason).toContain("embargo");
    const g=await fixture();await g.policies.save({...g.input,startHour:(hour+2)%24,endHour:(hour+3)%24||24});
    expect((await g.policies.tick({now:g.now})).holds[0].reason).toContain("hours");
    const h=await fixture();const policy=await h.policies.save(h.input),candidate=(await h.policies.tick()).candidates[0];
    await expect(h.policies.validateReservation(candidate.reservationId,{now:new Date(Date.parse(policy.expiresAt)+1000)})).rejects.toThrow(/expired/);
  });
  it("marks only the matching local publication queued and does not count itself against its cap",async()=>{
    const f=await fixture();await f.policies.save({...f.input,dailyLimit:1});const candidate=(await f.policies.tick()).candidates[0];
    // Explicit one-version synthetic authorization; request only enqueues a local job.
    const publication=await f.publishing.request(candidate.payload,candidate.provenance);
    await f.policies.markQueued(candidate.reservationId,publication.id);
    expect((await f.policies.tick()).candidates).toHaveLength(0);
    await expect(f.policies.validateReservation(candidate.reservationId)).resolves.toMatchObject({reservationId:candidate.reservationId});
  });
});
