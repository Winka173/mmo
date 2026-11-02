import path from "node:path";
import * as fs from "node:fs/promises";
import {buildContext} from "../apps/worker/src/context.js";
import {StudioStore,discoverStudioTools} from "@ttm/automation";
const root=process.cwd(),base=path.resolve(process.env.ACS_CREATE_UI_ROOT??"");
if(!base.startsWith(path.join(root,".local","create-ui")+path.sep))throw new Error("Choose an isolated Create UI fixture directory");
async function main(){
 const ctx=await buildContext({dataDir:path.join(base,"data")}),installed=JSON.parse(await fs.readFile(path.join(root,".local/llm-setup/data/config/studio.json"),"utf8"));
 const detected=await discoverStudioTools(root,installed);await new StudioStore(ctx.store).saveConfig({...detected.config,ttsDevice:"cuda",asrDevice:"cuda"});
 await ctx.store.updateSettings(settings=>({...settings,paused:false,killSwitch:false,externalPostingEnabled:false,telegram:{...settings.telegram,enabled:false}}),"isolated-create-ui-fixture");
 await fs.writeFile(path.join(base,"fixture.json"),JSON.stringify({data:ctx.store.root,source:"https://science.nasa.gov/venus/venus-facts/",languages:["en-US"],publicPosting:false}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
