import * as fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {StudioConfig,ModelSetupStore,StudioStore,discoverStudioTools} from "@ttm/automation";
import {buildContext} from "../apps/worker/src/context.js";
import {executeModelSetup} from "../apps/worker/src/model-setup.js";
async function main(){
const root=process.cwd(),base=path.join(root,".local","p0-setup-preflight",randomUUID()),fresh=path.join(base,"Fresh ACS setup"),ctx=await buildContext({dataDir:path.join(base,"data")});
const previous=JSON.parse(await fs.readFile(path.join(root,".local","llm-setup","data","config","studio.json"),"utf8"));
const config=StudioConfig.parse((await discoverStudioTools(root,StudioConfig.parse(previous))).config);await new StudioStore(ctx.store).saveConfig(config);
const registry=new ModelSetupStore(ctx.store),results=[];
for(const profile of ["qwen3.5-9b","kokoro","vieneu","qwen-asr"] as const){const queued=await registry.enqueue({profile,root:fresh,mode:"preflight"});await executeModelSetup(ctx,queued.id);const saved=await registry.get(queued.id);results.push({id:saved!.id,profile,state:saved!.state,preflight:saved!.progress.preflight});}
const folderCreated=await fs.access(fresh).then(()=>true,()=>false);
if(folderCreated||results.some(result=>result.state!=="checked"))throw new Error("Read-only preflight invariant failed");
const report={status:"VERIFIED_READ_ONLY_PREFLIGHT_ON_EXISTING_WINDOWS_MACHINE",checkedAt:new Date().toISOString(),dataDir:ctx.store.root,freshTarget:fresh,targetCreated:folderCreated,modelsLoaded:false,gpuLeaseAcquired:false,downloadsPerformed:false,cleanWindowsVmTested:false,results,runtimeBootstrap:{status:"IMPLEMENTED_UNVERIFIED_UPSTREAM_DOWNLOAD",contractAndWindowsExtractionTests:"docs/evidence/acs-p0-setup-tests.json",officialSource:"https://api.github.com/repos/ollama/ollama/releases/tags/v0.40.8",sha256:"04d1d43ac62c2deb0393307bb49fed7caf6b192de41bdd497aaa9488089d5552",archiveBytes:1582537058}};
await fs.writeFile(path.join(root,"docs","evidence","acs-p0-setup-preflight.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,targetCreated:folderCreated,profiles:results.map(result=>({profile:result.profile,state:result.state,ready:(result.preflight as any).readyToInstall}))},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
