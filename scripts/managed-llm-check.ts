import path from "node:path";
import * as fs from "node:fs/promises";
import {buildContext} from "../apps/worker/src/context.js";
import {StudioStore,ModelSetupStore} from "@ttm/automation";
import {runJob} from "../apps/worker/src/handlers.js";
import {stopManagedLlm} from "../apps/worker/src/managed-llm.js";
async function main(){
 const root=process.cwd(),ctx=await buildContext({dataDir:path.join(root,".local/llm-setup/data")}),studio=new StudioStore(ctx.store);
 await studio.saveConfig({...await studio.config(),python:path.join(root,".local/engines/speech/Scripts/python.exe"),llmDevice:"cuda"});
 await ctx.store.updateSettings(s=>({...s,paused:false,killSwitch:false}),"llm-benchmark");
 const row=await new ModelSetupStore(ctx.store).enqueue({profile:"qwen3.5-9b",mode:"verify",root}),job=await ctx.queue.claim({kinds:["STUDIO_SETUP"],maxConcurrent:1,gpuSlots:1});if(!job)throw new Error("Verification job not available");
 try{await runJob(ctx,job);const result=await new ModelSetupStore(ctx.store).get(row.id);await fs.writeFile(path.join(root,result?.state==="verified"?"docs/evidence/acs-managed-llm.json":"docs/evidence/acs-managed-llm-latest-attempt.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(result?.state!=="verified")process.exitCode=2;}finally{stopManagedLlm();}
}
main().catch(error=>{console.error(error);stopManagedLlm();process.exitCode=1;});
