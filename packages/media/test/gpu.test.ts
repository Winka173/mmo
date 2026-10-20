import { describe, expect, it } from "vitest";
import { GpuResourceManager, assertDiskForRender, probeGpu, type GpuProbe } from "../src/index.js";

const probe = (p: Partial<GpuProbe>) => async (): Promise<GpuProbe> => ({ available: true, name: "NVIDIA GeForce RTX 5070 Ti", vramTotalMb: 16303, vramUsedMb: 1000, temperatureC: 55, utilizationPct: 10, driver: "x", cuda: "12.8", nvencVerified: true, detail: "", ...p });

describe("GPU Resource Manager (AB3)", () => {
  it("falls back to CPU when no GPU / VRAM unknown; never assumes VRAM from the model name", async () => {
    const none = new GpuResourceManager({ profile: "auto", maxTempC: 83, minFreeVramMb: 1500 }, async () => ({ ...(await probe({})()), available: false, detail: "none" }));
    expect(await none.admit({ estimateVramMb: 2000, gpuPreferred: true })).toMatchObject({ admit: true, useGpu: false });
    const unknown = new GpuResourceManager({ profile: "auto", maxTempC: 83, minFreeVramMb: 1500 }, probe({ vramUsedMb: null }));
    expect((await unknown.admit({ estimateVramMb: 2000, gpuPreferred: true })).useGpu).toBe(false);
  });
  it("does not start a second heavy job when measured VRAM is insufficient (OOM avoidance)", async () => {
    const m = new GpuResourceManager({ profile: "auto", maxTempC: 83, minFreeVramMb: 1500 }, probe({}));
    expect((await m.admit({ estimateVramMb: 9000, gpuPreferred: true })).useGpu).toBe(true);
    const second = await m.admit({ estimateVramMb: 9000, gpuPreferred: true });
    expect(second).toMatchObject({ admit: true, useGpu: false });
    expect(second.reason).toMatch(/CPU fallback/);
    m.release(9000);
    expect((await m.admit({ estimateVramMb: 9000, gpuPreferred: true })).useGpu).toBe(true);
  });
  it("defers heavy work when the GPU is overheating", async () => {
    const m = new GpuResourceManager({ profile: "auto", maxTempC: 83, minFreeVramMb: 1500 }, probe({ temperatureC: 90 }));
    expect(await m.admit({ estimateVramMb: 100, gpuPreferred: true })).toMatchObject({ admit: false, retryAfterMs: 300000 });
  });
  it("probeGpu parses nvidia-smi output and reports missing tool honestly", async () => {
    const fake = async (cmd: string, args: string[]) =>
      args.length ? { code: 0, stdout: "NVIDIA GeForce RTX 5070 Ti, 16303, 812, 47, 3, 576.02\n", stderr: "", ms: 1 } : { code: 0, stdout: "| CUDA Version: 12.9 |", stderr: "", ms: 1 };
    const p = await probeGpu({ run: fake as any, verifyNvenc: false });
    expect(p).toMatchObject({ available: true, vramTotalMb: 16303, vramUsedMb: 812, temperatureC: 47, cuda: "12.9", nvencVerified: false });
    const missing = await probeGpu({ run: (async () => { throw new Error("ENOENT"); }) as any });
    expect(missing.available).toBe(false);
  });
  it("cancels a render safely when disk is low", () => {
    expect(() => assertDiskForRender(10.1, 600, 10)).toThrow(/hủy dựng an toàn/);
    expect(() => assertDiskForRender(50, 600, 10)).not.toThrow();
  });
});
