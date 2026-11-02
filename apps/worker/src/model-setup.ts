import path from"node:path";
import * as fs from"node:fs/promises";
import{StudioStore,VoiceStore,ModelSetupStore,environmentLock,modelStoreLock,type StudioConfig,hash,QUALITY_MODEL_TAG}from"@ttm/automation";
import {createHash} from "node:crypto";
import{FactoryError}from"@ttm/core";
import{withLock,writeJsonAtomic}from"@ttm/storage";
import{ensureManagedLlm}from"./managed-llm.js";
import type{Ctx}from"./context.js";
import {runProcess} from "@ttm/media";
import {invokeLocalEngine} from "./local-engine.js";
import sharp from "sharp";
import {ImageStore,ImageAsset} from "@ttm/automation";
import {executeImage} from "./images.js";
import {randomUUID} from "node:crypto";
import {setupPreflight} from "./setup-preflight.js";
import {installPrivateOllama} from "./setup-runtime.js";
import {alignStudioNarration} from "./studio-alignment.js";
export const SETUP_PROFILES=["qwen3.5-9b","qwen-quality","kokoro","vieneu","qwen-asr","silero-vad","flux2-klein-4b","qwen-embedding","wav2vec2-en-align"] as const;
/** Reject nested junctions before pip/downloads can write through another application's environment. */
export async function assertOwnedSetupTree(base:string,target:string){
 const root=await fs.realpath(base),inside=(value:string)=>{const a=process.platform==="win32"?root.toLowerCase():root,b=process.platform==="win32"?value.toLowerCase():value;return b===a||b.startsWith(a+path.sep);},visited=new Set<string>();
 async function walk(file:string):Promise<void>{
  const canonical=await fs.realpath(file).catch(error=>{if(error.code==="ENOENT")return null;throw error;});if(!canonical)return;
  if(!inside(canonical)||/asset[-_ ]?forge/i.test(canonical))throw new Error("Setup target or nested junction resolves outside ACS ownership");
  if(visited.has(canonical))return;visited.add(canonical);const stat=await fs.stat(file);if(!stat.isDirectory())return;
  for(const entry of await fs.readdir(file,{withFileTypes:true}))if(entry.isDirectory()||entry.isSymbolicLink())await walk(path.join(file,entry.name));
 }
 await walk(target);
}
export async function executeModelSetup(ctx:Ctx,id:string){
 const registry=new ModelSetupStore(ctx.store);let row=await registry.get(id);if(!row)throw new Error("Setup request missing");
 if(hash(row.config)!==row.configHash)throw new Error("Setup config hash mismatch");
 const progress=async(value:Record<string,unknown>)=>{row=await registry.save({...row!,state:"running",progress:{...(row!.progress.preflight?{preflight:row!.progress.preflight}:{}),...value},error:null});};
 const logFile=ctx.store.p("studio","setup",`${id}.log`);
 const run=async(binary:string,args:string[],label:string)=>{
  await progress({status:label,logFile});const result=await runProcess(binary,args,{timeoutMs:7200000,env:{UV_NO_PROGRESS:"1",PYTHONUTF8:"1",PYTHONDONTWRITEBYTECODE:"1"}});await fs.appendFile(logFile,`${label}\n${result.stdout}\n${result.stderr}\n`,"utf8");if(result.code!==0)throw new Error(`${label}: ${result.stderr.slice(-2200)}`);return result;
 };
 try{
  if(row.mode==="preflight"){
   await progress({status:"Checking selected profile without creating environments or loading models"});
   const preflight=await setupPreflight(row);
   await registry.save({...row,state:"checked",progress:{status:preflight.readyToInstall?"PREFLIGHT_READY_TO_INSTALL":"PREFLIGHT_NEEDS_ACTION",preflight},resultConfig:null});return {setupId:id,state:"checked",readyToInstall:preflight.readyToInstall};
  }
  if(row.mode==="verify"){
   if(row.profile==="wav2vec2-en-align"){
    const voices=new VoiceStore(ctx.store),voice=(await voices.list()).find(v=>v.state==="ready"&&v.language.startsWith("en"));if(!voice)throw new FactoryError("NEEDS_SAMPLE","HUMAN_REQUIRED","Create an English voice audition first; alignment verification uses its real audio and exact script");
    const result=await alignStudioNarration(ctx,row.config,voice.language,[{file:voices.audio(voice.id),text:voice.text}],ctx.store.p("studio","setup",`${id}-alignment.request.json`));
    if(!result.evidence?.results?.some((line:any)=>line.status==="aligned"))throw new Error("English sample alignment was withheld; inspect the request log or choose a plain-English audition without digit notation");
    await registry.save({...row,state:"verified",resultConfig:row.config,progress:{status:"VERIFIED_ONE_ENGLISH_CTC_SAMPLE_NOT_HUMAN_BOUNDARIES",voiceSampleId:voice.id,evidence:result.evidence,humanReview:"NOT_REVIEWED",vietnameseWordTiming:"UNSUPPORTED"}});return{setupId:id,state:"verified"};
   }
   if(row.profile==="qwen-embedding"){
    const evidence=await invokeLocalEngine(ctx,row.config,{op:"embed",texts:[{id:"query",role:"query",text:"local library books"},{id:"library",text:"A neighborhood library lends books and provides quiet reading space."},{id:"unrelated",text:"A bicycle repair workshop replaces worn tires and brakes."}]},ctx.store.p("studio","setup",`${id}-embedding.request.json`));
    const documents=evidence.documents;if(documents?.length!==3||documents.some((d:any)=>d.vector?.length!==1024))throw new Error("Embedding dimensional verification failed");
    const similarity=(a:number[],b:number[])=>a.reduce((score,value,i)=>score+value*b[i],0),scores={library:similarity(documents[0].vector,documents[1].vector),unrelated:similarity(documents[0].vector,documents[2].vector)};
    if(scores.library<=scores.unrelated)throw new Error("Controlled embedding ranking failed; inspect request evidence");
    const {documents:_,...metadata}=evidence;await registry.save({...row,state:"verified",resultConfig:row.config,progress:{status:"VERIFIED_SMALL_EMBEDDING_FIXTURE_ONLY",metadata,scores,humanReview:"NOT_REVIEWED",truthOrRightsCertified:false}});return {setupId:id,state:"verified"};
   }
   if(row.profile==="flux2-klein-4b"){
    const images=new ImageStore(ctx.store),now=new Date().toISOString();let image=typeof row.progress.imageId==="string"?await images.get(row.progress.imageId):null;
    if(!image)image=await images.save(ImageAsset.parse({id:randomUUID(),input:{prompt:"An original editorial illustration of a quiet library beside a small garden at sunrise, warm light, clean editorial illustration, unsigned artwork, no signatures, no text, no logos, no people",width:768,height:768,seed:42},config:row.config,configHash:row.configHash,state:"queued",createdAt:now,updatedAt:now}));
    await progress({status:"Running actual local image verification",imageId:image.id});
    await executeImage(ctx,image.id);const completed=await images.get(image.id);if(completed?.state!=="ready"||(completed.evidence as any)?.technical.status!=="PASS")throw new Error("Image verification failed technical checks");
    await registry.save({...row,state:"verified",resultConfig:row.config,progress:{status:"VERIFIED_LOCAL_IMAGE_TECHNICAL_ONLY",imageId:image.id,evidence:completed.evidence,humanReview:"NOT_REVIEWED"}});return {setupId:id,state:"verified"};
   }
   if(row.profile==="silero-vad"){
    const voices=new VoiceStore(ctx.store),voice=(await voices.list()).find(v=>v.state==="ready");if(!voice)throw new FactoryError("NEEDS_SAMPLE","HUMAN_REQUIRED","Create a real voice audition first, apply the VAD model configuration, then verify VAD");
    const file=voices.audio(voice.id),bytes=await fs.readFile(file);if(createHash("sha256").update(bytes).digest("hex")!==voice.audioSha256)throw new Error("Voice audition bytes changed");
    const silence=ctx.store.p("studio","setup",`${id}-silence.wav`),pcm=Buffer.alloc(44+32000);pcm.write("RIFF");pcm.writeUInt32LE(pcm.length-8,4);pcm.write("WAVEfmt ",8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(16000,24);pcm.writeUInt32LE(32000,28);pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);pcm.write("data",36);pcm.writeUInt32LE(32000,40);await fs.writeFile(silence,pcm);
    const evidence=await invokeLocalEngine(ctx,row.config,{op:"vad",audio:[file,silence]},ctx.store.p("studio","setup",`${id}-vad.request.json`));
    if(!evidence.results?.[0]?.speech.length||evidence.results?.[1]?.speech.length!==0)throw new Error("VAD speech/silence fixture check failed");
    await registry.save({...row,state:"verified",resultConfig:row.config,progress:{status:"VERIFIED_ONE_SPEECH_SAMPLE_AND_SILENCE",voiceSampleId:voice.id,evidence,wordTiming:"NOT_PROVIDED",humanReview:"NOT_REVIEWED"}});return {setupId:id,state:"verified"};
   }
   const quality=row.profile==="qwen-quality";if(row.profile!=="qwen3.5-9b"&&!quality)throw new Error("Use Voice auditions to verify speech and ASR with a real sample");
   const evidence=[];
   for(const language of ["vi-VN","en-US"]){
    await progress({status:`Running actual ${language} inference`});
    evidence.push(await invokeLocalEngine(ctx,row.config,{op:"script",task:quality?"script_final":"draft",language,prompt:language==="vi-VN"?"Viết hai câu ngắn bằng tiếng Việt giới thiệu thư viện địa phương, không bịa số liệu.":"Write two short English sentences introducing a local library. Do not invent statistics."},ctx.store.p("studio","setup",`${id}-${language}.request.json`)));
   }
   await progress({status:"Running controlled local vision fixture"});
   const sample=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="white"/><circle cx="170" cy="180" r="90" fill="blue"/><rect x="350" y="90" width="170" height="170" fill="orange"/><text x="210" y="350" font-family="Arial" font-size="54" fill="black">ACS 42</text></svg>')).png().toBuffer();
   const vision=await invokeLocalEngine(ctx,row.config,{op:"script",task:quality?"judge_vision":"draft",language:"en-US",images:[sample.toString("base64")],system:"Inspect the actual image. Report the circle color, rectangle color and exact visible text. Do not infer facts beyond the pixels.",prompt:"What colors are the circle and rectangle, and what text is visible?",schema:{type:"object",properties:{circleColor:{type:"string"},rectangleColor:{type:"string"},visibleText:{type:"string"}},required:["circleColor","rectangleColor","visibleText"],additionalProperties:false}},ctx.store.p("studio","setup",`${id}-vision.request.json`));
   await fs.writeFile(ctx.store.p("studio","setup",`${id}-vision.png`),sample);
   const answer=vision.script,visionMatched=/blue/i.test(answer.circleColor)&&/orange/i.test(answer.rectangleColor)&&String(answer.visibleText).replace(/\s+/g,"").trim()==="ACS42";
   const visionEvidence={...vision,capability:"vision",sample:"controlled colors / visible text",expected:{circleColor:"blue",rectangleColor:"orange",visibleText:"ACS 42"},validation:visionMatched?"MATCHED_KNOWN_FIXTURE_ONLY":"FLAGGED_REQUIRES_REVIEW"};
   await writeJsonAtomic(ctx.store.p("studio","setup",`${id}-vision-evidence.json`),visionEvidence);evidence.push(visionEvidence);
   row=await registry.save({...row,state:"verified",progress:{status:"VERIFIED_TEXT_INFERENCE_ONLY",visionStatus:visionEvidence.validation,evidence,humanReview:"NOT_REVIEWED"},resultConfig:row.config});return {setupId:id,state:row.state};
  }
  const base=path.join(row.root,".local"),models=path.join(base,"models");await fs.mkdir(base,{recursive:true});
  const canonicalRoot=await fs.realpath(row.root),canonicalBase=await fs.realpath(base);
  if(/asset[-_ ]?forge/i.test(canonicalRoot)||/asset[-_ ]?forge/i.test(canonicalBase)||!canonicalBase.toLowerCase().startsWith(canonicalRoot.toLowerCase()+path.sep))throw new Error("Setup folder resolves outside ACS ownership");
  for(const target of[path.join(base,"engines"),models]){const canonical=await fs.realpath(target).catch(()=>null);if(canonical&&!canonical.toLowerCase().startsWith(canonicalBase.toLowerCase()+path.sep))throw new Error("Setup target is redirected outside the ACS folder");}
  const ownedTargets=row.profile==="wav2vec2-en-align"?[path.join(models,"wav2vec2-en-align")]:row.profile==="qwen-embedding"?[path.join(models,"qwen3-embedding-0.6b")]:row.profile==="flux2-klein-4b"?[path.join(base,"engines","image"),path.join(models,"flux2-klein-4b")]:row.profile==="silero-vad"?[path.join(models,"silero-vad")]:row.profile==="qwen3.5-9b"?[path.join(models,"ollama")]:row.profile==="kokoro"?[path.join(base,"engines","speech"),path.join(models,"kokoro")]:row.profile==="vieneu"?[path.join(base,"engines","vieneu"),path.join(models,"vieneu"),path.join(models,"moss-nano")]:[path.join(base,"engines","asr"),path.join(models,"qwen3-asr")];
  for(const target of ownedTargets)await assertOwnedSetupTree(base,target);
  if(row.profile==="qwen3.5-9b")for(const target of [path.join(base,"tools","ollama"),path.join(base,"tools","ollama-0.40.8"),path.join(base,"downloads")])await assertOwnedSetupTree(base,target);
  const preflight=await setupPreflight(row);await progress({status:"Setup prerequisite checks complete",preflight});
  if(!preflight.readyToInstall)throw new FactoryError("SETUP_PREREQUISITES","HUMAN_REQUIRED",`Setup prerequisites need action: ${preflight.checks.filter(check=>check.blocking).map(check=>check.label.en).join(", ")}. Open the setup checklist for the exact fix.`);
  const marker=path.join(base,"acs-managed.json");await writeJsonAtomic(marker,{owner:"AUTONOMOUS CREATIVE STUDIO",root:row.root});
  let config={...row.config};
  if(row.profile==="wav2vec2-en-align"){
   const python=config.pythonAsr||path.join(base,"engines","asr",process.platform==="win32"?"Scripts/python.exe":"bin/python");if(!await fs.stat(python).catch(()=>null))throw new FactoryError("NEEDS_PROVIDER","HUMAN_REQUIRED","Install/apply the isolated ASR runtime first; English CTC reuses compatible packages unchanged");
   const engineDir=path.dirname(process.env.ACS_ENGINE_RUNNER??path.resolve("engines/runner.py")),request=ctx.store.p("studio","setup",`${id}-download.json`);await writeJsonAtomic(request,{models});
   await withLock(environmentLock(python),()=>withLock(modelStoreLock(path.join(models,"wav2vec2-en-align")),()=>run(python,[path.join(engineDir,"install-alignment.py"),request],"Download optional pinned English CPU alignment checkpoint"),{waitMs:7200000,ttlMs:60000}),{waitMs:7200000,ttlMs:60000});config={...config,pythonAsr:python,alignmentModel:path.join(models,"wav2vec2-en-align")};
  }else if(row.profile==="qwen-embedding"){
   const python=config.pythonEmbedding||config.pythonAsr||path.join(base,"engines","asr",process.platform==="win32"?"Scripts/python.exe":"bin/python");if(!await fs.stat(python).catch(()=>null))throw new FactoryError("NEEDS_PROVIDER","HUMAN_REQUIRED","Install the isolated ASR runtime first, or configure a compatible isolated embedding Python runtime; package installation is not implicit");
   const engineDir=path.dirname(process.env.ACS_ENGINE_RUNNER??path.resolve("engines/runner.py")),request=ctx.store.p("studio","setup",`${id}-download.json`);await writeJsonAtomic(request,{models});
   await withLock(modelStoreLock(path.join(models,"qwen3-embedding-0.6b")),()=>run(python,[path.join(engineDir,"install-embedding.py"),request],"Download pinned Qwen embedding checkpoint; leave compatible Python packages unchanged"),{waitMs:7200000,ttlMs:60000});
   config={...config,pythonEmbedding:python,embeddingModel:path.join(models,"qwen3-embedding-0.6b")};
  }else if(row.profile==="silero-vad"){
   const python=config.pythonAsr||path.join(base,"engines","asr",process.platform==="win32"?"Scripts/python.exe":"bin/python");if(!await fs.stat(python).catch(()=>null))throw new FactoryError("NEEDS_PROVIDER","HUMAN_REQUIRED","Install the isolated ASR Python environment first; VAD reuses its existing CPU Torch/SciPy runtime without modifying packages");
   const engineDir=path.dirname(process.env.ACS_ENGINE_RUNNER??path.resolve("engines/runner.py")),request=ctx.store.p("studio","setup",`${id}-download.json`);await writeJsonAtomic(request,{models});
   await withLock(modelStoreLock(path.join(models,"silero-vad")),()=>run(python,[path.join(engineDir,"install-vad.py"),request],"Download pinned Silero VAD checkpoint and license"),{waitMs:7200000,ttlMs:60000});
   const source=JSON.parse(await fs.readFile(path.join(engineDir,"silero-source.json"),"utf8"));config={...config,pythonVad:python,vadModel:path.join(models,"silero-vad","silero_vad.jit"),vadSha256:source.files[0].sha256};
  }else if(row.profile==="qwen-quality"){
   if(!config.llmManaged||!config.llmBinary||!config.llmModelStore)throw new FactoryError("NEEDS_PROVIDER","HUMAN_REQUIRED","Install the fast text profile (Qwen3.5-9B) first: the quality model shares its managed runtime and its own model store");
   config=await setupOllamaModel(ctx,config,progress,{tag:QUALITY_MODEL_TAG,target:"quality"});
  }else if(row.profile==="qwen3.5-9b"){
   let binary=config.llmBinary;
   if(!binary){const existing=path.join(base,"tools","ollama","ollama.exe");binary=await fs.stat(existing).then(info=>info.isFile()?existing:"",()=>"");if(!binary)binary=(await installPrivateOllama(base,progress)).binary;}
   config={...config,llmManaged:true,llmBinary:binary,llmModelStore:path.join(models,"ollama"),llmUrl:`http://127.0.0.1:${config.llmPort}/v1`};
   config=await setupOllamaModel(ctx,config,progress);
  }else{
   const folder=row.profile==="flux2-klein-4b"?"image":row.profile==="kokoro"?"speech":row.profile==="qwen-asr"?"asr":"vieneu",env=path.join(base,"engines",folder),python=path.join(env,process.platform==="win32"?"Scripts/python.exe":"bin/python");
   const engineDir=path.dirname(process.env.ACS_ENGINE_RUNNER??path.resolve("engines/runner.py"));
   await withLock(environmentLock(python),async()=>{
    if(!await fs.stat(python).catch(()=>null))await run(config.uv,["venv","--python","3.11","--managed-python",env],"Create isolated Python 3.11 environment");
    await run(config.uv,["pip","sync","--python",python,path.join(engineDir,`requirements-${row!.profile==="flux2-klein-4b"?"image":row!.profile==="qwen-asr"?"asr":row!.profile}.lock.txt`),"--extra-index-url","https://download.pytorch.org/whl/cu128"],"Install pinned Python package inventory");
    const request=ctx.store.p("studio","setup",`${id}-download.json`);await writeJsonAtomic(request,{profile:row!.profile,models});
    const download=()=>run(python,[path.join(engineDir,row!.profile==="flux2-klein-4b"?"install-image.py":"install-model.py"),request],"Download pinned local checkpoints and hash files");
    if(row!.profile==="flux2-klein-4b")await withLock(modelStoreLock(path.join(models,"flux2-klein-4b")),download,{waitMs:7200000,ttlMs:60000,purpose:"Exclusive image checkpoint installation"});else await download();
   },{waitMs:7200000,ttlMs:60000,purpose:"ACS setup: exclusive environment mutation"});
   if(row.profile==="flux2-klein-4b")config={...config,pythonImage:python,imageModel:path.join(models,"flux2-klein-4b"),imageDevice:"cuda_cpu_offload"};
   if(row.profile==="kokoro")config={...config,python,ttsEnModel:path.join(models,"kokoro")};
   if(row.profile==="vieneu")config={...config,pythonVi:python,ttsViModel:path.join(models,"vieneu"),ttsViCodec:path.join(models,"moss-nano"),voiceVi:config.voiceVi||"Minh Quân"};
   if(row.profile==="qwen-asr")config={...config,pythonAsr:python,asrModel:path.join(models,"qwen3-asr")};
  }
  await registry.save({...row,state:"installed",progress:{status:"INSTALLED_NOT_INFERENCE_VERIFIED",logFile,preflight:row.progress.preflight},resultConfig:config});return {setupId:id,state:"installed"};
 }catch(error:any){
  const wait=["GPU_BUSY","RAM_BUSY","ENGINE_COOLDOWN","STUDIO_PAUSED"].includes(error.code);await registry.save({...row!,state:wait?"queued":"failed",error:String(error.message??error)});throw error;
 }
}
export async function setupOllamaModel(ctx:Ctx,config:StudioConfig,progress:(value:Record<string,unknown>)=>Promise<void>,spec:{tag:string;target:"fast"|"quality"}={tag:"qwen3.5:9b",target:"fast"}){
 if(!config.llmManaged)throw new Error("Enable the app-managed local runtime before installing a model");
 const base=(await ensureManagedLlm(ctx,config)).replace(/\/v1$/,"");
 return withLock(modelStoreLock(config.llmModelStore),async()=>{
  const response=await fetch(`${base}/api/pull`,{method:"POST",redirect:"error",headers:{"content-type":"application/json"},body:JSON.stringify({model:spec.tag,stream:true}),signal:AbortSignal.timeout(2*3600000)});
  if(!response.ok||!response.body)throw new Error(`Model download HTTP ${response.status}`);
  let pending="",lastUpdate=0,completed=false;const decoder=new TextDecoder();
  for await(const bytes of response.body as any){pending+=decoder.decode(bytes,{stream:true});const lines=pending.split("\n");pending=lines.pop()!;
   for(const line of lines){if(!line.trim())continue;const event=JSON.parse(line);if(event.error)throw new Error(event.error);if(event.status==="success")completed=true;if(Date.now()-lastUpdate>1500||completed){lastUpdate=Date.now();await progress({status:event.status,completed:event.completed??null,total:event.total??null,digest:event.digest??null});}}
  }
  if(!completed)throw new Error("Model download ended without a success record");
  const tags=await fetch(`${base}/api/tags`,{redirect:"error"}).then(r=>r.json());const model=tags.models?.find((m:any)=>m.name===spec.tag);if(!model?.digest)throw new Error("Downloaded model is absent from the local registry");
  const installed=spec.target==="quality"?{...config,llmQualityModel:spec.tag,llmQualityModelDigest:model.digest,llmQualityDevice:"cpu" as const,llmUrl:`${base}/v1`}:{...config,llmModel:spec.tag,llmModelDigest:model.digest,llmUrl:`${base}/v1`};
  await writeJsonAtomic(ctx.store.p("state",spec.target==="quality"?"qwen-quality-install.json":"qwen3.5-install.json"),{model,source:`https://ollama.com/library/${spec.tag}`,license:"Verify official checkpoint and dependency licenses",status:"INSTALLED_NOT_INFERENCE_VERIFIED",at:new Date().toISOString()});
  return installed;
 },{waitMs:7200000,ttlMs:60000});
}
