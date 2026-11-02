import {reviseStudioPlan,previewStudioPlanLine,getStudioRepairPlan,requestStudioRepair} from "@ttm/automation";
import { randomUUID } from "node:crypto";
import { Autopilot, StudioStore, VoiceStore, ModelSetupStore, StudioReviewStore, EngineHealthStore, GPU_ENGINE_KEY, discoverStudioTools, MODEL_CATALOG, localEndpoint, StudioPublishingStore,SourceWatchState } from "@ttm/automation";
import * as fs from "node:fs/promises";
import path from "node:path";
import { SecretStore, FileLock, withLock, writeJsonAtomic } from "@ttm/storage";
import { runProcess, probeGpu } from "@ttm/media";
import { getQueue, getStore } from "../../lib/data";
import {ImageStore} from "@ttm/automation";
import {DiscoveryState} from "@ttm/automation";
export const dynamic = "force-dynamic";

/** Folder that owns ".local" (engines, models, tools): ACS_SETUP_ROOT, else the nearest parent of the working directory with a workspace marker. */
async function defaultSetupRoot(){
  if(process.env.ACS_SETUP_ROOT)return path.resolve(process.env.ACS_SETUP_ROOT);
  let dir=process.cwd();
  for(let i=0;i<5;i++){if(await fs.stat(path.join(dir,"pnpm-workspace.yaml")).then(()=>true,()=>false)||await fs.stat(path.join(dir,".local")).then(()=>true,()=>false))return dir;const up=path.dirname(dir);if(up===dir)break;dir=up;}
  // Packaged app: keep downloads in the per-user app folder, never inside the (possibly read-only, replaced on update) install folder.
  if(process.env.ACS_DESKTOP_CONFIG)return path.resolve(process.env.ACS_DESKTOP_CONFIG);
  return process.cwd();
}
export async function GET() {
  const store = await getStore(); const studio = new StudioStore(store);
  const [autopilots, runs, config, counts, settings, workerHealth] = await Promise.all([studio.autopilots(), studio.runs(), studio.config(), (await getQueue()).counts(), store.getSettings(), new FileLock(store.p("locks", "worker.lock"),{ttlMs:90_000}).health()]);
  const publishing=new StudioPublishingStore(store),channels=await Promise.all((await publishing.channels()).map(async c=>({...c,credentialsPresent:await new SecretStore(store).has(publishing.secretRef(c)),check:await fs.readFile(store.p("studio","channel-checks",`${c.id}.json`),"utf8").then(JSON.parse,()=>null)})));
  const desktopRecovery=process.env.ACS_DESKTOP_CONFIG?await fs.readFile(path.join(process.env.ACS_DESKTOP_CONFIG,"desktop-status.json"),"utf8").then(JSON.parse,()=>null):null;
  return Response.json({ defaultSetupRoot:await defaultSetupRoot(),desktopRecovery:desktopRecovery?{status:desktopRecovery.status,recovery:desktopRecovery.recovery,error:desktopRecovery.error}:null,autopilots, runs: runs.sort((a,b) => b.createdAt.localeCompare(a.createdAt)), config, counts, settings: { paused: settings.paused, killSwitch: settings.killSwitch, studioPostingEnabled:await publishing.postingEnabled(),telegram: settings.telegram },channels,publications:await publishing.list(),watches:await studio.list("watches",SourceWatchState),opportunities:await studio.list("opportunities",DiscoveryState), worker:workerHealth.status==="online"?workerHealth.record:null,workerHealth, models: MODEL_CATALOG, setups:await new ModelSetupStore(store).list(),engines:await new EngineHealthStore(store).list(),voices: await new VoiceStore(store).list(), images: await new ImageStore(store).list(), dataDir: store.root });
}
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== `http://${request.headers.get("host")}`) return Response.json({ error: "Invalid origin" }, { status: 403 });
  try {
    const body = await request.json(); const store = await getStore(); const studio = new StudioStore(store);
    switch (body.action) {
      case "scan-opportunities":{const a=await studio.autopilot(String(body.id));if(!a?.discovery.enabled||!a.discovery.feedConsent)throw new Error("Enable a permitted feed source first");return Response.json(await(await getQueue()).enqueue({kind:"STUDIO_DISCOVERY_SCAN",idempotencyKey:`discovery-scan:${a.id}:${randomUUID()}`,payload:{autopilotId:a.id},usesGpu:false,maxAttempts:3}));}
      case "generate-image":return Response.json(await new ImageStore(store).enqueue(body));
      case "save-channel":return Response.json(await new StudioPublishingStore(store).saveChannel({...body.value,id:body.value.id??randomUUID()},body.credentials));
      case "check-channel":{
        const channel=await new StudioPublishingStore(store).channel(String(body.id));if(!channel)throw new Error("Channel not found");
        return Response.json(await(await getQueue()).enqueue({kind:"STUDIO_CHANNEL_CHECK",idempotencyKey:`channel-check:${channel.id}:${randomUUID()}`,payload:{channelId:channel.id},usesGpu:false}));
      }
      case "publish-version":return Response.json(await new StudioPublishingStore(store).request(body));
      case "check-publication":{
        const row=await new StudioPublishingStore(store).get(String(body.id));if(!row?.remoteId)throw new Error("No confirmed remote ID");
        return Response.json(await(await getQueue()).enqueue({kind:"STUDIO_PUBLICATION_CHECK",idempotencyKey:`publication-check:${row.id}:${randomUUID()}`,payload:{publicationId:row.id},usesGpu:false}));
      }
      case "posting-policy":{
        if(body.authorize!==true)throw new Error("Explicit owner authorization required");
        await new StudioPublishingStore(store).setPostingEnabled(body.enabled===true);return Response.json({ok:true});
      }
      case "scan-source":{const a=await studio.autopilot(String(body.id));if(!a?.sourceWatch.enabled)throw new Error("Folder watcher is disabled");return Response.json(await(await getQueue()).enqueue({kind:"STUDIO_WATCH_SCAN",idempotencyKey:`watch-scan:${a.id}:${randomUUID()}`,payload:{autopilotId:a.id},usesGpu:false}));}
      case "calendar":return Response.json(await studio.calendar(Number(body.days??14)));
      case "get-run":return Response.json(await studio.run(String(body.id)));
      case "review-decision":return Response.json(await new StudioReviewStore(store).decide(body));
      case "setup-model":return Response.json(await new ModelSetupStore(store).enqueue(body));
      case "apply-setup":{
        const row=await new ModelSetupStore(store).get(String(body.id));if(!row?.resultConfig||!["installed","verified"].includes(row.state))throw new Error("Setup has not completed");
        const current=await studio.config(),merged={...current};
        const keys=row.profile==="wav2vec2-en-align"?["pythonAsr","alignmentModel"]:row.profile==="qwen-embedding"?["pythonEmbedding","embeddingModel","embeddingDevice"]:row.profile==="flux2-klein-4b"?["pythonImage","imageModel","imageDevice"]:row.profile==="silero-vad"?["pythonVad","vadModel","vadSha256"]:row.profile==="qwen-quality"?["llmManaged","llmBinary","llmModelStore","llmPort","llmUrl","llmQualityModel","llmQualityModelDigest","llmQualityDevice"]:row.profile==="qwen3.5-9b"?["llmManaged","llmBinary","llmModelStore","llmPort","llmUrl","llmModel","llmModelDigest"]:row.profile==="kokoro"?["python","ttsEnModel"]:row.profile==="vieneu"?["pythonVi","ttsViModel","ttsViCodec","voiceVi"]:["pythonAsr","asrModel"];
        for(const key of keys)(merged as any)[key]=(row.resultConfig as any)[key];return Response.json(await studio.saveConfig(merged));
      }
      case "save-autopilot": {
        const now = new Date().toISOString(); const id = body.value.id || randomUUID();
        const old = await studio.autopilot(id);
        return Response.json(await studio.saveAutopilot({ ...old, ...body.value, id, createdAt: old?.createdAt ?? now, updatedAt: now }));
      }
      case "revise-plan":return Response.json(await reviseStudioPlan(studio,body));
      case "preview-plan-line":return Response.json(await previewStudioPlanLine(studio,String(body.id),Number(body.index)));
      case "repair-plan":return Response.json(await getStudioRepairPlan(studio,String(body.id)));
      case "repair-version":return Response.json(await requestStudioRepair(studio,body));
      case "continue-plan":return Response.json(await studio.continuePlan(String(body.id)));
      case "plan":
      case "run": {
        const a = await studio.autopilot(body.id); if (!a) throw new Error("Autopilot not found");
        if (!a.brief.trim()) throw new Error("Provide a verified source brief first");
        const prepared=await studio.prepareSource(a);if(!prepared)throw new Error("No new eligible source or feed opportunity; check source scan status first");if((await studio.autopilot(a.id))?.revision!==a.revision)throw new Error("Autopilot changed while pinning the source. Reload first.");
        const runs = []; for (const lang of new Set(a.languages)) runs.push(await studio.enqueue(prepared, lang, `manual:${randomUUID()}`,body.action==="plan"));
        return Response.json(runs);
      }
      case "save-config": return Response.json(await studio.saveConfig(body.value));
      case "discover-tools": return Response.json(await discoverStudioTools(String(body.root ?? ""), await studio.config()));
      case "voice-sample": return Response.json(await new VoiceStore(store).enqueue(body));
      case "voice-review": return Response.json(await new VoiceStore(store).review(body.id, body.decision, body.audioSha256));
      case "reset-engine":{
        await new EngineHealthStore(store).reset(String(body.key),"studio-ui");const queue=await getQueue();
        for(const job of await queue.list("queued"))if((Array.isArray(job.payload.engineKeys)&&job.payload.engineKeys.includes(body.key))||(body.key===GPU_ENGINE_KEY&&job.usesGpu))await queue.transition(job.id,"queued","Engine reset; allow a new probe",j=>({...j,notBefore:null}));
        return Response.json({ok:true});
      }
      case "control-run":{
        const row=await studio.run(String(body.id));if(!row)throw new Error("Run not found");
        if(!["pause","resume","cancel"].includes(body.command))throw new Error("Invalid run control");
        if(row.state==="cancelled"||row.state==="ready")throw new Error("Completed or cancelled version cannot be controlled");
        if(row.planning?.state==="ready"&&body.command==="resume")return Response.json(await studio.continuePlan(row.id));
        return await withLock(store.p("locks",`studio-plan-${row.id}.lock`),async()=>{
          const current=await studio.run(row.id);if(!current||["ready","cancelled"].includes(current.state))throw new Error("Version state changed; reload before controlling");
          await writeJsonAtomic(store.p("studio","controls",`${row.id}.json`),{paused:body.command==="pause",cancelled:body.command==="cancel"});
          const queue=await getQueue();for(const job of await queue.list("queued"))if(job.payload.runId===row.id){
            if(body.command==="cancel")await queue.transition(job.id,"failed","Cancelled by owner; artifacts retained");
            else if(body.command==="resume")await queue.transition(job.id,"queued","Resume at checkpoint",j=>({...j,notBefore:null}));
          }
          if(body.command==="cancel"&&current.state!=="running")await studio.saveRun({...current,state:"cancelled"});
          return Response.json({ok:true});
        });
      }
      case "pause": {
        await store.updateSettings(s => ({ ...s, paused: !!body.value }), "studio-ui"); return Response.json({ ok: true });
      }
      case "stop": {
        await store.updateSettings(s => ({ ...s, paused: true, killSwitch: true }), "studio-ui"); return Response.json({ ok: true });
      }
      case "clear-stop": {
        await store.updateSettings(s => ({ ...s, killSwitch: false, paused: true }), "studio-ui"); return Response.json({ ok: true });
      }
      case "retry": {
        const q = await getQueue(); const j = await q.get(body.id);
        if (!j || !["failed", "needs_review", "manual_action"].includes(j.state)) throw new Error("Job is not retryable");
        await q.transition(j.id, "queued", "Explicit retry by studio UI", x => ({ ...x, attempts: 0 })); return Response.json({ ok: true });
      }
      case "cut": return Response.json(await studio.cut(body.id, Number(body.start), Number(body.end)));
      case "revise-narration": return Response.json(await studio.reviseNarration(body.id, Number(body.index), String(body.text ?? "")));
      case "plan-edit":return Response.json(await studio.planEdit(String(body.id),String(body.prompt??"")));
      case "edit-timeline":return Response.json(await studio.editTimeline(String(body.id),body.operations));
      case "restore-version":return Response.json(await studio.editTimeline(String(body.id),[],String(body.restoreFrom)));
      case "probe": {
        const c = await studio.config(); const results: Record<string, unknown> = {};
        results.gpu = await probeGpu({ verifyNvenc: false });
        for (const tool of ["ffmpeg", "ffprobe"] as const) {
          results[tool] = await runProcess(c[tool], ["-version"], { timeoutMs: 15000 }).then(r => ({ ok: r.code === 0, detail: r.stdout.split("\n")[0] }), e => ({ ok: false, detail: e.message }));
        }
        results.llm = await fetch(localEndpoint(c.llmUrl) + "/models", { signal: AbortSignal.timeout(10000), redirect: "error" }).then(async r => ({ ok: r.ok, data: await r.json() }), e => ({ ok: false, detail: e.message }));
        await store.audit({ actor: "studio-ui", action: "tools.probe", subject: "local" });
        return Response.json(results);
      }
      default: throw new Error("Unknown action");
    }
  } catch (e: any) { return Response.json({ error: e.message }, { status: 400 }); }
}
