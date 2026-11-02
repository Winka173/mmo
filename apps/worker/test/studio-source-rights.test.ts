import {describe,it,expect} from "vitest";
import * as fs from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {StudioStore} from "@ttm/automation";
import {buildContext} from "../src/context.js";
import {runJob} from "../src/handlers.js";
import {tmpDir} from "../../../packages/storage/test/helpers.js";
describe("Recorded source authorization before any media or AI processing",()=>{
 it("holds missing translation/dub scopes, expired rights and missing cut permission without touching source",async()=>{
  for(const [family,reusePermissions] of[["localization",{cut:true,redistribute:true}],["localization",{cut:true,translate:true,dub:true,redistribute:true,expiresAt:"2020-01-01T00:00:00Z"}],["shorts",{cut:false,redistribute:true}]] as const){
   const ctx=await buildContext({dataDir:await tmpDir("acs-rights-gate-")}),studio=new StudioStore(ctx.store),now=new Date().toISOString(),a=await studio.saveAutopilot({id:randomUUID(),family,sourceFolder:ctx.store.p("must-not-read-this-source"),brief:"Rights contract fixture",name:"Blocked source contract fixture",rights:"AUTHORIZED_REUSE",rightsEvidence:"Generic permission declaration does not grant all adaptation scopes",reusePermissions,createdAt:now,updatedAt:now});const run=await studio.enqueue(a,"en-US",randomUUID()),job=await ctx.queue.claim({maxConcurrent:1,gpuSlots:1,kinds:["STUDIO_RUN"]});expect(job).toBeTruthy();await runJob(ctx,job!);expect((await studio.run(run.id))?.state).toBe("needs_input");const files=await fs.readdir(ctx.store.p("studio","artifacts",run.id));expect(files.some(f=>f.endsWith("request.json")||f.startsWith("source-"))).toBe(false);expect((await ctx.queue.get(job!.id))?.state).toBe("manual_action");
  }
 });
});
