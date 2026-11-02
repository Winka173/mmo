import {inspectStudioFootage} from "./studio-footage.js";
import {buildNarrationPacing} from "../../../packages/quality/src/narration-pacing.js";
import {executeStudioRepair} from "./studio-repair.js";
import {matchStudioShots} from "./studio-matching.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { z } from "zod";
import { StudioStore, hash, planRunIdentity,applyPronunciations,type StudioRun } from "@ttm/automation";
import { FactoryError,Timeline,TimelineClip } from "@ttm/core";
import { readJson, writeJsonAtomic } from "@ttm/storage";
import { runProcess, toSrt,toAss,renderTimeline,brandAss,applyBrandLogo } from "@ttm/media";
import { inspectCaptionCues } from "../../../packages/media/src/caption-quality.js";
import { buildStudioCaptions } from "./studio-caption-evidence.js";
import {alignStudioNarration} from "./studio-alignment.js";
import { reviewNarration,inspectStudioMedia,VOICE_REVIEW_POLICY_VERSION } from "@ttm/quality";
import { notify, type Ctx } from "./context.js";
import { invokeLocalEngine } from "./local-engine.js";
import {researchRun,researchIllustration} from "./research.js";
import {produceStudioShort} from "./studio-shorts.js";
import {prepareStudioLocalization} from "./studio-localization.js";

const ENGINE = process.env.ACS_ENGINE_RUNNER ?? path.resolve("engines/runner.py");
async function fileDigest(file: string) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
async function modelDigest(root: string): Promise<string> {
  if (!root) return "unconfigured";
  const stat = await fs.stat(root).catch(() => null);
  if (!stat) return "missing";
  if (stat.isFile()) return fileDigest(root);
  const entries = (await fs.readdir(root, {withFileTypes:true})).filter(e => !e.name.startsWith(".") && !["__pycache__", "acs-manifest.json"].includes(e.name)).sort((a,b)=>a.name.localeCompare(b.name));
  const hashes: unknown[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() || /\.(json|pth|pt|safetensors|onnx|data|npz|py|txt|model|bin)$/.test(entry.name)) hashes.push([entry.name, await modelDigest(path.join(root,entry.name))]);
  }
  return hash(hashes);
}
export async function executeStudio(ctx: Ctx, id: string): Promise<Record<string,unknown>> {
  const studio=new StudioStore(ctx.store); const run=await studio.run(id);
  if(!run) throw new FactoryError("RUN_MISSING","PERMANENT","Studio run not found");
  if(run.state==="ready") return {id,state:run.state};
  if(run.planning?.state==="ready")return{id,state:"plan_ready"};
  if(hash({a:run.snapshot,config:run.config})!==run.snapshotHash) throw new FactoryError("QUALITY_LOCK","BLOCKED","Snapshot hash changed");
  const dir=ctx.store.p("studio","artifacts",id);await fs.mkdir(dir,{recursive:true});
  const safePoint=async()=>{
    const settings=await ctx.settings();const control=await readJson(ctx.store.p("studio","controls",`${id}.json`),z.object({paused:z.boolean().default(false),cancelled:z.boolean().default(false)}));
    if(control?.cancelled)throw new FactoryError("STUDIO_CANCELLED","PERMANENT","Cancelled; completed artifacts preserved / Đã hủy; giữ các artifact đã xong");
    if(run.snapshot.sourceFolder&&run.snapshot.rights==="AUTHORIZED_REUSE"){
      const current=await studio.autopilot(run.autopilotId),p=current?.reusePermissions;
      if(!current||current.rights!=="AUTHORIZED_REUSE"||p?.expiresAt&&Date.parse(p.expiresAt)<=Date.now()||["localization","shorts"].includes(run.snapshot.family)&&(!p?.cut||!p.redistribute||run.snapshot.family==="localization"&&(!p.translate||!p.dub)))throw new FactoryError("HOLD_RIGHTS","HUMAN_REQUIRED","Current source permission was revoked, expired or removed; completed artifacts retained");
    }
    if(settings.paused||settings.killSwitch||control?.paused)throw new FactoryError("STUDIO_PAUSED","RETRYABLE","Paused at a safe boundary / Tạm dừng tại ranh giới an toàn",{retryAfter:new Date(Date.now()+30000).toISOString()});
  };
  const stage=async(key:string,state:StudioRun["stages"][number]["state"],note="")=>{
    if(state==="running")await safePoint();
    const item=run.stages.find(s=>s.id===key)!;item.state=state;item.note=note;
    if(state==="running")item.startedAt=new Date().toISOString();else item.finishedAt=new Date().toISOString();
    await studio.saveRun(run);ctx.log(`[studio ${id.slice(0,8)}] ${key}: ${state} ${note}`);
  };
  const command=async(bin:string,args:string[],timeoutMs=600000)=>{
    await safePoint();
    const result=await runProcess(bin,args,{cwd:dir,timeoutMs});
    await fs.appendFile(path.join(dir,"engine.log"),JSON.stringify({at:new Date().toISOString(),bin,args,code:result.code,stderr:result.stderr.slice(-12000)})+"\n");
    if(result.code!==0){
      let engineError="";try{engineError=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)??"{}").error??"";}catch{}
      throw new Error(engineError||result.stderr.slice(-1500)||result.stdout.slice(-1500)||`${bin} exit ${result.code}`);
    }
    return result;
  };
  const engine=async(op:Record<string,unknown>,key:string)=>{
    await safePoint();
    return invokeLocalEngine(ctx,run.config,op,path.join(dir,`${key}.request.json`));
  };
  const probe=async(file:string)=>{
    const r=await command(run.config.ffprobe,["-v","error","-show_format","-show_streams","-of","json",file]);return JSON.parse(r.stdout);
  };
  let active="intake";
  try {
    if(run.planning?.state==="continuing"){
      const bytes=await fs.readFile(path.join(dir,"plan.json"));const plan=JSON.parse(bytes.toString("utf8"));
      if(createHash("sha256").update(bytes).digest("hex")!==run.planning.sha256||planRunIdentity(plan)!==planRunIdentity(run))throw new FactoryError("QUALITY_LOCK","BLOCKED","Pinned plan changed; create a new plan");
    }
    run.state="running";run.error=null;await studio.saveRun(run);
    if(run.parentId&&["timeline","cut"].includes(run.edit?.kind??"")){
      for(const file of["research.json","citations.md","product-evidence.json","product-invalidation.json","product-publication-description.txt","source-analysis.json","source-intake.json","source-matching.json","source-matching-input.json","source-transcript.json","shorts-plan.json","shorts-selection.json","localization-transcript.json","localization-translation.json"])if(!(await fs.stat(path.join(dir,file)).catch(()=>null)))await fs.copyFile(ctx.store.p("studio","artifacts",run.parentId,file),path.join(dir,file)).catch(()=>undefined);
    }
    if(run.edit?.kind==="timeline"&&run.parentId){
      const timeline=await studio.timeline(id);if(!timeline)throw new Error("Timeline version missing");await stage("intake","passed","Immutable track sources and parent retained");
      for(const s of run.stages.filter(s=>!["intake","render","quality","eligibility","delivery","captions","preview"].includes(s.id)))await stage(s.id,"skipped","Timeline edit; no AI generation");
      active="render";await stage(active,"running");
      if(run.repair){const result=await executeStudioRepair(ctx,run,timeline,dir,command);await writeJsonAtomic(path.join(dir,"repair-execution.json"),result);await stage("repair","passed",`Targeted ${run.repair.kind} repair attempt ${run.repair.attempt}/2; no AI inference; QA still required`);}
      else await renderTimeline(timeline,{dir,ffmpeg:run.config.ffmpeg,run:command});
      await stage(active,"passed","Rendered editable tracks; no AI inference");
      await stage("captions",timeline.captionTiming==="aligned"?"passed":"flagged",`Editable captions; timing ${timeline.captionTiming}`);await stage("preview","passed","Track-based preview ready");
    }else if(run.edit?.kind === "cut" && run.parentId){
      const parent=await studio.run(run.parentId);if(!parent||parent.state!=="ready")throw new Error("Parent render unavailable");
      const original=ctx.store.p("studio","artifacts",parent.id,"final.mp4");const p=await probe(original);const duration=Number(p.format.duration);
      if(run.edit.end>=duration)throw new Error("Cut must leave content after the removed range");
      await stage("intake","passed","Immutable parent render");
      for(const s of run.stages.filter(s=>!["intake","render","quality","eligibility","delivery"].includes(s.id)))await stage(s.id,"skipped","Deterministic cut; no AI generation");
      active="render";await stage(active,"running");const {start,end}=run.edit;
      const filter=start===0?`[0:v]trim=start=${end},setpts=PTS-STARTPTS[v];[0:a]atrim=start=${end},asetpts=PTS-STARTPTS[a]`:`[0:v]split[v0][v1];[v0]trim=end=${start},setpts=PTS-STARTPTS[x];[v1]trim=start=${end},setpts=PTS-STARTPTS[y];[0:a]asplit[a0][a1];[a0]atrim=end=${start},asetpts=PTS-STARTPTS[b];[a1]atrim=start=${end},asetpts=PTS-STARTPTS[c];[x][b][y][c]concat=n=2:v=1:a=1[v][a]`;
      await command(run.config.ffmpeg,["-y","-i",original,"-filter_complex",filter,"-map","[v]","-map","[a]","-c:v","libx264","-preset","medium","-crf","20","-c:a","aac","-movflags","+faststart","final.mp4"]);
      await stage(active,"passed","Cut applied without AI; parent preserved");
    }else if(run.snapshot.family==="shorts"){
      await produceStudioShort(ctx,run,dir,{stage:async(key,state,note)=>{if(state==="running")active=key;await stage(key,state,note);},command,engine});
    }else{
      if (run.edit?.kind === "narration" && run.parentId) {
        const parent = await studio.run(run.parentId);
        if (!parent || parent.state !== "ready") throw new Error("Parent narration version unavailable");
        const parentDir = ctx.store.p("studio", "artifacts", parent.id);
        const pin = path.join(dir, "voice-model-pin.json");
        if (!(await fs.stat(pin).catch(() => null))) await fs.copyFile(path.join(parentDir, "voice-model-pin.json"), pin).catch(() => undefined);
        for(const file of["research.json","citations.md","product-evidence.json","product-invalidation.json","product-publication-description.txt","source-analysis.json","source-intake.json","source-matching.json","source-matching-input.json","localization-transcript.json","localization-translation.json"])if(!(await fs.stat(path.join(dir,file)).catch(()=>null)))await fs.copyFile(path.join(parentDir,file),path.join(dir,file)).catch(()=>undefined);
        for (let i = 0; i < run.shots.length; i++) {
          for (const file of [`voice-${i}.wav`, `voice-${i}.json`, `segment-${i}.mp4`, `segment-${i}.hash`]) {
            const dest = path.join(dir, file);
            if (!(await fs.stat(dest).catch(() => null))) await fs.copyFile(path.join(parentDir, file), dest).catch(() => undefined);
          }
        }
      }
      if(run.snapshot.family==="localization")await prepareStudioLocalization(ctx,run,dir,{stage:async(key,state,note)=>{if(state==="running")active=key;await stage(key,state,note);},command,engine});
      await stage("intake","running");
      const researched=["facts","product"].includes(run.snapshot.family)&&(run.snapshot.researchUrls.length>0||!!run.snapshot.sourceUrl||!!run.snapshot.opportunity);
      const generatedOnly=researched&&!run.snapshot.sourceFolder;
      if(!generatedOnly&&(run.snapshot.rights!=="AUTHORIZED_REUSE"||!run.snapshot.rightsEvidence.trim()))throw new FactoryError("HOLD_RIGHTS","HUMAN_REQUIRED","Provide source ownership/usage evidence before processing media");
      let research:Awaited<ReturnType<typeof researchRun>>|null=null;
      if(researched){
        await stage("intake","passed","Public text sources selected; no third-party footage downloaded");active="research";await stage(active,"running");research=await researchRun(ctx,run,dir);run.researchHash=research.identity;
        if(run.trigger==="scheduled"&&(await studio.runs()).some(old=>old.id!==id&&old.autopilotId===run.autopilotId&&old.language===run.language&&old.state==="ready"&&old.researchHash===research!.identity)){
          run.state="cancelled";for(const s of run.stages)if(s.state==="queued"||s.state==="running"){s.state="skipped";s.note="Source research unchanged; no filler video created";}run.outputs=["research.json","citations.md"];await studio.saveRun(run);return{id,skipped:true,reason:"Source research unchanged"};
        }
        await studio.saveRun(run);await stage("research","flagged",`${research.claims.filter(c=>c.status==="EVIDENCE_FOUND").length}/${research.claims.length} claims have exact retrieved quotes; semantic fact approval still required`);
      }
      if(!run.sources.length){
        const root=run.snapshot.sourceFolder;if(!root&&!generatedOnly)throw new FactoryError("NEEDS_MEDIA","HUMAN_REQUIRED","Choose a local media folder or upload files");
        const files=root?await fs.readdir(root,{withFileTypes:true}):[];
        for(const entry of files.filter(f=>f.isFile()&&/\.(mp4|mov|webm|mkv|jpg|jpeg|png|webp)$/i.test(f.name)).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,40)){
          const file=path.resolve(root,entry.name);const copy=path.join(dir,`source-${run.sources.length}${path.extname(file).toLowerCase()}`);
          await fs.copyFile(file,copy);const sha256=await fileDigest(copy);const stat=await fs.stat(copy);
          run.sources.push({file:copy,sha256,size:stat.size});
          const intakeFile=path.join(dir,"source-intake.json"),intake=await fs.readFile(intakeFile,"utf8").then(JSON.parse,()=>({sources:[]}));intake.sources.push({file:copy,sha256,originalName:entry.name});await writeJsonAtomic(intakeFile,intake);await studio.saveRun(run);
        }
      }
      if(!run.sources.length&&!generatedOnly)throw new FactoryError("NEEDS_MEDIA","HUMAN_REQUIRED","No supported source media found");
      for(const source of run.sources){if(await fileDigest(source.file)!==source.sha256)throw new FactoryError("QUALITY_LOCK","BLOCKED","Source hash mismatch");}
      await stage("intake","passed",generatedOnly?"Original font graphics will be authored locally; source citations retained":`${run.sources.length} pinned source files; owner rights declaration recorded`);
      if(!run.edit&&run.snapshot.family==="game"&&run.sources.some(s=>/\.(mp4|mov|mkv|webm)$/i.test(s.file))){active="media";await stage(active,"running");const analysis=await inspectStudioFootage(run,dir);if(analysis){run.outputs=[...new Set([...run.outputs,"source-analysis.json"])];await studio.saveRun(run);await stage("media","flagged","Local scene/black/freeze/motion suggestions available in source-analysis.json; semantic matching and actual gameplay claims still need review");}}
      if(!research&&run.snapshot.family!=="localization"){active="research";await stage(active,"flagged","Uses owner-provided brief. Independent research and claim verification not implemented in this slice; publication blocked.");}
      active="script";await stage(active,"running");let scriptProfile:any=null;
      if(!run.shots.length){
        const result=run.snapshot.scriptText.trim() ? { script: { shots: run.snapshot.scriptText.trim().split(/\n\s*\n/).map(text=>({text})) }, model: "user-authored", mode: "local" } :research?{script:research.draft,model:research.model,mode:"local"}:await engine({op:"script",task:"script_final",system:`Write a concise video script in ${run.language}. Use ONLY supplied facts. Do not invent features, dates, firsthand tests or evidence. Return JSON {"shots":[{"text":"narration"}]} with 3 to 6 short scenes. No markdown. Target ${run.snapshot.durationSec} seconds.`,prompt:run.snapshot.brief},"script");
        const script=z.object({shots:z.array(z.object({text:z.string().min(1).max(1500)})).min(1).max(12)}).parse(result.script);
        run.shots=script.shots.map((s,i)=>({...s,asset:run.sources.length?run.sources[i%run.sources.length].file:"",durationSec:5,sourceStart:0,sourceDuration:null}));
        await writeJsonAtomic(path.join(dir,"llm-evidence.json"),result);await studio.saveRun(run);scriptProfile=(result as any).llmProfile??null;
      }
      if(scriptProfile?.reviewRequired)await stage(active,"flagged",`Fast model used because the quality model is not installed (${scriptProfile.reason}); editorial review required`);
      else await stage(active,"passed",run.snapshot.family==="localization"?"Independent local translation; source/meaning review still required":run.snapshot.scriptText.trim()&&!researched?"Owner-authored script; independent claims review still required":`Local model: ${research?.model??run.config.llmModel}; editorial approval still required`);
      if(generatedOnly&&run.shots.some(s=>!s.asset)){
        for(const [i,shot]of run.shots.entries())if(!shot.asset){const source=await researchIllustration(shot.text,research?.draft.title??run.title,i,path.join(dir,`original-graphic-${i}.png`),run.snapshot.format);shot.asset=source.file;run.sources.push(source);}
        await studio.saveRun(run);
      }
      if(!generatedOnly&&!run.edit&&!run.planRevision&&run.planning?.state!=="continuing"){
        active="media";await stage(active,"running");const matching=await matchStudioShots(ctx,run,dir);await studio.saveRun(run);
        await stage(active,"flagged",matching?`${matching.method}; ${matching.coverage.annotatedSources}/${matching.coverage.sources} sources described; visual agreement and rights require review`:"Pinned source selection; meaning review required");
      }else await stage("media","flagged",run.planRevision?"Manually selected pinned media; fresh meaning review required":generatedOnly?"Original script-specific graphics; independent editorial review required":"Pinned media retained; independent meaning review required");
      await stage("storyboard","passed",`${run.shots.length} text/media segments`);
      const sourceLengths=new Map<string,number>();
      for(const shot of run.shots){
        if(!run.sources.some(source=>source.file===shot.asset))throw new FactoryError("QUALITY_LOCK","BLOCKED","Storyboard asset is outside pinned sources");
        if(/\.(png|jpe?g|webp)$/i.test(shot.asset))continue;
        let seconds=sourceLengths.get(shot.asset);if(seconds===undefined){const measured=await probe(shot.asset);seconds=Number(measured.format?.duration);if(!measured.streams?.some((stream:any)=>stream.codec_type==="video")||!Number.isFinite(seconds))throw new FactoryError("MEDIA_RANGE","HUMAN_REQUIRED","Pinned video has no measured duration");sourceLengths.set(shot.asset,seconds);}
        if(shot.sourceStart>=seconds||shot.sourceDuration!==null&&shot.sourceStart+shot.sourceDuration>seconds+.001)throw new FactoryError("MEDIA_RANGE","HUMAN_REQUIRED","Selected scene is outside the actual source; edit its start/duration before narration");
      }
      if(run.planning?.state==="requested"){
        await safePoint();
        const plan={version:1,runId:id,snapshotHash:run.snapshotHash,renderTimingVersion:run.renderTimingVersion,language:run.language,title:run.title,shots:run.shots,sources:run.sources,researchHash:run.researchHash,createdAt:new Date().toISOString(),timing:"UNMEASURED_BEFORE_NARRATION",factApproval:"REQUIRED",rightsApproval:"REQUIRED",willPublish:false};
        await writeJsonAtomic(path.join(dir,"plan.json"),plan);
        run.planning={state:"ready",sha256:await fileDigest(path.join(dir,"plan.json"))};run.state="needs_input";run.error=null;
        run.outputs=[...new Set([...run.outputs,"plan.json","llm-evidence.json",...(research?["research.json","citations.md"]:[])])];
        await stage("voice","needs_input","Plan ready; continue explicitly from Create. Narration, timing, preview and QA have not run.");
        return{id,state:"plan_ready",planSha256:run.planning.sha256};
      }
      active="voice";await stage(active,"running");
      const weights = await modelDigest(run.language.startsWith("vi") ? run.config.ttsViModel : run.config.ttsEnModel);
      const codec = run.language.startsWith("vi") ? await modelDigest(run.config.ttsViCodec) : "kokoro";
      const environment = await engine({ op: "voice-environment", language: run.language }, "voice-environment");
      const runtime = String(environment.fingerprint);
      const pinFile = path.join(dir,"voice-model-pin.json");
      const previousPin = await fs.readFile(pinFile,"utf8").then(JSON.parse,()=>null);
      if (previousPin && (previousPin.weights !== weights || previousPin.codec !== codec || previousPin.runtime !== runtime)) throw new FactoryError("QUALITY_LOCK","BLOCKED","Voice model or runtime changed since the original attempt; create a new production run");
      await writeJsonAtomic(pinFile,{weights,codec,runtime,environment});
      for(let i=0;i<run.shots.length;i++){
        const s=run.shots[i],spokenText=applyPronunciations(s.text,run.language,run.snapshot.pronunciation),wav=path.join(dir,`voice-${i}.wav`),key=hash({text:spokenText,language:run.language,vi:run.config.ttsViModel,en:run.config.ttsEnModel,voiceVi:run.config.voiceVi,voiceEn:run.config.voiceEn,voiceEnGb:run.config.voiceEnGb,codec:run.config.ttsViCodec,device:run.config.ttsDevice,runtime});
        const manifest=path.join(dir,`voice-${i}.json`);
        const cached=await fs.readFile(manifest,"utf8").then(JSON.parse,()=>null);
        const audioHash=await fileDigest(wav).catch(()=>null);
        if(cached?.key!==key||cached?.weights!==weights||cached?.codec!==codec||!audioHash||cached?.audioSha256!==audioHash){const result=await engine({op:"tts",text:spokenText,language:run.language,output:wav},`tts-${i}`);await writeJsonAtomic(manifest,{key,weights,codec,...result,sourceText:s.text,spokenText,audioSha256:await fileDigest(wav)});}
        const p=await probe(wav);s.durationSec=Number(p.format.duration)+0.3;await studio.saveRun(run);
      }
      if (run.config.asrModel && run.config.pythonAsr) {
        const files = run.shots.map((_,i) => path.join(dir,`voice-${i}.wav`));
        const expectedSpeech=run.shots.map(s=>applyPronunciations(s.text,run.language,run.snapshot.pronunciation));
        const asrEnvironment=await engine({op:"asr-environment"},"voice-asr-environment");
        const reviewInputKey=async()=>hash({audio:await Promise.all(files.map(fileDigest)),environment:asrEnvironment.fingerprint,device:run.config.asrDevice,expected:expectedSpeech,language:run.language});
        const reviewKey=async()=>hash({inputKey:await reviewInputKey(),policyVersion:VOICE_REVIEW_POLICY_VERSION});
        const inputKey=await reviewInputKey(),asrKey=await reviewKey();
        const oldAsr = await fs.readFile(path.join(dir,"voice-review.json"),"utf8").then(JSON.parse,()=>null);
        let review = oldAsr;
        if (oldAsr?.key !== asrKey) {
          const reusable=(oldAsr?.key===inputKey||oldAsr?.inputKey===inputKey)&&oldAsr?.checks?.length===run.shots.length&&oldAsr.checks.every((check:any)=>typeof check.transcription==="string"&&typeof check.detectedLanguage==="string");
          const result = reusable?{results:oldAsr.checks.map((check:any)=>({text:check.transcription,language:check.detectedLanguage}))}:await engine({ op: "asr", audio: files }, "asr-review");
          if (!Array.isArray(result.results) || result.results.length !== run.shots.length) throw new Error("ASR returned incomplete narration review");
          review = { key: asrKey,inputKey,policyVersion:VOICE_REVIEW_POLICY_VERSION,rescoredWithoutInference:!!reusable, engine: reusable?oldAsr.engine:result, checks: run.shots.map((s,i) => ({ ...reviewNarration(expectedSpeech[i],result.results[i].text,run.language,result.results[i].language), sourceText:s.text,spokenText:expectedSpeech[i],file: files[i] })) };
          await writeJsonAtomic(path.join(dir,"voice-review.json"),review);
        }
        // One bounded same-text retry per failed line. Preserve failed audio/evidence and all unrelated lines.
        // A narration edit can repair only the line the owner changed.
        const repairFile=path.join(dir,"voice-repair.json"),repairs=await fs.readFile(repairFile,"utf8").then(JSON.parse,()=>({attempts:{},events:[]}));
        for(let i=0;i<review.checks.length;i++)if(review.checks[i].status!=="pass"&&(!run.edit||run.edit.kind==="narration"&&run.edit.index===i)&&!repairs.attempts[i]){
          await stage("repair","running",`Retry failed narration line ${i+1} once with the exact same spoken text; preserve other lines`);
          const backup=path.join(dir,"repairs",`voice-${i}-attempt-0`);await fs.mkdir(path.dirname(backup),{recursive:true});
          await fs.copyFile(files[i],backup+".wav");await fs.copyFile(path.join(dir,`voice-${i}.json`),backup+".json");
          repairs.attempts[i]=1;repairs.events.push({index:i,at:new Date().toISOString(),before:review.checks[i],state:"running",originalAudio:backup+".wav"});await writeJsonAtomic(repairFile,repairs);
          try{
            const result=await engine({op:"tts",text:expectedSpeech[i],language:run.language,output:files[i]},`tts-repair-${i}`),manifest=path.join(dir,`voice-${i}.json`),prior=JSON.parse(await fs.readFile(manifest,"utf8"));
            await writeJsonAtomic(manifest,{...prior,...result,audioSha256:await fileDigest(files[i]),repairAttempt:1});
            const checked=await engine({op:"asr",audio:[files[i]]},`asr-repair-${i}`);if(checked.results?.length!==1)throw new Error("ASR repair returned incomplete evidence");
            review.checks[i]={...reviewNarration(expectedSpeech[i],checked.results[0].text,run.language,checked.results[0].language),sourceText:run.shots[i].text,spokenText:expectedSpeech[i],file:files[i]};
            repairs.events[repairs.events.length-1]={...repairs.events[repairs.events.length-1],state:"completed",after:review.checks[i],asr:checked};
            run.shots[i].durationSec=Number((await probe(files[i])).format.duration)+0.3;await studio.saveRun(run);
            review.key=await reviewKey();review.inputKey=await reviewInputKey();review.repairEvidence="voice-repair.json";await writeJsonAtomic(path.join(dir,"voice-review.json"),review);await writeJsonAtomic(repairFile,repairs);
          }catch(error){if(error instanceof FactoryError&&["GPU_BUSY","RAM_BUSY","ENGINE_COOLDOWN","STUDIO_PAUSED"].includes(error.code))repairs.attempts[i]=0;repairs.events[repairs.events.length-1].state="interrupted";await writeJsonAtomic(repairFile,repairs);throw error;}
        }
        const passed = review.checks.every((c:any)=>c.status==="pass");
        if(repairs.events.length)await stage("repair",passed?"passed":"flagged",passed?"Affected narration retried with unchanged words; listening still required":"Same-text retry budget exhausted; inspect failed line instead of generating indefinitely");
        await stage(active,passed?"passed":"flagged",passed?"Local ASR comparison passed; human listening still required":"ASR found a language/text mismatch; inspect Voice QA and revise affected narration");
      } else await stage(active,"flagged","Local narration generated; ASR is not configured and human listening is still required");
      let captionActivity:unknown=null;
      if(run.config.vadModel){
        const activity=await engine({op:"vad",audio:run.shots.map((_,i)=>path.join(dir,`voice-${i}.wav`))},"speech-activity");
        captionActivity=activity;
        const checks=activity.results.map((r:any)=>({criterion:"voice.speech_activity",file:r.file,status:!r.speech.length?"fail":r.leading_silence>1||r.trailing_silence>1?"unknown":"pass",evidence:r,recommendedFix:!r.speech.length?"Inspect or re-narrate only this line":"Review pauses before trimming; VAD does not align words"}));await writeJsonAtomic(path.join(dir,"speech-activity.json"),{...activity,checks});
        if(checks.some((r:any)=>r.status!=="pass"))await stage("voice","flagged","Local CPU speech-activity check needs review; ASR and listening remain separate");
      }
      const [W,H]=run.snapshot.format==="short_9x16"?[1080,1920]:[1920,1080];
      // TTS/probe above always restores audio duration + 0.3, including cached
      // lines. Keep the measured speech length before rounding video boundaries.
      const audioSeconds=run.shots.map(shot=>shot.durationSec-0.3),frameTiming=run.renderTimingVersion===2;
      if(frameTiming){for(const shot of run.shots)shot.durationSec=Math.ceil(shot.durationSec*30-1e-8)/30;await studio.saveRun(run);}
      active="captions";await stage(active,"running");
      const aligned=await alignStudioNarration(ctx,run.config,run.language,run.shots.map((s,i)=>({text:s.text,file:path.join(dir,`voice-${i}.wav`)})),path.join(dir,"alignment.request.json"));
      if(aligned.evidence)await writeJsonAtomic(path.join(dir,"alignment.json"),aligned.evidence);
      const captionPlan=buildStudioCaptions(run.shots.map((s,i)=>({text:s.text,file:path.join(dir,`voice-${i}.wav`),durationSec:s.durationSec,audioDurationSec:audioSeconds[i],audioSha256:aligned.lines[i].audioSha256})),captionActivity,{width:W,fontSize:Math.round(W*0.052*run.snapshot.brand.captionScale),maxChars:run.snapshot.format==="short_9x16"?38:70},aligned.evidence);
      const cues=captionPlan.cues;
      await writeJsonAtomic(path.join(dir,"caption-quality.json"),captionPlan.evidence);
      const anchored=captionPlan.evidence.timing.filter(t=>t.method==="SPEECH_BOUND_ESTIMATE").length;
      await fs.writeFile(path.join(dir,"captions.srt"),toSrt(cues),"utf8");await stage(active,captionPlan.evidence.captionTiming==="aligned"&&captionPlan.evidence.readability.status==="pass"?"passed":"flagged",`${captionPlan.evidence.captionTiming}; ${anchored}/${run.shots.length} lines use speech-bound estimates. ${captionPlan.evidence.readability.findings.length} readability findings; listening review remains required. See caption-quality.json`);
      const brand=structuredClone(run.snapshot.brand);
      if(brand.logo){const pinned=path.join(dir,"brand-logo"+path.extname(brand.logo.file));if(!await fs.stat(pinned).catch(()=>null)){
        let source=brand.logo.file;if(!await fs.stat(source).catch(()=>null)&&run.parentId){const parentTimeline=await studio.timeline(run.parentId);if(parentTimeline?.brand?.logo?.sha256===brand.logo.sha256)source=parentTimeline.brand.logo.file;}
        if(await fileDigest(source)!==brand.logo.sha256)throw new Error("Brand logo hash changed");await fs.copyFile(source,pinned);
      }brand.logo={...brand.logo,file:pinned};}
      const cta=brand.cta?[{start:Math.max(0,run.shots.reduce((n,s)=>n+s.durationSec,0)-brand.ctaSeconds),duration:Math.min(brand.ctaSeconds,run.shots.reduce((n,s)=>n+s.durationSec,0)),text:brand.cta}]:[];
      await fs.writeFile(path.join(dir,"captions.ass"),brandAss(cues,W,H,brand,cta),"utf8");
      await writeJsonAtomic(path.join(dir,"pacing.json"),buildNarrationPacing(run.shots.map((s,i)=>({text:s.text,audioDurationSec:audioSeconds[i],segmentDurationSec:s.durationSec})),{language:run.language,targetSeconds:run.snapshot.durationSec}));
      active="render";await stage(active,"running");
      for(let i=0;i<run.shots.length;i++){
        const s=run.shots[i];const filename=`segment-${i}.mp4`;const key=hash({s,W,H,source:run.sources.find(x=>x.file===s.asset)?.sha256,voice:await fileDigest(path.join(dir,`voice-${i}.wav`)),...(frameTiming?{renderTimingVersion:2}:{})});
        const marker=path.join(dir,`segment-${i}.hash`);
        if(await fs.readFile(marker,"utf8").catch(()=>"")===key&&await fs.stat(path.join(dir,filename)).catch(()=>null))continue;
        const image=/\.(jpg|jpeg|png|webp)$/i.test(s.asset);
        const localized=!!s.sourceDuration;
        await command(run.config.ffmpeg,["-y","-threads","2",...(localized?["-ss",String(s.sourceStart),"-t",String(s.sourceDuration)]:image?["-loop","1"]:["-stream_loop","-1","-ss",String(s.sourceStart)]),"-i",s.asset,"-i",`voice-${i}.wav`,"-t",String(s.durationSec),"-map","0:v:0","-map","1:a:0","-vf",`${localized?`setpts=${s.durationSec/s.sourceDuration!}*(PTS-STARTPTS),`:""}scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x171522,setsar=1,fps=30${localized?`,tpad=stop_mode=clone:stop_duration=${s.durationSec}`:""}`,"-af","apad","-c:v","libx264","-preset","fast","-crf","20","-pix_fmt","yuv420p","-c:a","aac","-ar","48000","-ac","2",filename]);
        await fs.writeFile(marker,key);
      }
      const frameDuration=run.shots.reduce((seconds,shot)=>seconds+shot.durationSec,0);
      await fs.writeFile(path.join(dir,"concat.txt"),run.shots.map((shot,i)=>`file 'segment-${i}.mp4'${frameTiming?`\nduration ${shot.durationSec.toFixed(9)}`:""}`).join("\n"));
      await command(run.config.ffmpeg,["-y","-f","concat","-safe","0","-i","concat.txt","-vf",`${frameTiming?"setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=clone:stop_duration=0.033333334,":""}ass=captions.ass`,"-af",`${frameTiming?"aresample=async=1:first_pts=0,":""}loudnorm=I=-16:TP=-1.5:LRA=11`,"-c:v","libx264","-preset","fast","-crf","20","-pix_fmt","yuv420p","-c:a","aac",...(frameTiming?["-t",String(frameDuration),"-frames:v",String(Math.round(frameDuration*30))]:[]),"-movflags","+faststart","final.mp4"]);
      await applyBrandLogo(brand,W,dir,run.config.ffmpeg,command);
      const clips=[];let timelineAt=0;
      for(let i=0;i<run.shots.length;i++){const shot=run.shots[i],segment=path.join(dir,`segment-${i}.mp4`),voice=path.join(dir,`voice-${i}.wav`);clips.push(TimelineClip.parse({id:`video-${i}`,track:"video",start:timelineAt,duration:shot.durationSec,source:segment,sha256:await fileDigest(segment)}),TimelineClip.parse({id:`dialogue-${i}`,track:"dialogue",start:timelineAt,duration:audioSeconds[i],source:voice,sha256:await fileDigest(voice),text:shot.text,language:run.language}));timelineAt+=shot.durationSec;}
      for(const [i,cue]of cues.entries())clips.push(TimelineClip.parse({id:`caption-${i}`,track:"caption",start:cue.start,duration:cue.end-cue.start,text:cue.text,language:run.language}));
      for(const [i,title]of cta.entries())clips.push(TimelineClip.parse({id:`brand-cta-${i}`,track:"title",...title}));
      await writeJsonAtomic(path.join(dir,"timeline.json"),Timeline.parse({schemaVersion:1,width:W,height:H,fps:30,duration:timelineAt,clips,brand,captionTiming:captionPlan.evidence.captionTiming,createdAt:new Date().toISOString()}));
      await stage(active,"passed","FFmpeg render; source media preserved without deceptive crop");
      await stage("preview","passed","Final MP4 available for review");if(!await fs.stat(path.join(dir,"voice-repair.json")).catch(()=>null))await stage("repair","skipped","No voice mismatch repair needed; semantic repair requires a concrete edit");
    }
    active="quality";await stage(active,"running");const p=await probe(path.join(dir,"final.mp4"));const video=p.streams.find((s:any)=>s.codec_type==="video"),audio=p.streams.find((s:any)=>s.codec_type==="audio");
    const qaTimeline=await fs.readFile(path.join(dir,"timeline.json"),"utf8").then(JSON.parse,()=>undefined);
    const measured=await inspectStudioMedia(path.join(dir,"final.mp4"),run.config,qaTimeline?{width:qaTimeline.width,height:qaTimeline.height,duration:qaTimeline.duration}:undefined);
    const frameTimedNarration=run.renderTimingVersion===2&&run.snapshot.family!=="shorts"&&!["cut","timeline"].includes(run.edit?.kind??"");
    const renderTiming={version:run.renderTimingVersion,frameTimedNarration,plannedFrames:qaTimeline?Math.round(qaTimeline.duration*qaTimeline.fps):null,measuredVideoFrames:Number(video?.nb_frames)||null,measuredVideoDuration:Number(video?.duration)||null,measuredContainerDuration:Number(p.format.duration)};
    if(frameTimedNarration&&qaTimeline){const passed=renderTiming.measuredVideoFrames===renderTiming.plannedFrames;measured.findings.push({criterion:"frame_timing",status:passed?"pass":"fail",evidence:renderTiming,severity:"error",recommendedFix:"Re-encode pinned segments using explicit frame durations; preserve the voice and original version",timestamp:new Date().toISOString(),modelVersion:null,confidence:null,relevantFiles:[path.join(dir,"final.mp4")]});measured.technical=measured.technical&&passed;}
    const voiceReview=await fs.readFile(path.join(dir,"voice-review.json"),"utf8").then(JSON.parse,()=>null);
    const research=await fs.readFile(path.join(dir,"research.json"),"utf8").then(JSON.parse,()=>null);
    const localization=await fs.readFile(path.join(dir,"localization-translation.json"),"utf8").then(JSON.parse,()=>null);
    const speechActivity=await fs.readFile(path.join(dir,"speech-activity.json"),"utf8").then(JSON.parse,()=>null);
    let captionQuality=await fs.readFile(path.join(dir,"caption-quality.json"),"utf8").then(JSON.parse,()=>null);
    if(qaTimeline){
      const captionCues=qaTimeline.clips.filter((c:any)=>c.track==="caption").sort((a:any,b:any)=>a.start-b.start).map((c:any)=>({start:c.start,end:c.start+c.duration,text:c.text??""}));
      captionQuality={...captionQuality,schemaVersion:1,captionTiming:qaTimeline.captionTiming,wordAlignment:qaTimeline.captionTiming==="aligned"?"ALIGNED":"UNVERIFIED",readability:inspectCaptionCues(captionCues,{duration:qaTimeline.duration,width:qaTimeline.width,fontSize:Math.round(qaTimeline.width*0.052*(qaTimeline.brand?.captionScale??1))}),humanReview:"REQUIRED"};
      await writeJsonAtomic(path.join(dir,"caption-quality.json"),captionQuality);
      if(captionQuality.readability.status!=="pass")await stage("captions","flagged",`${captionQuality.readability.findings.length} deterministic caption readability/bounds findings; inspect caption-quality.json`);
    }
    if(!run.edit){const actual=Number(p.format.duration),target=run.snapshot.durationSec;measured.findings.push({criterion:"creative_duration_target",status:actual>=target*.7&&actual<=target*1.3?"pass":"unknown",evidence:{targetSeconds:target,actualSeconds:actual,tolerance:"30 percent creative-target heuristic; encode duration checked separately",noAutomaticFiller:true},severity:"warning",recommendedFix:"Review pacing or create a revised script; preserve required disclosures and never pad with invented facts",timestamp:new Date().toISOString(),modelVersion:null,confidence:null,relevantFiles:[path.join(dir,"final.mp4")]});measured.heuristicsRequireReview=measured.findings.some(f=>f.severity==="warning"&&f.status!=="pass");}
    const sourceAnalysis=await fs.readFile(path.join(dir,"source-analysis.json"),"utf8").then(JSON.parse,()=>null);
    const qa={renderTiming,videoSha256:await fileDigest(path.join(dir,"final.mp4")),sourceAnalysis,captionQuality:captionQuality??"NOT_MEASURED",speechActivity:speechActivity??"NOT_MEASURED",technical:measured.technical,findings:measured.findings,heuristicsRequireReview:measured.heuristicsRequireReview,voiceReview:voiceReview?.checks??"UNKNOWN",editorial:"UNKNOWN",facts:research?{claims:research.claims,approval:"REQUIRED"}:"UNKNOWN",localization:localization?{targetLanguage:localization.targetLanguage,sourceSha256:localization.sourceSha256,meaningReview:"REQUIRED",sourceCaptionOverlap:"UNKNOWN",retiming:run.shots.map(s=>({sourceSeconds:s.sourceDuration,outputSeconds:s.durationSec,ratio:s.sourceDuration?s.durationSec/s.sourceDuration:null})),audioPolicy:localization.audioPolicy}:null,rights:research&&!run.snapshot.sourceFolder?"ORIGINAL_GRAPHICS_WITH_SOURCE_CITATIONS":"OWNER_DECLARATION_RECORDED",publishEligibility:"BLOCKED",duration:Number(p.format.duration),video,audio,wordAlignment:qaTimeline?.captionTiming==="aligned"?"ALIGNED":"UNVERIFIED",humanReview:"REQUIRED"};
    await writeJsonAtomic(path.join(dir,"qa.json"),qa);
    if(run.repair)await writeJsonAtomic(path.join(dir,"repair-result.json"),{...run.repair,technical:qa.technical,qaVideoSha256:qa.videoSha256,findings:qa.findings.filter(f=>f.status!=="pass"),captionStatus:captionQuality?.readability?.status??"UNKNOWN",willPublish:false,reviewRequired:true,checkedAt:new Date().toISOString()});
    if(!qa.technical)throw new Error("Technical QA failed");
    const reviewNotes=[...(captionQuality&&captionQuality.readability.status!=="pass"?["caption readability (caption-quality.json)"]:[]),...measured.findings.filter(f=>f.severity==="warning"&&f.status!=="pass").map(f=>f.criterion)];
    await stage(active,reviewNotes.length?"flagged":"passed",reviewNotes.length?`Technical checks passed; review required: ${reviewNotes.join(", ")}`:"Decode + H.264/AAC checks passed; editorial/facts remain unknown");
    await command(run.config.ffmpeg,["-y","-ss","0.2","-i","final.mp4","-frames:v","1","thumbnail.jpg"]);
    await stage("eligibility","blocked","Publication requires verified facts, rights, account and authorized policy; no automatic publish");
    await writeJsonAtomic(path.join(dir,"manifest.json"),{product:"AUTONOMOUS CREATIVE STUDIO",runId:id,parentId:run.parentId,snapshotHash:run.snapshotHash,sources:run.sources,opportunity:run.snapshot.opportunity,timeline:qaTimeline??null,config:run.config,language:run.language,rights:run.snapshot.rightsEvidence,publishStatus:"MANUAL_EXPORT_NOT_APPROVED",edit:run.edit});
    await fs.writeFile(path.join(dir,"metadata.txt"),`${run.title}\nLanguage: ${run.language}\nManual export — not approved for posting.\n${run.snapshot.brief}\n`,"utf8");
    run.outputs=["final.mp4","thumbnail.jpg","qa.json","manifest.json","metadata.txt",...(captionQuality?["caption-quality.json"]:[]),...(research?["research.json","citations.md"]:[]),...(speechActivity?["speech-activity.json"]:[]),...(voiceReview?["voice-review.json",...(await fs.stat(path.join(dir,"voice-repair.json")).catch(()=>null)?["voice-repair.json"]:[])]:[]),...(run.edit?.kind !== "cut"?["captions.srt","captions.ass","timeline.json"]:[]),...(await fs.stat(path.join(dir,"shorts-selection.json")).catch(()=>null)?["source-transcript.json","shorts-plan.json","shorts-selection.json"]:[]),...(localization?["localization-transcript.json","localization-translation.json"]:[])];
    for(const file of["plan.json","product-evidence.json","product-invalidation.json","product-publication-description.txt","source-analysis.json","source-matching.json","source-intake.json","pacing.json","alignment.json","repair-plan.json","repair-execution.json","repair-result.json"])if(await fs.stat(path.join(dir,file)).catch(()=>null))run.outputs.push(file);
    await stage("delivery","passed","Local export complete; publication not authorized");await stage("analytics","skipped","No remote publication ID");
    run.state="ready";await studio.saveRun(run);
    if(run.replay.length){
      // Free text revision of a cut version: re-apply the same cuts/timeline edits, in order, to the re-narrated version.
      const [first,...rest]=run.replay;run.replay=[];await studio.saveRun(run);
      const firstCut=[first,...rest].flatMap(e=>e.kind==="cut"?[e.start]:e.operations.flatMap((o:any)=>typeof o.start==="number"?[o.start]:[]));
      const parentRun=run.parentId?await studio.run(run.parentId):null,editIndex=run.edit?.kind==="narration"?run.edit.index:0,editedStart=(parentRun?.shots??[]).slice(0,editIndex).reduce((t,s)=>t+s.durationSec,0),durationChanged=!!parentRun&&parentRun.shots.some((s,i)=>Math.abs(s.durationSec-run.shots[i].durationSec)>0.05);
      // Edits are time based: when the new sentence changed length before a later edit point, stop for the owner instead of cutting the wrong place.
      if(durationChanged&&firstCut.some(t=>t>=editedStart))await notify(ctx,`ACS · ${run.title}: câu đã sửa đổi độ dài trước điểm cắt; hãy cắt lại thủ công trên phiên bản mới (không tự cắt sai chỗ).`,{dedupeKey:`studio:replay-hold:${id}`});
      else if(first.kind==="cut")await studio.cut(run.id,first.start,first.end,rest);else await studio.editTimeline(run.id,first.operations,undefined,rest);
    }
    await notify(ctx,`ACS · ${run.title} (${run.language}): local export ready; publication still blocked.`,{dedupeKey:`studio:${id}`});
    return {id,state:run.state,outputs:run.outputs};
  }catch(e:any){
    const message=String(e.message??e);const waiting=e instanceof FactoryError&&["GPU_BUSY","RAM_BUSY","ENGINE_COOLDOWN","STUDIO_PAUSED"].includes(e.code);run.state=e instanceof FactoryError&&e.code==="STUDIO_CANCELLED"?"cancelled":waiting?"queued":e instanceof FactoryError&&e.errorClass==="HUMAN_REQUIRED"?"needs_input":"failed";run.error=message;
    await stage(active,waiting?"queued":run.state==="needs_input"?"needs_input":"failed",message);await studio.saveRun(run);
    if(message.includes("GPU_BUSY"))throw new FactoryError("GPU_BUSY","RETRYABLE",message,{retryAfter:new Date(Date.now()+60000).toISOString()});
    if(message.includes("RAM_BUSY"))throw new FactoryError("RAM_BUSY","RETRYABLE",message,{retryAfter:new Date(Date.now()+60000).toISOString()});
    if(message.includes("NEEDS_PROVIDER")||message.includes("No module named"))throw new FactoryError("NEEDS_PROVIDER","HUMAN_REQUIRED",message);
    throw e;
  }
}
