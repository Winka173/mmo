import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DataStore, readJson, withLock, writeJsonAtomic } from "@ttm/storage";
import { FileQueue } from "./queue.js";
import { Locale, StudioConfig, StudioStore, hash } from "./studio.js";
import { studioEngineKeys } from "./engine-health.js";

export const VoiceSample = z.object({
  id: z.string().uuid(), language: Locale, text: z.string().trim().min(1).max(1500),
  config: StudioConfig, configHash: z.string(),
  state: z.enum(["queued", "running", "ready", "failed"]),
  evidence: z.record(z.unknown()).nullable().default(null),
  audioSha256: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  humanReview: z.enum(["NOT_REVIEWED", "ACCEPTED", "REJECTED"]).default("NOT_REVIEWED"),
  reviewedAt: z.string().nullable().default(null), createdAt: z.string(), updatedAt: z.string(),
});
export type VoiceSample = z.infer<typeof VoiceSample>;
const StoredVoiceSample = z.unknown().transform(input => {
  const raw = input as VoiceSample; const authentic = !!raw && raw.configHash === hash(raw.config);
  const row = VoiceSample.parse(input); if (authentic) row.configHash = hash(row.config); return row;
});

/** Auditions are durable worker jobs, never long-running web requests. */
export class VoiceStore {
  constructor(readonly store: DataStore) {}
  file(id: string) { z.string().uuid().parse(id); return this.store.p("studio", "voices", `${id}.json`); }
  audio(id: string) { z.string().uuid().parse(id); return this.store.p("studio", "voice-audio", `${id}.wav`); }
  get(id: string) { return readJson(this.file(id), StoredVoiceSample); }
  async list() {
    const names = await fs.readdir(this.store.p("studio", "voices")).catch(() => [] as string[]);
    const rows = await Promise.all(names.filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).map(n => this.get(n.slice(0, -5))));
    return rows.filter((r): r is VoiceSample => !!r).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  }
  async save(value: VoiceSample) { const row = VoiceSample.parse(value); row.updatedAt = new Date().toISOString(); await writeJsonAtomic(this.file(row.id), row); return row; }
  async enqueue(input: unknown) {
    const value = z.object({ language: Locale, text: z.string().trim().min(1).max(1500), voice: z.string().trim().max(100).optional() }).parse(input);
    const config = await new StudioStore(this.store).config();
    // A preview of a specific voice: the sample records the voice in its own config snapshot.
    if (value.voice) { if (value.language === "vi-VN") config.voiceVi = value.voice; else if (value.language === "en-GB") config.voiceEnGb = value.voice; else config.voiceEn = value.voice; }
    delete (value as any).voice; const id = randomUUID(); const now = new Date().toISOString();
    const sample = await this.save(VoiceSample.parse({ ...value, id, config, configHash: hash(config), state: "queued", createdAt: now, updatedAt: now }));
    const { job } = await new FileQueue(this.store).enqueue({ kind: "STUDIO_VOICE", idempotencyKey: `voice:${id}`, payload: { sampleId: id, engineKeys:studioEngineKeys(config,value.language,true) }, usesGpu: config.ttsDevice !== "cpu" || !!config.asrModel&&config.asrDevice!=="cpu", priority: 2 });
    return { ...sample, jobId: job.id };
  }
  async review(id: string, decision: unknown, expectedSha256: unknown) {
    const humanReview = z.enum(["ACCEPTED", "REJECTED"]).parse(decision);
    return withLock(this.store.p("locks", `voice-review-${z.string().uuid().parse(id)}.lock`), async () => {
      const row = await this.get(id);
      if (!row || row.state !== "ready" || !row.audioSha256 || row.audioSha256 !== expectedSha256) throw new Error("Listen to the current completed sample before reviewing / Hãy nghe bản mẫu hoàn tất hiện tại.");
      const { createHash } = await import("node:crypto");
      const actual = createHash("sha256").update(await fs.readFile(this.audio(id))).digest("hex");
      if (actual !== row.audioSha256) throw new Error("Sample audio changed; generate a new audition / Audio đã thay đổi, hãy tạo mẫu mới.");
      const saved = await this.save({ ...row, humanReview, reviewedAt: new Date().toISOString() });
      await this.store.audit({ actor: "studio-ui", action: "voice.review", subject: id, detail: { humanReview, audioSha256: actual } });
      return saved;
    });
  }
}

/** Only inspect an explicitly selected engine root. Never download or mutate another app. */
export async function discoverStudioTools(root: string, current: StudioConfig) {
  if (!root.trim() || !path.isAbsolute(root)) throw new Error("Choose an absolute local setup folder / Chọn đường dẫn thư mục tuyệt đối.");
  const base = path.resolve(root); const config = { ...current }; const found: string[] = [];
  const candidates: Partial<Record<keyof StudioConfig, string[]>> = {
    python: [".local/engines/speech/Scripts/python.exe", "engines/speech/Scripts/python.exe"],
    pythonVi: [".local/engines/vieneu/Scripts/python.exe", "engines/vieneu/Scripts/python.exe"],
    pythonAsr: [".local/engines/asr/Scripts/python.exe", "engines/asr/Scripts/python.exe"],
    pythonImage:[".local/engines/image/Scripts/python.exe","engines/image/Scripts/python.exe"],
    imageModel:[".local/models/flux2-klein-4b","models/flux2-klein-4b"],
    asrModel: [".local/models/qwen3-asr", "models/qwen3-asr"],
    alignmentModel:[".local/models/wav2vec2-en-align","models/wav2vec2-en-align"],
    ttsEnModel: [".local/models/kokoro", "models/kokoro"],
    ttsViModel: [".local/models/vieneu", "models/vieneu"],
    ttsViCodec: [".local/models/moss-nano", "models/moss-nano"],
    ffmpeg: [".local/tools/ffmpeg.exe", "tools/ffmpeg.exe"],
    ffprobe: [".local/tools/ffprobe.exe", "tools/ffprobe.exe"],
  };
  for (const [key, paths] of Object.entries(candidates)) {
    for (const rel of paths!) {
      const file = path.join(base, rel); const stat = await fs.stat(file).catch(() => null);
      if (!stat || (key.startsWith("tts") || key === "asrModel" || key === "imageModel"||key==="alignmentModel" ? !stat.isDirectory() : !stat.isFile())) continue;
      if((key==="imageModel"||key==="alignmentModel")&&!await fs.stat(path.join(file,"acs-manifest.json")).catch(()=>null))continue;
      (config as any)[key] = file; found.push(key); break;
    }
  }
  if (found.includes("ttsViModel") && !config.voiceVi) config.voiceVi = "Minh Quân";
  return { config, found, root: base, note: "Detected paths only. Run diagnostics and audition before use." };
}
