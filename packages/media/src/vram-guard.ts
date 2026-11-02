import { probeGpu, type GpuProbe } from "./gpu.js";

/**
 * Gaming / foreign-process guard (docs/AI_MODEL_DECISIONS.md section 4.3).
 * Before any GPU stage, compare MEASURED free VRAM (whole device, so a game or any other program counts) with the
 * stage's peak estimate plus a margin. Not enough room means wait: never load weights, never push another program into
 * out-of-memory. Values come from nvidia-smi; nothing is assumed from the GPU name.
 */
export type VramGuardConfig = { enabled: boolean; marginMb: number };
export const DEFAULT_VRAM_GUARD: VramGuardConfig = { enabled: true, marginMb: 1500 };

/** Measured or documented PyTorch peaks (MiB) per operation, from docs/MODEL_COMPATIBILITY.md. */
export const VRAM_ESTIMATE_MB = { script: 7500, asr: 5000, tts: 1500, image: 9500, embed: 1600 } as const;

export type VramGuardResult = { ok: boolean; reason: string; retryAfterMs: number | null; freeMb: number | null; needMb: number; downgradeToCpu: boolean };

/** Which device an operation will use, from the (effective) config. null = it does not touch the GPU. */
export function gpuOperationEstimateMb(op: string, config: Record<string, any>): { needMb: number; mayUseCpu: boolean } | null {
  if (op === "script") return config.llmDevice === "cpu" ? null : { needMb: VRAM_ESTIMATE_MB.script, mayUseCpu: false };
  if (op.startsWith("asr")) return config.asrDevice === "cpu" ? null : { needMb: VRAM_ESTIMATE_MB.asr, mayUseCpu: config.asrDevice === "auto" };
  if (op.startsWith("image")) return { needMb: VRAM_ESTIMATE_MB.image, mayUseCpu: false };
  if (op === "embed") return config.embeddingDevice === "cuda" ? { needMb: VRAM_ESTIMATE_MB.embed, mayUseCpu: false } : null;
  if (op === "tts" || op === "narrate") return config.ttsDevice === "cpu" ? null : { needMb: VRAM_ESTIMATE_MB.tts, mayUseCpu: config.ttsDevice === "auto" };
  return null;
}

/** Pure decision, unit-tested with fake probes. */
export function evaluateVram(probe: GpuProbe, need: { needMb: number; mayUseCpu: boolean }, guard: VramGuardConfig = DEFAULT_VRAM_GUARD): VramGuardResult {
  const needMb = need.needMb + guard.marginMb;
  if (!guard.enabled) return { ok: true, reason: "VRAM guard disabled", retryAfterMs: null, freeMb: null, needMb, downgradeToCpu: false };
  // No GPU or no measurement: do not block here. The engine itself fails loudly if CUDA is required and missing.
  if (!probe.available || probe.vramTotalMb === null || probe.vramUsedMb === null) return { ok: true, reason: `no VRAM measurement (${probe.detail || "nvidia-smi unavailable"})`, retryAfterMs: null, freeMb: null, needMb, downgradeToCpu: false };
  const freeMb = probe.vramTotalMb - probe.vramUsedMb;
  if (freeMb >= needMb) return { ok: true, reason: `free VRAM ${freeMb} MB >= ${needMb} MB needed`, retryAfterMs: null, freeMb, needMb, downgradeToCpu: false };
  if (need.mayUseCpu) return { ok: true, reason: `free VRAM ${freeMb} MB < ${needMb} MB; the configured device is auto, so this stage runs on CPU`, retryAfterMs: null, freeMb, needMb, downgradeToCpu: true };
  return { ok: false, reason: `GPU_BUSY: free VRAM ${freeMb} MB < ${needMb} MB needed (another program, such as a game, is using ${probe.vramUsedMb} MB). Waiting; nothing was loaded.`, retryAfterMs: 60_000, freeMb, needMb, downgradeToCpu: false };
}

export async function checkVramBeforeGpu(op: string, config: Record<string, any>, deps: { probe?: () => Promise<GpuProbe> } = {}): Promise<VramGuardResult> {
  const need = gpuOperationEstimateMb(op, config);
  const guard: VramGuardConfig = { ...DEFAULT_VRAM_GUARD, ...(config.vramGuard ?? {}) };
  if (!need) return { ok: true, reason: "operation does not use the GPU", retryAfterMs: null, freeMb: null, needMb: 0, downgradeToCpu: false };
  if (!guard.enabled) return evaluateVram({ available: false } as GpuProbe, need, guard);
  const probe = await (deps.probe ?? (() => probeGpu({ verifyNvenc: false })))();
  return evaluateVram(probe, need, guard);
}
