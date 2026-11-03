import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import {Timeline,EditOperation,applyTimelineEdits,planTimelinePrompt,ProductSettings,BrandStyle} from "@ttm/core";
import { DataStore, readJson, withLock, writeJsonAtomic } from "@ttm/storage";
import { FileQueue } from "./queue.js";
import { studioEngineKeys, engineKey, GPU_ENGINE_KEY } from "./engine-health.js";
import {ProductionSchedule,productionSlot} from "./studio-schedule.js";
import {Pronunciation} from "./pronunciation.js";
import {SourceWatchConfig,SourceItem,SourceWatchStore} from "./source-watch.js";
import {DiscoveryConfig,SourceOpportunity,OpportunityStore} from "./opportunities.js";

export const Locale = z.enum(["vi-VN", "en-US", "en-GB"]);
export const StudioConfig = z.object({
  alignmentModel:z.string().default(""),espeakPath:z.string().default(""),
  pythonEmbedding:z.string().default(""),embeddingModel:z.string().default(""),embeddingDevice:z.enum(["cuda","cpu"]).default("cuda"),
  pythonImage:z.string().default(""),imageModel:z.string().default(""),imageDevice:z.literal("cuda_cpu_offload").default("cuda_cpu_offload"),
  vadModel:z.string().default(""),vadSha256:z.string().regex(/^[a-f0-9]{64}$|^$/).default(""),pythonVad:z.string().default(""),
  locale: z.enum(["vi", "en"]).default("vi"),
  llmUrl: z.string().url().default("http://127.0.0.1:11435/v1"),
  llmModel: z.string().default(""),
  llmManaged:z.boolean().default(false),llmBinary:z.string().default(""),llmModelStore:z.string().default(""),llmPort:z.number().int().min(1024).max(65535).default(11435),llmDevice:z.enum(["cuda","cpu"]).default("cuda"),llmModelDigest:z.string().default(""),
  // Quality text profile (final scripts, translation, fact reasoning, judging, vision). Empty model = not installed.
  llmQualityModel:z.string().default(""),llmQualityModelDigest:z.string().default(""),llmQualityDevice:z.enum(["cuda","cpu"]).default("cpu"),llmQualityMinFreeRamGb:z.number().min(0).max(200).default(26),
  // Grace period for the previous call's copy of the model to unload (keep_alive=0 frees about 20 GB over several seconds) before RAM_BUSY is raised.
  llmQualityRamGraceMs:z.number().int().min(0).max(300000).default(45000),
  llmServerDevice:z.enum(["cuda","cpu"]).optional(),
  vramGuard:z.object({enabled:z.boolean().default(true),marginMb:z.number().int().min(0).max(8000).default(1500)}).default({enabled:true,marginMb:1500}),
  python: z.string().default("python"), pythonVi: z.string().default(""), pythonAsr: z.string().default(""),
  ffmpeg: z.string().default("ffmpeg"), ffprobe: z.string().default("ffprobe"),
  ttsViModel: z.string().default(""), ttsEnModel: z.string().default(""),
  ttsViCodec: z.string().default(""),
  asrModel: z.string().default(""), asrDevice: z.enum(["auto", "cpu", "cuda"]).default("auto"),
  voiceVi: z.string().default(""), voiceEn: z.string().default("af_heart"),
  voiceEnGb: z.string().default("bf_emma"),
  ttsDevice: z.enum(["auto", "cpu", "cuda"]).default("auto"),
  gpuLock: z.string().default(""),
  maxContext: z.number().int().min(1024).max(32768).default(8192),
  localOnly: z.literal(true).default(true),
  uv:z.string().default(process.env.ACS_RESOURCE_ROOT?path.join(process.env.ACS_RESOURCE_ROOT,"runtime","uv.exe"):"uv"),
});
export type StudioConfig = z.infer<typeof StudioConfig>;
export function localEndpoint(value: string): string {
  const u = new URL(value);
  if (u.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) || u.username || u.password)
    throw new Error("Only a loopback HTTP AI endpoint is allowed / Chỉ cho phép AI local");
  return u.href.replace(/\/$/, "");
}
export const Autopilot = z.object({
  brand:BrandStyle.default({}),
  discovery:DiscoveryConfig.default({}),opportunity:SourceOpportunity.nullable().default(null),
  project:z.object({id:z.string().uuid(),revision:z.number().int().positive()}).nullable().default(null),
  productSettings:ProductSettings.default({}),
  id: z.string().uuid(), name: z.string().max(160).default(""),
  family: z.enum(["game", "facts", "product", "localization", "shorts", "custom"]).default("game"),
  sourceFolder: z.string().default(""), sourceUrl: z.string().default(""),
  sourceWatch:SourceWatchConfig.default({}),sourceItem:SourceItem.nullable().default(null),
  brief: z.string().max(30000).default(""),
  researchUrls:z.array(z.string().url()).max(8).default([]),
  scriptText: z.string().max(20000).default(""),
  rights: z.enum(["PERMISSION_PENDING", "DISCOVERY_ONLY", "AUTHORIZED_REUSE"]).default("PERMISSION_PENDING"),
  rightsEvidence: z.string().max(10000).default(""),
  reusePermissions:z.object({cut:z.boolean().default(false),translate:z.boolean().default(false),dub:z.boolean().default(false),redistribute:z.boolean().default(false),expiresAt:z.string().datetime().nullable().default(null)}).default({}),
  languages: z.array(Locale).min(1).default(["vi-VN"]), audience: z.string().default(""),
  tone: z.string().default("clear"), targets: z.array(z.string()).default([]),
  pronunciation:z.array(Pronunciation).max(200).default([]),
  cadenceDays: z.number().int().min(1).max(365).default(2), timezone: z.string().default("Asia/Ho_Chi_Minh"),
  schedule:ProductionSchedule.default({}),
  durationSec: z.number().min(10).max(180).default(30), format: z.enum(["short_9x16", "long_16x9"]).default("short_9x16"),
  mode: z.enum(["DRAFT_ONLY", "REVIEW_REQUIRED", "AUTHORIZED_AUTO_PUBLISH"]).default("REVIEW_REQUIRED"),
  /** "muse": the finished video (with its own audio) comes from Meta Muse via the owner's browser session; ACS only reviews, checks and publishes it. */
  generation:z.enum(["pipeline","muse"]).default("pipeline"),musePrompts:z.array(z.string().trim().min(10).max(2000)).max(4).default([]),museOverlay:z.object({captions:z.boolean().default(false),logo:z.boolean().default(false)}).default({}),
  policyConsent: z.boolean().default(false), enabled: z.boolean().default(false),
  step: z.number().int().min(1).max(7).default(1), revision: z.number().int().positive().default(1),
  nextRunAt: z.string().datetime().nullable().default(null), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type Autopilot = z.infer<typeof Autopilot>;
export const STUDIO_STAGES = ["intake", "research", "script", "storyboard", "media", "voice", "captions", "preview", "quality", "repair", "render", "eligibility", "delivery", "analytics"] as const;
export const Stage = z.object({
  id: z.enum(STUDIO_STAGES), state: z.enum(["queued", "running", "passed", "flagged", "needs_input", "failed", "skipped", "blocked"]).default("queued"),
  note: z.string().default(""), startedAt: z.string().nullable().default(null), finishedAt: z.string().nullable().default(null),
});
export const Shot = z.object({ text: z.string().min(1).max(1500), asset: z.string().default(""), durationSec: z.number().positive().default(5),sourceStart:z.number().nonnegative().default(0),sourceDuration:z.number().positive().nullable().default(null) });
export const StudioRun = z.object({
  id: z.string().uuid(), autopilotId: z.string().uuid(), title: z.string(), language: Locale,
  snapshot: Autopilot, config: StudioConfig, snapshotHash: z.string(),
  state: z.enum(["queued", "running", "needs_input", "failed", "ready", "cancelled"]).default("queued"),
  stages: z.array(Stage), shots: z.array(Shot).default([]),
  sources: z.array(z.object({ file: z.string(), sha256: z.string(), size: z.number() })).default([]),
  outputs: z.array(z.string()).default([]), parentId: z.string().uuid().nullable().default(null),
  /** Edits re-applied in order after this version renders (free text revision of an already cut version). */
  replay:z.array(z.discriminatedUnion("kind",[z.object({kind:z.literal("cut"),start:z.number().nonnegative(),end:z.number().positive()}),z.object({kind:z.literal("timeline"),operations:z.array(EditOperation).max(50)})])).max(20).default([]),
  edit: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("cut"), start: z.number().nonnegative(), end: z.number().positive() }),
    z.object({ kind: z.literal("narration"), index: z.number().int().nonnegative(), text: z.string().trim().min(1).max(1500) }),
    z.object({kind:z.literal("timeline"),operations:z.array(EditOperation).max(50),restoreFrom:z.string().uuid().optional()}),
  ]).nullable().default(null),
  error: z.string().nullable().default(null), createdAt: z.string(), updatedAt: z.string(),
  researchHash:z.string().nullable().default(null),
  trigger:z.enum(["manual","scheduled","edit"]).default("manual"),
  planning:z.object({state:z.enum(["requested","ready","continuing"]),sha256:z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null)}).nullable().default(null),
  planRevision:z.object({parentId:z.string().uuid(),parentSha256:z.string().regex(/^[a-f0-9]{64}$/),changedScenes:z.array(z.number().int().nonnegative())}).nullable().default(null),
  repair:z.object({rootId:z.string().uuid(),parentId:z.string().uuid(),kind:z.enum(["captions","mix","encode"]),attempt:z.number().int().min(1).max(2),planSha256:z.string().regex(/^[a-f0-9]{64}$/)}).nullable().default(null),
  renderTimingVersion:z.union([z.literal(1),z.literal(2)]).default(1),
});
export type StudioRun = z.infer<typeof StudioRun>;
export const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
// Narration measures duration later; text, media and the source/config snapshot stay pinned.
export const planRunIdentity=(run:Pick<StudioRun,"snapshotHash"|"shots"|"sources">&{renderTimingVersion?:1|2})=>hash({snapshotHash:run.snapshotHash,renderTimingVersion:run.renderTimingVersion??1,sources:run.sources,shots:run.shots.map(({durationSec,...shot})=>shot)});

// Defaults added by a schema upgrade must not invalidate an authentic old snapshot.
// Verify the original representation BEFORE normalization; corrupt hashes stay corrupt.
const StoredRun = z.unknown().transform((input) => {
  const raw = input as StudioRun;
  const authentic = !!raw && raw.snapshotHash === hash({ a: raw.snapshot, config: raw.config });
  const run = StudioRun.parse(input);
  if (authentic) run.snapshotHash = hash({ a: run.snapshot, config: run.config });
  return run;
});

/** Match the current worker's top-level media intake, not directory timestamps. */
async function sourceFingerprint(a: Autopilot,now=new Date()): Promise<string | null> {
  if (!a.sourceFolder) return ["facts","product"].includes(a.family)&&(a.researchUrls.length||a.sourceUrl)?hash({urls:a.researchUrls,url:a.sourceUrl,brief:a.brief,productSettings:a.productSettings,pronunciation:a.pronunciation,slot:now.toISOString().slice(0,10)}):null;
  const entries = (await fs.readdir(a.sourceFolder, { withFileTypes: true }))
    .filter(e => e.isFile() && /\.(mp4|mov|webm|mkv|jpg|jpeg|png|webp)$/i.test(e.name))
    .sort((x, y) => x.name.localeCompare(y.name)).slice(0, 40);
  if (!entries.length) return null;
  const sources: { name: string; sha256: string }[] = [];
  for (const e of entries) {
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(path.join(a.sourceFolder, e.name))) digest.update(chunk);
    sources.push({ name: e.name, sha256: digest.digest("hex") });
  }
  return hash({ sources, family: a.family, brief: a.brief, scriptText: a.scriptText,
    audience: a.audience, tone: a.tone, productSettings:a.productSettings,pronunciation:a.pronunciation,durationSec: a.durationSec, format: a.format });
}

/** Existing JSON/JSONL store remains authoritative. Autopilots are recurring configs, not jobs. */
export class StudioStore {
  constructor(readonly store: DataStore) {}
  async config() { return (await readJson(this.store.p("config", "studio.json"), StudioConfig)) ?? StudioConfig.parse({}); }
  async saveConfig(input: unknown) {
    const c = StudioConfig.parse(input); localEndpoint(c.llmUrl);
    await writeJsonAtomic(this.store.p("config", "studio.json"), c); return c;
  }
  async list<T>(dir: string, schema: z.ZodType<T, z.ZodTypeDef, any>): Promise<T[]> {
    const files = await fs.readdir(this.store.p("studio", dir)).catch(() => [] as string[]);
    const rows = await Promise.all(files.filter(f => f.endsWith(".json")).map(f => readJson(this.store.p("studio", dir, f), schema)));
    return rows.filter(r => r !== null) as T[];
  }
  autopilots() { return this.list<Autopilot>("autopilots", Autopilot); }
  runs() { return this.list<StudioRun>("runs", StoredRun); }
  async autopilot(id: string) { z.string().uuid().parse(id); return readJson(this.store.p("studio", "autopilots", `${id}.json`), Autopilot); }
  async run(id: string) { z.string().uuid().parse(id); return readJson(this.store.p("studio", "runs", `${id}.json`), StoredRun); }
  async saveAutopilot(input: unknown) {
    const a = Autopilot.parse(input);
    a.opportunity=null; // Feed selections belong to immutable run snapshots, never persistent UI configuration.
    if(a.discovery.enabled){
      if(a.family!=="facts"||!a.discovery.feedConsent||!a.discovery.feeds.length||a.sourceFolder||a.scriptText.trim())throw new Error("Feed discovery needs facts, offered feeds consent, no media folder and an independently researched script");
      for(const value of a.discovery.feeds){const u=new URL(value);if(u.protocol!=="https:"||u.username||u.password)throw new Error("Discovery feeds require public HTTPS URLs");}
    }
    new Intl.DateTimeFormat("en-US",{timeZone:a.timezone}).format(new Date());
    if(a.schedule.enabled&&(new Set(a.languages).size>a.schedule.dailyLimit||new Set(a.languages).size>a.schedule.maxBacklog))throw new Error("Production limits must fit all selected language variants");
    if(a.sourceWatch.enabled&&!["localization","shorts"].includes(a.family))throw new Error("Folder watcher supports authorized localization and original-speech excerpts");
    if (a.enabled && (!a.name.trim() || (!a.sourceFolder && !a.sourceUrl&&!a.researchUrls.length&&!a.discovery.enabled) || !a.brief.trim())) throw new Error("Missing name, source or verified brief");
    if (a.enabled && a.mode === "AUTHORIZED_AUTO_PUBLISH") throw new Error("Auto-publish policy adapter not yet verified. Use Review Before Publish.");
    if (a.enabled && a.rights === "AUTHORIZED_REUSE" && !a.rightsEvidence.trim()) throw new Error("Rights evidence is required");
    a.updatedAt = new Date().toISOString();
    await withLock(this.store.p("locks", `autopilot-${a.id}.lock`), async () => {
      const old = await this.autopilot(a.id);
      if (old && a.revision !== old.revision) throw new Error("Autopilot changed in another session. Reload before saving / Cấu hình đã thay đổi, hãy tải lại.");
      a.revision = (old?.revision ?? 0) + 1;
      await writeJsonAtomic(this.store.p("studio", "autopilots", `${a.id}.json`), a);
    });
    await this.store.audit({ actor: "studio-ui", action: "autopilot.save", subject: a.id, detail: { revision: a.revision, enabled: a.enabled } });
    return a;
  }
  async saveRun(input: StudioRun) {
    const run = StudioRun.parse(input); run.updatedAt = new Date().toISOString();
    await writeJsonAtomic(this.store.p("studio", "runs", `${run.id}.json`), run); return run;
  }
  async enqueue(a: Autopilot, language: z.infer<typeof Locale>, slot: string, planOnly=false) {
    return withLock(this.store.p("locks", `studio-enqueue-${a.id}.lock`), async () => {
      if(planOnly&&["localization","shorts"].includes(a.family))throw new Error("Guided plan stop is not available for original-speech pipelines; use full production / Luồng lời gốc cần chạy Production đầy đủ");
      // Scheduled identities survive cadence/config-only saves and crash-before-nextRunAt.
      if(a.sourceWatch.enabled&&!a.sourceItem)throw new Error("Select and pin a watched source before enqueueing all language variants");
      if(a.discovery.enabled&&!a.opportunity)throw new Error("Scan and select an eligible feed opportunity before production");
      const key = (planOnly?"plan:":"")+(a.opportunity?`studio:${a.id}:${language}:opportunity:${a.opportunity.id}`:a.sourceItem?`studio:${a.id}:${language}:watch:${a.sourceItem.id}`:slot.startsWith("content:") ? `studio:${a.id}:${language}:${slot}` : `studio:${a.id}:r${a.revision}:${language}:${slot}`);
      const queue = new FileQueue(this.store);
      const old = await queue.findByKey(key); if (old) return { id: String(old.payload.runId), jobId: old.id };
      // Deterministic run id closes the write-run/enqueue crash window.
      const digest = hash(key); const id = `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
      if (!(await this.run(id))) {
        const config = await this.config();const voices=a.brand.voices;if(voices.vi)config.voiceVi=voices.vi;if(voices.enUs)config.voiceEn=voices.enUs;if(voices.enGb)config.voiceEnGb=voices.enGb; const now = new Date().toISOString();
        await this.saveRun(StudioRun.parse({ id, autopilotId: a.id, title: a.name, language, snapshot: a, config, snapshotHash: hash({ a, config }),renderTimingVersion:a.family==="shorts"?1:2,planning:planOnly?{state:"requested"}:null,trigger:slot.startsWith("content:")?"scheduled":"manual", stages: STUDIO_STAGES.map(id => ({ id })), createdAt: now, updatedAt: now }));
      }
      const row=(await this.run(id))!;
      const scriptProvided=!!a.scriptText.trim()&&!(["facts","product"].includes(a.family)&&(a.researchUrls.length||a.sourceUrl||a.opportunity));
      const baseKeys=planOnly?(scriptProvided?[]:[...(row.config.llmDevice!=="cpu"?[GPU_ENGINE_KEY]:[]),engineKey(row.config,"script")]):studioEngineKeys(row.config,language,scriptProvided&&a.family!=="localization",a.family);
      const matching=!["shorts","localization"].includes(a.family)&&a.sourceFolder&&row.config.pythonEmbedding&&row.config.embeddingModel;
      const engineKeys=[...new Set([...baseKeys,...(matching?[engineKey(row.config,"embed"),...(row.config.embeddingDevice==="cuda"?[GPU_ENGINE_KEY]:[])]:[])])];
      const { job } = await queue.enqueue({ kind: "STUDIO_RUN", idempotencyKey: key, payload: { runId: id, engineKeys }, usesGpu: engineKeys.includes(GPU_ENGINE_KEY) });
      return { id, jobId: job.id };
    });
  }
  async continuePlan(id:string){
    z.string().uuid().parse(id);
    return withLock(this.store.p("locks",`studio-plan-${id}.lock`),async()=>{
      const row=await this.run(id);
      if(!row?.planning?.sha256||!["ready","continuing"].includes(row.planning.state)||row.state==="cancelled"||row.parentId)throw new Error("No completed plan is available / Chưa có kế hoạch hoàn thành");
      const bytes=await fs.readFile(this.store.p("studio","artifacts",id,"plan.json"));
      if(createHash("sha256").update(bytes).digest("hex")!==row.planning.sha256)throw new Error("Plan artifact changed; create a new plan / Kế hoạch đã thay đổi");
      const plan=JSON.parse(bytes.toString("utf8"));
      if(planRunIdentity(plan)!==planRunIdentity(row))throw new Error("Plan no longer matches its pinned production");
      const control=await readJson(this.store.p("studio","controls",`${id}.json`),z.object({cancelled:z.boolean().default(false)}));
      if(control?.cancelled)throw new Error("Cancelled plans cannot be continued");
      const queue=new FileQueue(this.store),key=`studio:continue-plan:${id}:${row.planning.sha256}`,old=await queue.findByKey(key);
      if(old)return{id,jobId:old.id};
      await writeJsonAtomic(this.store.p("studio","controls",`${id}.json`),{paused:false,cancelled:false});
      row.planning.state="continuing";row.state="queued";row.error=null;await this.saveRun(row);
      const engineKeys=studioEngineKeys(row.config,row.language,true,row.snapshot.family);
      const {job}=await queue.enqueue({kind:"STUDIO_RUN",idempotencyKey:key,payload:{runId:id,engineKeys},usesGpu:engineKeys.includes(GPU_ENGINE_KEY)});
      await this.store.audit({actor:"studio-ui",action:"studio.continue_plan",subject:id,detail:{planSha256:row.planning.sha256,willPublish:false}});
      return{id,jobId:job.id};
    });
  }
  async tick(now = new Date()) {
    const settings = await this.store.getSettings();
    if (settings.paused || settings.killSwitch) return [];
    return withLock(this.store.p("locks", "studio-scheduler.lock"), async () => {
      const queued: string[] = [];
      for (const a of await this.autopilots()) {
        if (!a.enabled || (a.nextRunAt && new Date(a.nextRunAt) > now)) continue;
        const deferredFile=this.store.p("studio","schedule-waits",`${a.id}.json`),deferred=await fs.readFile(deferredFile,"utf8").then(JSON.parse,()=>null);
        if(deferred?.revision===a.revision&&Date.parse(deferred.nextCheckAt)>now.getTime())continue;
        const window=productionSlot(a,now,await this.runs());
        if(!window.allowed){await writeJsonAtomic(deferredFile,{revision:a.revision,reason:window.reason,nextCheckAt:window.nextAt??new Date(now.getTime()+86400000).toISOString()});await this.store.audit({actor:"studio-scheduler",action:"autopilot.window_deferred",subject:a.id,detail:window});continue;}
        // Hashing large gameplay files must not monopolize the configuration save lock.
        let fingerprint: string | null = null;
        let reason = "No supported local media; source URL ingestion is not implemented";
        let prepared:Autopilot|null=a;
        try {if(a.discovery.enabled){prepared=await this.prepareSource(a,now);fingerprint=prepared?.opportunity?`opportunity:${prepared.opportunity.id}`:null;reason="No new relevant, unexpired feed opportunity; no filler created";}else if(a.sourceWatch.enabled){prepared=await this.prepareSource(a,now);fingerprint=prepared?.sourceItem?`watch:${prepared.sourceItem.id}`:null;reason="No new eligible source file; existing identities are retained";}else fingerprint = await sourceFingerprint(a,now); }
        catch (e) { reason = `Cannot inspect source media: ${String(e)}`; }
        // Re-read under the UI save lock: a disabled/edited pilot must not enqueue stale work.
        await withLock(this.store.p("locks", `autopilot-${a.id}.lock`), async () => {
          const current = await this.autopilot(a.id);
          if (!current?.enabled || current.revision !== a.revision || (current.nextRunAt && new Date(current.nextRunAt) > now)) return;
          const settingsNow = await this.store.getSettings();
          if (settingsNow.paused || settingsNow.killSwitch) return;
          const before = queued.length;
          if (fingerprint) {
            for (const language of new Set(current.languages)) {
              const key = prepared?.opportunity?`studio:${current.id}:${language}:opportunity:${prepared.opportunity.id}`:prepared?.sourceItem?`studio:${current.id}:${language}:watch:${prepared.sourceItem.id}`:`studio:${current.id}:${language}:content:${fingerprint}`;
              const existing = await new FileQueue(this.store).findByKey(key);
              if (!existing) queued.push((await this.enqueue(prepared?.opportunity?{...current,opportunity:prepared.opportunity}:prepared?.sourceItem?{...current,sourceFolder:prepared.sourceFolder,sourceItem:prepared.sourceItem}:current, language, `content:${fingerprint}`)).id);
            }
            if (queued.length === before) reason = "No new editorial inputs or source media; skipped duplicate content";
          }
          if (!fingerprint || queued.length === before) await this.store.audit({ actor: "studio-scheduler", action: "autopilot.slot_skipped", subject: current.id, detail: { reason } });
          current.nextRunAt = new Date(now.getTime() + (current.discovery.enabled&&queued.length===before?current.discovery.intervalMinutes*60000:current.sourceWatch.enabled&&queued.length===before?current.sourceWatch.intervalMinutes*60000:current.cadenceDays * 86400000)).toISOString();
          await writeJsonAtomic(this.store.p("studio", "autopilots", `${a.id}.json`), current);
        });
      }
      return queued;
    });
  }
  prepareSource(a:Autopilot,now=new Date()){return this.runs().then(runs=>a.discovery.enabled?new OpportunityStore(this.store).prepare(a,runs,now):new SourceWatchStore(this.store).prepare(a,runs,now));}
  async cut(id: string, start: number, end: number, replay:StudioRun["replay"]=[]) {
    const parent = await this.run(id);
    if (!parent || parent.state !== "ready") throw new Error("A completed video is required");
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error("Invalid cut range");
    if(await this.timeline(id))return this.editTimeline(id,[{kind:"remove_range",start,end}],undefined,replay);
    const now = new Date().toISOString(); const nextId = randomUUID();
    const next = StudioRun.parse({ ...parent, planning:null,repair:null,planRevision:null,id: nextId, parentId: id, trigger:"edit",edit: { kind: "cut", start, end },replay, state: "queued", stages: STUDIO_STAGES.map(id => ({ id })), outputs: [], error: null, createdAt: now, updatedAt: now });
    await this.saveRun(next);
    await new FileQueue(this.store).enqueue({ kind: "STUDIO_RUN", idempotencyKey: `studio:edit:${nextId}`, payload: { runId: nextId }, usesGpu: false });
    return next;
  }
  async reviseNarration(id: string, index: number, text: string, replay:StudioRun["replay"]=[]):Promise<StudioRun> {
    const parent = await this.run(id);
    if(parent?.snapshot.family==="shorts")throw new Error("Original recorded speech cannot be rewritten with TTS. Trim the transcript or use an explicitly authorized localization workflow.");
    if (!parent || parent.state !== "ready") throw new Error("A completed version is required");
    if(parent.edit?.kind==="cut"||parent.edit?.kind==="timeline"){
      // Walk back to the version that holds the recorded narration, re-narrate there, then replay the same edits in order.
      const chain:StudioRun["replay"]=[];let base:StudioRun|null=parent;
      while(base&&(base.edit?.kind==="cut"||base.edit?.kind==="timeline")){if(base.edit.kind==="timeline"&&base.edit.restoreFrom)throw new Error("This version restores another version; edit that version instead");chain.unshift(base.edit.kind==="cut"?{kind:"cut",start:base.edit.start,end:base.edit.end}:{kind:"timeline",operations:base.edit.operations});base=base.parentId?await this.run(base.parentId):null;}
      if(!base||base.state!=="ready"||chain.length>20)throw new Error("The uncut source version is unavailable");
      if(base.shots.length!==parent.shots.length||base.shots.some((s,i)=>s.text!==parent.shots[i].text))throw new Error("Narration differs from the uncut version; edit the uncut version instead");
      return this.reviseNarration(base.id,index,text,chain);
    }
    const edit = z.object({ kind: z.literal("narration"), index: z.number().int().nonnegative(), text: z.string().trim().min(1).max(1500) }).parse({ kind: "narration", index, text });
    if (!parent.shots[index]) throw new Error("Narration segment does not exist");
    if (parent.shots[index].text === edit.text) throw new Error("Narration text is unchanged");
    const now = new Date().toISOString(); const nextId = randomUUID();
    const next = StudioRun.parse({ ...parent, planning:null,repair:null,planRevision:null,id: nextId, parentId: id, trigger:"edit",edit,replay,
      shots: parent.shots.map((s, i) => i === index ? { ...s, text: edit.text } : s),
      state: "queued", stages: STUDIO_STAGES.map(id => ({ id })), outputs: [], error: null, createdAt: now, updatedAt: now });
    await this.saveRun(next);
    const engineKeys=studioEngineKeys(next.config,next.language,true);
    await new FileQueue(this.store).enqueue({ kind: "STUDIO_RUN", idempotencyKey: `studio:edit:${nextId}`, payload: { runId: nextId,engineKeys }, usesGpu: engineKeys.includes(GPU_ENGINE_KEY) });
    return next;
  }
  async timeline(id:string){z.string().uuid().parse(id);return readJson(this.store.p("studio","artifacts",id,"timeline.json"),Timeline);}
  async calendar(days=14,now=new Date()){
    days=z.number().int().min(1).max(30).parse(days);const pilots=await this.autopilots(),existing=await this.runs(),projected=[...existing],slots:Record<string,unknown>[]=[],deferred:Record<string,unknown>[]=[];
    for(const pilot of pilots.filter(a=>a.enabled)){
      let candidate=new Date(Math.max(now.getTime(),pilot.nextRunAt?Date.parse(pilot.nextRunAt):now.getTime())),attempts=0;
      while(candidate.getTime()<now.getTime()+days*86400000&&attempts++<90){
        const window=productionSlot(pilot,candidate,projected);
        if(!window.allowed){if(window.reason.includes("Backlog")||!window.nextAt){deferred.push({autopilotId:pilot.id,name:pilot.name,reason:window.reason});break;}candidate=new Date(window.nextAt);continue;}
        for(const language of new Set(pilot.languages)){slots.push({autopilotId:pilot.id,name:pilot.name,language,at:candidate.toISOString(),timezone:pilot.timezone,kind:"PRODUCTION_PROJECTION",willPublish:false});projected.push({...existing[0],autopilotId:pilot.id,createdAt:candidate.toISOString(),trigger:"scheduled",state:"ready"} as StudioRun);}
        candidate=new Date(candidate.getTime()+pilot.cadenceDays*86400000);
      }
    }
    return {from:now.toISOString(),days,slots:slots.sort((a,b)=>String(a.at).localeCompare(String(b.at))),deferred,assumptions:["Simulation only: no jobs, uploads or account actions","Future production is assumed completed for quota simulation; actual backlog may defer work","Source novelty/rights/quality/available GPU are rechecked at execution; projections do not promise output","Production timing does not authorize or schedule public posting"]};
  }
  async planEdit(id:string,prompt:string){const timeline=await this.timeline(id);if(!timeline)throw new Error("This older version has no editable timeline; create a new production run");const plan=planTimelinePrompt(prompt,timeline);applyTimelineEdits(timeline,plan.operations);return plan;}
  async editTimeline(id:string,input:unknown,restoreFrom?:string,replay:StudioRun["replay"]=[]){
    const parent=await this.run(id);if(!parent||parent.state!=="ready")throw new Error("A completed video is required");
    const operations=z.array(EditOperation).max(50).parse(input);let timeline=await this.timeline(restoreFrom??id);if(!timeline)throw new Error("Editable timeline unavailable");
    if(restoreFrom){const candidate=await this.run(restoreFrom);if(!candidate||candidate.autopilotId!==parent.autopilotId)throw new Error("Restore version must belong to the same project");}
    else timeline=applyTimelineEdits(timeline,operations);
    const now=new Date().toISOString(),nextId=randomUUID();const next=StudioRun.parse({...parent,planning:null,repair:null,planRevision:null,id:nextId,parentId:id,trigger:"edit",edit:{kind:"timeline",operations,restoreFrom},replay,state:"queued",stages:STUDIO_STAGES.map(id=>({id})),outputs:[],error:null,createdAt:now,updatedAt:now});
    await writeJsonAtomic(this.store.p("studio","artifacts",nextId,"timeline.json"),timeline);await this.saveRun(next);
    await new FileQueue(this.store).enqueue({kind:"STUDIO_RUN",idempotencyKey:`studio:edit:${nextId}`,payload:{runId:nextId},usesGpu:false});return next;
  }
}
