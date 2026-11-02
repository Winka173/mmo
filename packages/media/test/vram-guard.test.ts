import { describe, expect, it } from "vitest";
import { checkVramBeforeGpu, evaluateVram, gpuOperationEstimateMb, type GpuProbe } from "../src/index.js";

const probe = (usedMb: number | null, extra: Partial<GpuProbe> = {}): GpuProbe => ({ available: true, name: "NVIDIA GeForce RTX 5070 Ti", vramTotalMb: 16303, vramUsedMb: usedMb, temperatureC: 40, utilizationPct: 5, driver: "610", cuda: "13", nvencVerified: false, detail: "", ...extra });

describe("VRAM guard (gaming guard)", () => {
  it("waits, loading nothing, while a game holds about 9 GB and the stage needs more than what is left", () => {
    const r = evaluateVram(probe(9035), { needMb: 9500, mayUseCpu: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/GPU_BUSY/);
    expect(r.retryAfterMs).toBe(60000);
    expect(r.freeMb).toBe(16303 - 9035);
  });
  it("runs a small stage next to a game when it really fits with the margin", () => {
    expect(evaluateVram(probe(9035), { needMb: 1500, mayUseCpu: false }).ok).toBe(true);
    expect(evaluateVram(probe(9035), { needMb: 5500, mayUseCpu: false }).ok).toBe(true); // 7268 MB free, 5500 + 1500 margin = 7000
    expect(evaluateVram(probe(9035), { needMb: 6000, mayUseCpu: false }).ok).toBe(false); // 7500 needed
  });
  it("admits when the desktop alone is using the GPU", () => {
    expect(evaluateVram(probe(3132), { needMb: 9500, mayUseCpu: false }).ok).toBe(true);
  });
  it("auto devices drop to CPU instead of waiting; explicit CUDA stages wait", () => {
    const auto = evaluateVram(probe(12000), { needMb: 5000, mayUseCpu: true });
    expect(auto).toMatchObject({ ok: true, downgradeToCpu: true });
    expect(evaluateVram(probe(12000), { needMb: 5000, mayUseCpu: false }).ok).toBe(false);
  });
  it("never blocks on a missing measurement or a missing GPU; the engine fails loudly if CUDA is required", () => {
    expect(evaluateVram(probe(null), { needMb: 9000, mayUseCpu: false }).ok).toBe(true);
    expect(evaluateVram(probe(0, { available: false, vramTotalMb: null }), { needMb: 9000, mayUseCpu: false }).ok).toBe(true);
  });
  it("maps operations to the right device from the effective config", () => {
    expect(gpuOperationEstimateMb("script", { llmDevice: "cpu" })).toBeNull();
    expect(gpuOperationEstimateMb("script", { llmDevice: "cuda" })).toMatchObject({ needMb: 7500 });
    expect(gpuOperationEstimateMb("asr", { asrDevice: "auto" })).toMatchObject({ mayUseCpu: true });
    expect(gpuOperationEstimateMb("asr", { asrDevice: "cpu" })).toBeNull();
    expect(gpuOperationEstimateMb("image", {})).toMatchObject({ needMb: 9500 });
    expect(gpuOperationEstimateMb("embed", { embeddingDevice: "cpu" })).toBeNull();
    expect(gpuOperationEstimateMb("vad", {})).toBeNull();
  });
  it("uses the measured probe through checkVramBeforeGpu and honours the margin and the off switch", async () => {
    const game = async () => probe(9035);
    expect((await checkVramBeforeGpu("image", {}, { probe: game })).ok).toBe(false);
    expect((await checkVramBeforeGpu("script", { llmDevice: "cpu" }, { probe: game })).ok).toBe(true);
    expect((await checkVramBeforeGpu("image", { vramGuard: { enabled: false } }, { probe: game })).ok).toBe(true);
    expect((await checkVramBeforeGpu("tts", { ttsDevice: "cuda", vramGuard: { marginMb: 8000 } }, { probe: async () => probe(7000) })).ok).toBe(false);
  });
});
