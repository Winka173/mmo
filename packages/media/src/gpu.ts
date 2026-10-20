import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { FactoryError } from "@ttm/core";
import { FFMPEG, runProcess } from "./exec.js";

export type GpuProbe = {
  available: boolean;
  name: string | null;
  vramTotalMb: number | null;
  vramUsedMb: number | null;
  temperatureC: number | null;
  utilizationPct: number | null;
  driver: string | null;
  cuda: string | null;
  /** Probed with a real 1-second NVENC encode; never assumed from the GPU name. */
  nvencVerified: boolean;
  detail: string;
};

type Runner = typeof runProcess;

/** Probe nvidia-smi (if present) and verify NVENC with a real encode. Values are measured, not assumed. */
export async function probeGpu(opts: { run?: Runner; verifyNvenc?: boolean } = {}): Promise<GpuProbe> {
  const run = opts.run ?? runProcess;
  const none: GpuProbe = { available: false, name: null, vramTotalMb: null, vramUsedMb: null, temperatureC: null, utilizationPct: null, driver: null, cuda: null, nvencVerified: false, detail: "" };
  let r;
  try {
    r = await run("nvidia-smi", ["--query-gpu=name,memory.total,memory.used,temperature.gpu,utilization.gpu,driver_version", "--format=csv,noheader,nounits"], { timeoutMs: 10_000 });
  } catch {
    return { ...none, detail: "Không có nvidia-smi — dùng CPU" };
  }
  if (r.code !== 0 || !r.stdout.trim()) return { ...none, detail: "nvidia-smi không trả dữ liệu — dùng CPU" };
  const [name, total, used, temp, util, driver] = r.stdout.trim().split("\n")[0].split(",").map((s) => s.trim());
  const num = (s: string) => (s && !/N\/A|\[/.test(s) && Number.isFinite(Number(s)) ? Number(s) : null);
  let cuda: string | null = null;
  const v = await run("nvidia-smi", [], { timeoutMs: 10_000 }).catch(() => null);
  if (v) cuda = /CUDA Version:\s*([\d.]+)/.exec(v.stdout)?.[1] ?? null;
  let nvencVerified = false;
  if (opts.verifyNvenc !== false) {
    const out = path.join(os.tmpdir(), `ttm-nvenc-probe-${process.pid}.mp4`);
    const t = await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720:d=1", "-c:v", "h264_nvenc", out], { timeoutMs: 30_000 }).catch(() => null);
    nvencVerified = !!t && t.code === 0;
    await fs.rm(out, { force: true });
  }
  return { available: true, name, vramTotalMb: num(total), vramUsedMb: num(used), temperatureC: num(temp), utilizationPct: num(util), driver, cuda, nvencVerified, detail: nvencVerified ? "NVENC đã kiểm chứng" : "GPU có nhưng NVENC chưa kiểm chứng" };
}

export type GpuAdmission = { admit: boolean; useGpu: boolean; reason: string; retryAfterMs: number | null };

/**
 * GPU Resource Manager: decides per heavy job whether to run on GPU, fall back to CPU, or wait.
 * Honours measured free VRAM, temperature ceiling and the configured profile. Never starts a GPU
 * job when the measured free VRAM is below the estimate (the "two heavy jobs" rule).
 */
export class GpuResourceManager {
  private reservedMb = 0;
  constructor(
    private readonly cfg: { profile: "auto" | "cpu-only" | "rtx-16gb"; maxTempC: number; minFreeVramMb: number },
    private readonly probe: () => Promise<GpuProbe> = () => probeGpu({ verifyNvenc: false }),
  ) {}

  async admit(job: { estimateVramMb: number; gpuPreferred: boolean }): Promise<GpuAdmission> {
    if (this.cfg.profile === "cpu-only" || !job.gpuPreferred) return { admit: true, useGpu: false, reason: "profile/công việc dùng CPU", retryAfterMs: null };
    const p = await this.probe();
    if (!p.available) return { admit: true, useGpu: false, reason: `không có GPU (${p.detail}) — CPU fallback`, retryAfterMs: null };
    if (p.temperatureC !== null && p.temperatureC >= this.cfg.maxTempC)
      return { admit: false, useGpu: false, reason: `GPU ${p.temperatureC}°C ≥ ngưỡng ${this.cfg.maxTempC}°C — tạm hoãn để hạ nhiệt`, retryAfterMs: 5 * 60_000 };
    if (p.vramTotalMb === null || p.vramUsedMb === null) return { admit: true, useGpu: false, reason: "không đo được VRAM — không giả định, dùng CPU", retryAfterMs: null };
    const free = p.vramTotalMb - p.vramUsedMb - this.reservedMb;
    if (free - job.estimateVramMb < this.cfg.minFreeVramMb)
      return { admit: true, useGpu: false, reason: `VRAM trống ${free} MB không đủ cho ${job.estimateVramMb} MB + dự phòng ${this.cfg.minFreeVramMb} MB — CPU fallback`, retryAfterMs: null };
    this.reservedMb += job.estimateVramMb;
    return { admit: true, useGpu: true, reason: `GPU ${p.name}: trống ${free} MB`, retryAfterMs: null };
  }

  release(estimateVramMb: number): void {
    this.reservedMb = Math.max(0, this.reservedMb - estimateVramMb);
  }
}

/** Measure real encode throughput on this machine (frames/sec) — used instead of assumed specs. */
export async function benchmarkEncoders(opts: { seconds?: number; includeNvenc?: boolean } = {}): Promise<{ codec: string; fps: number | null; ok: boolean; detail: string }[]> {
  const sec = opts.seconds ?? 3;
  const out = path.join(os.tmpdir(), `ttm-bench-${process.pid}.mp4`);
  const res: { codec: string; fps: number | null; ok: boolean; detail: string }[] = [];
  for (const codec of ["libx264", ...(opts.includeNvenc ? ["h264_nvenc"] : [])]) {
    const r = await runProcess(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc2=s=1080x1920:r=30:d=${sec}`, "-c:v", codec, out], { timeoutMs: 120_000 }).catch((e) => ({ code: -1, stderr: String(e?.message), stdout: "", ms: 0 }));
    res.push(r.code === 0 ? { codec, fps: Math.round((sec * 30 * 1000) / Math.max(1, r.ms)), ok: true, detail: `${r.ms} ms cho ${sec * 30} khung 1080x1920` } : { codec, fps: null, ok: false, detail: r.stderr.slice(-200) });
  }
  await fs.rm(out, { force: true });
  return res;
}

// ------------------------------------------------------------------ model registry

export type ModelEntry = { id: string; kind: "tts" | "asr" | "llm" | "image" | "other"; file: string; sha256: string | null; license: string; commercialUseOk: boolean | null; minVramMb: number | null; notes?: string };

async function sha256(file: string) {
  const h = createHash("sha256");
  await new Promise<void>((res, rej) => createReadStream(file).on("data", (c) => h.update(c)).on("end", res).on("error", rej));
  return h.digest("hex");
}

/** Model registry check: file present, hash matches the recorded one, licence explicitly recorded. */
export async function verifyModels(models: ModelEntry[]): Promise<{ id: string; ok: boolean; problems: string[] }[]> {
  const out = [];
  for (const m of models) {
    const problems: string[] = [];
    const exists = await fs.stat(m.file).catch(() => null);
    if (!exists) problems.push(`thiếu file ${m.file}`);
    else if (m.sha256 && (await sha256(m.file)) !== m.sha256) problems.push("SHA256 không khớp — model bị thay đổi");
    if (!m.license || /unknown/i.test(m.license)) problems.push("chưa ghi license");
    if (m.commercialUseOk !== true) problems.push("chưa xác nhận dùng thương mại");
    out.push({ id: m.id, ok: problems.length === 0, problems });
  }
  return out;
}

/** Disk pre-check before render: estimate ~ duration * bitrate * 3 (work files + final + proxy). */
export function assertDiskForRender(freeGb: number | null, durationSec: number, minFreeGb: number): void {
  if (freeGb === null) return;
  const needGb = (durationSec * 8e6 * 3) / 8 / 1024 ** 3;
  if (freeGb - needGb < minFreeGb)
    throw new FactoryError("DISK_LOW", "RETRYABLE", `Ổ đĩa còn ${freeGb.toFixed(1)} GB, cần ~${needGb.toFixed(2)} GB + ngưỡng ${minFreeGb} GB — hủy dựng an toàn`, { retryAfter: new Date(Date.now() + 3600_000).toISOString() });
}
