import * as fs from "node:fs/promises";
import path from "node:path";
import {buildContext} from "../apps/worker/src/context.js";
import {executeModelSetup} from "../apps/worker/src/model-setup.js";
import {invokeLocalEngine} from "../apps/worker/src/local-engine.js";
import {StudioStore,ModelSetupStore,VoiceStore,discoverStudioTools} from "@ttm/automation";
async function main(){
 const root=process.cwd(),ctx=await buildContext({dataDir:path.join(root,".local/vad-benchmark",String(Date.now()),"data")}),studio=new StudioStore(ctx.store),registry=new ModelSetupStore(ctx.store),voices=new VoiceStore(ctx.store),installed=JSON.parse(await fs.readFile(".local/llm-setup/data/config/studio.json","utf8"));await studio.saveConfig((await discoverStudioTools(root,installed)).config);
 const report:any={status:"RUNNING",at:new Date().toISOString(),source:"https://github.com/snakers4/silero-vad",localOnly:true,device:"cpu",wordTiming:"NOT_PROVIDED",humanReview:"NOT_REVIEWED"};
 try{
  const setup=await registry.enqueue({profile:"silero-vad",root});await executeModelSetup(ctx,setup.id);const saved=(await registry.get(setup.id))!;if(saved.state!=="installed"||!saved.resultConfig)throw new Error(saved.error??"VAD setup failed");await studio.saveConfig(saved.resultConfig);
  const native=JSON.parse(await fs.readFile("docs/evidence/acs-installed-smoke.json","utf8"));for(const v of native.voices){const original=new VoiceStore((await buildContext({dataDir:path.join(root,".local/native-smoke/data")})).store),row=await original.get(v.id);if(!row)throw new Error("Actual native audition missing");await voices.save(row);await fs.mkdir(path.dirname(voices.audio(row.id)),{recursive:true});await fs.copyFile(original.audio(row.id),voices.audio(row.id));}
  if((await voices.list()).length!==2)throw new Error("Benchmark requires actual VI and EN auditions");const verify=await registry.enqueue({profile:"silero-vad",root,mode:"verify"});await executeModelSetup(ctx,verify.id);const verification=await registry.get(verify.id);if(verification?.state!=="verified")throw new Error("VAD speech/silence check failed");
  const samples=await voices.list(),evidence=await invokeLocalEngine(ctx,await studio.config(),{op:"vad",audio:samples.map(v=>voices.audio(v.id))},ctx.store.p("vad-languages.request.json"));if(evidence.results.some((r:any)=>!r.speech.length||r.speech_ratio<=0))throw new Error("VAD found no activity in an actual voice sample");
  Object.assign(report,{status:"VERIFIED_LOCAL_CPU_VOICE_ACTIVITY_FIXTURES",setupId:setup.id,verifyId:verify.id,modelSha256:saved.resultConfig.vadSha256,verification:verification.progress,evidence,localesOfInput:samples.map(v=>v.language),checks:["selected model profile downloads pinned 2.2 MB checkpoint and MIT license","existing isolated ASR Python environment used without package mutation","known silence produces no speech intervals","actual VI and EN native audition WAVs produce speech intervals","CPU mode explicitly recorded; no GPU lease/cloud inference","no word alignment or language recognition inferred from VAD"]});console.log(JSON.stringify({status:report.status,seconds:evidence.seconds,ratios:evidence.results.map((r:any)=>r.speech_ratio)}));
 }catch(error:any){report.status="BLOCKED_OR_FAILED";report.error=error.message;throw error;}finally{await fs.writeFile(path.join(root,report.status.startsWith("VERIFIED")?"docs/evidence/acs-vad-inference.json":"docs/evidence/acs-vad-latest-attempt.json"),JSON.stringify(report,null,2));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
