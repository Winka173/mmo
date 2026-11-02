import * as fs from "node:fs/promises";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import sharp from "sharp";
import {StudioStore,StudioRun,hash} from "@ttm/automation";
import {buildContext} from "../apps/worker/src/context.js";
import {matchStudioShots} from "../apps/worker/src/studio-matching.js";

async function main(){
 const root=path.resolve(".local/benchmarks/media-matching",String(Date.now())),folder=path.join(root,"owned-cards"),ctx=await buildContext({dataDir:path.join(root,"data")}),studio=new StudioStore(ctx.store);await fs.mkdir(folder,{recursive:true});
 await ctx.store.updateSettings(settings=>({...settings,paused:false,killSwitch:false,externalPostingEnabled:false,telegram:{...settings.telegram,enabled:false}}),"matching-owned-fixture");
 const config=await studio.saveConfig({pythonEmbedding:path.resolve(".local/engines/asr/Scripts/python.exe"),embeddingModel:path.resolve(".local/models/qwen3-embedding-0.6b"),embeddingDevice:"cpu",ffprobe:path.resolve(".local/tools/ffprobe.exe")});
 const rows=[{name:"dragon.png",color:"red",description:"Owner annotation: a dragon boss battle with fire attacks in a fantasy game."},{name:"farm.png",color:"green",description:"Owner annotation: farming, harvesting wheat and tending crops in a peaceful village."},{name:"space.png",color:"blue",description:"Owner annotation: a spacecraft launches from Earth and travels into orbit."}];
 const sourceRows=[];for(const row of rows){const file=path.join(folder,row.name);await sharp({create:{width:160,height:90,channels:3,background:row.color}}).png().toFile(file);const bytes=await fs.readFile(file);sourceRows.push({file,sha256:createHash("sha256").update(bytes).digest("hex"),size:bytes.length});}
 await fs.writeFile(path.join(folder,"acs-media.json"),JSON.stringify({version:1,assets:rows.map((row,index)=>({file:row.name,sha256:sourceRows[index].sha256,description:row.description}))},null,2));
 const now=new Date().toISOString(),pilot=await studio.saveAutopilot({id:randomUUID(),name:"Owner-labelled color-card matching protocol",family:"custom",sourceFolder:folder,rights:"AUTHORIZED_REUSE",rightsEvidence:"Original generated solid-color cards. Descriptions are artificial semantic labels only, not visual/gameplay evidence.",createdAt:now,updatedAt:now});
 const run=StudioRun.parse({id:randomUUID(),autopilotId:pilot.id,title:pilot.name,language:"en-US",snapshot:pilot,snapshotHash:hash(pilot),config,sources:sourceRows,shots:[{text:"Gather the ripe wheat and cultivate your village fields."},{text:"Launch a spaceship into orbit around our planet."},{text:"Defeat the fire-breathing dragon in the final boss encounter."}],stages:[],createdAt:now,updatedAt:now}),dir=ctx.store.p("studio","artifacts",run.id);await fs.mkdir(dir,{recursive:true});
 const evidence:any={status:"RUNNING",at:now,fixture:"Owned solid-color cards with artificial owner metadata; NOT visual understanding or actual gameplay",device:"cpu",data:ctx.store.root,runId:run.id,publicPosting:false,humanMeaningReview:"NOT_CREATED"},began=Date.now();
 try{const result=await matchStudioShots(ctx,run,dir);if(!result)throw new Error("Matching returned no report");const expected=[sourceRows[1].sha256,sourceRows[2].sha256,sourceRows[0].sha256],actual=result.assignments.map((row:any)=>row.sha256);if(JSON.stringify(expected)!==JSON.stringify(actual))throw new Error("Controlled semantic-label ranking differs from expected");
  const requestCount=(await fs.readdir(dir)).filter(file=>file.endsWith(".request.json")).length;const cached=await matchStudioShots(ctx,run,dir);if(cached?.reportSha256!==result.reportSha256||(await fs.readdir(dir)).filter(file=>file.endsWith(".request.json")).length!==requestCount)throw new Error("Repeated matching did not reuse pinned evidence");
  Object.assign(evidence,{status:"VERIFIED_LOCAL_CPU_TEXT_EMBEDDING_WITH_OWNER_METADATA_NOT_VISUAL_CERTIFICATION",seconds:(Date.now()-began)/1000,matchingReport:path.join(dir,"source-matching.json"),reportSha256:result.reportSha256,embedding:result.embedding,assignments:result.assignments,expectedSha256:expected,actualSha256:actual,cacheReused:true,publicationApproval:result.publicationApproval});console.log(JSON.stringify({status:evidence.status,seconds:evidence.seconds,assignments:actual}));
 }catch(error:any){evidence.status="FAILED";evidence.error=error.message;throw error;}finally{await fs.writeFile("docs/evidence/acs-media-matching.json",JSON.stringify(evidence,null,2));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
