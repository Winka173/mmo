import * as fs from "node:fs/promises";
import path from "node:path";
import {buildContext} from "../apps/worker/src/context.js";
import {StudioStore,StudioMediaCatalog} from "@ttm/automation";
async function main(){
 const root=process.cwd(),base=path.resolve(process.env.ACS_P0_UI_ROOT??"");if(!base.startsWith(path.join(root,".local/p0-ui")+path.sep))throw new Error("Isolated UI fixture only");
 const fixtureFile=path.join(base,"fixture.json"),fixture=JSON.parse(await fs.readFile(fixtureFile,"utf8")),proof=JSON.parse(await fs.readFile("docs/evidence/acs-media-vision.json","utf8"));
 const ctx=await buildContext({dataDir:fixture.data}),studio=new StudioStore(ctx.store),original=await buildContext({dataDir:proof.data}),oldStudio=new StudioStore(original.store),run=(await oldStudio.run(proof.runId))!;
 const speech=JSON.parse(await fs.readFile("docs/evidence/acs-frame-speech-e2e.json","utf8")),speechCtx=await buildContext({dataDir:speech.data}),cut=await new StudioStore(speechCtx.store).run(speech.cut.id);
 if(cut){await fs.cp(speechCtx.store.p("studio","artifacts",cut.id),ctx.store.p("studio","artifacts",cut.id),{recursive:true});await studio.saveRun(cut);fixture.compareId=cut.id;}
 if(!run)throw new Error("Actual prior vision fixture absent");
 const oldDir=original.store.p("studio","artifacts",run.id),dir=ctx.store.p("studio","artifacts",run.id);await fs.cp(oldDir,dir,{recursive:true});
 const sources=run.sources.map(s=>({...s,file:path.join(dir,path.basename(s.file))}));run.shots=run.shots.map(s=>({...s,asset:sources[run.sources.findIndex(old=>old.file===s.asset)]?.file??s.asset}));run.sources=sources;
 await studio.saveAutopilot({...run.snapshot,enabled:false});await studio.saveRun(run);
 const oldCatalog=new StudioMediaCatalog(original.store),catalog=new StudioMediaCatalog(ctx.store),task=(await oldCatalog.vision(proof.taskId))!;
 if(task?.state!=="ready")throw new Error("Prior actual vision task absent");await fs.cp(original.store.p("studio","media-vision",task.id),ctx.store.p("studio","media-vision",task.id),{recursive:true});await catalog.saveVision({...task,sourceFile:sources.find(s=>s.sha256===task.sourceSha256)!.file});
 await fs.writeFile(fixtureFile,JSON.stringify({...fixture,mediaRunId:run.id,mediaSourceSha:task.sourceSha256,visionTaskId:task.id,visionScope:"Reuse prior actual flagged vision suggestion; no new inference or owner acceptance"},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
