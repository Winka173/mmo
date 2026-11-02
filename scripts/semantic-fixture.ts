import path from "node:path";
import * as fs from "node:fs/promises";
import {randomUUID,createHash} from "node:crypto";
import {StudioStore} from "@ttm/automation";
import {DataStore} from "@ttm/storage";
import {buildContext} from "../apps/worker/src/context.js";

/** Import actual previously rendered ACS-owned drafts; never manufacture a render. */
export async function seedSemanticFixture(base:string){
 const root=process.cwd(),data=path.join(base,"data"),ctx=await buildContext({dataDir:data}),studio=new StudioStore(ctx.store);
 await studio.saveConfig({pythonAsr:path.join(root,".local/engines/asr/Scripts/python.exe"),pythonEmbedding:path.join(root,".local/engines/asr/Scripts/python.exe"),embeddingModel:path.join(root,".local/models/qwen3-embedding-0.6b"),embeddingDevice:"cpu"});
 await ctx.store.updateSettings(settings=>({...settings,paused:false,killSwitch:false,externalPostingEnabled:false,telegram:{...settings.telegram,enabled:false}}),"internal-semantic-benchmark");
 const research=JSON.parse(await fs.readFile(path.join(root,"docs/evidence/acs-research-e2e.json"),"utf8")),owned=JSON.parse(await fs.readFile(path.join(root,"docs/evidence/acs-e2e.json"),"utf8"));
 const inputs=research.runs.map((run:any)=>({id:run.id,folder:path.dirname(run.final)}));inputs.push({id:owned.runId,folder:owned.outputs});
 const sources=[];
 for(const input of inputs){
  const sourceStore=new StudioStore(new DataStore(path.resolve(input.folder,"../../.."))),source=await sourceStore.run(input.id);
  if(source?.state!=="ready"||source.parentId)throw new Error("Semantic benchmark requires actual original ready drafts");
  const before=await fs.readFile(path.join(input.folder,"final.mp4")),sha256=createHash("sha256").update(before).digest("hex"),id=randomUUID(),target=ctx.store.p("studio","artifacts",id);
  await fs.mkdir(target,{recursive:true});await fs.cp(input.folder,target,{recursive:true});
  if(createHash("sha256").update(await fs.readFile(path.join(target,"final.mp4"))).digest("hex")!==sha256)throw new Error("Fixture media copy changed source bytes");
  await studio.saveRun({...source,id,parentId:null});
  sources.push({originalRunId:source.id,runId:id,title:source.title,language:source.language,originalMp4:path.join(input.folder,"final.mp4"),copyMp4:path.join(target,"final.mp4"),sha256});
 }
 return {ctx,studio,data,sources};
}
