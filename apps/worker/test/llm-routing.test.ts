import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StudioConfig } from "@ttm/automation";
import { buildContext } from "../src/context.js";
import { tmpDir } from "../../../packages/storage/test/helpers.js";

const guard = vi.hoisted(() => ({ result: { ok: true, reason: "test", retryAfterMs: null as number | null, freeMb: 9000, needMb: 1500, downgradeToCpu: false } }));
vi.mock("@ttm/media", async (original) => ({ ...(await original<typeof import("@ttm/media")>()), checkVramBeforeGpu: async () => guard.result }));
const { invokeLocalEngine } = await import("../src/local-engine.js");

/** A fake engine: prints the effective config it was given, so the test sees exactly which model, digest and device ran. */
async function fakeRunner(dir: string) {
  const file = path.join(dir, "fake-runner.mjs");
  await fs.writeFile(file, `import fs from "node:fs";const req=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));const c=req.config;console.log(JSON.stringify({script:{ok:true},model:c.llmModel,model_digest:c.llmModelDigest,device:c.llmDevice,server:c.llmServerDevice,task:req.task??null}));`);
  return file;
}
async function setup() {
  const dir = await tmpDir("acs-llm-routing-");
  process.env.ACS_ENGINE_RUNNER = await fakeRunner(dir);
  const ctx = await buildContext({ dataDir: dir });
  const config = StudioConfig.parse({
    python: process.execPath, llmManaged: false, llmUrl: "http://127.0.0.1:11435/v1", llmModel: "qwen3.5:9b", llmModelDigest: "d9", llmDevice: "cuda",
    llmQualityModel: "gemma4:31b", llmQualityModelDigest: "d35", llmQualityDevice: "cpu", llmQualityMinFreeRamGb: 26, llmQualityRamGraceMs: 0,
  });
  return { dir, ctx, config, file: (name: string) => path.join(dir, `${name}.request.json`) };
}
afterEach(() => { vi.restoreAllMocks(); guard.result = { ok: true, reason: "test", retryAfterMs: null, freeMb: 9000, needMb: 1500, downgradeToCpu: false }; delete process.env.ACS_ENGINE_RUNNER; });

describe("text model routing in the engine invocation", () => {
  it("draft work runs the fast model; final scripts and judging run the quality model on CPU with its own digest", async () => {
    vi.spyOn(os, "freemem").mockReturnValue(40 * 2 ** 30);
    const { ctx, config, file } = await setup();
    const fast: any = await invokeLocalEngine(ctx, config, { op: "script", task: "draft", language: "vi-VN" }, file("fast"));
    expect(fast).toMatchObject({ model: "qwen3.5:9b", model_digest: "d9", device: "cuda", server: "cuda", llmProfile: { profile: "fast", reviewRequired: false } });
    for (const task of ["script_final", "translate", "fact_reasoning", "judge_text", "judge_vision"]) {
      const quality: any = await invokeLocalEngine(ctx, config, { op: "script", task, language: "vi-VN" }, file(task));
      expect(quality).toMatchObject({ model: "gemma4:31b", model_digest: "d35", device: "cpu", server: "cuda", llmProfile: { profile: "quality", reviewRequired: false } });
    }
    const untagged: any = await invokeLocalEngine(ctx, config, { op: "script", language: "en-US" }, file("untagged"));
    expect(untagged.model).toBe("qwen3.5:9b");
  });
  it("without an installed quality model a quality task falls back to the fast model and is flagged for human review", async () => {
    const { ctx, config, file } = await setup();
    const out: any = await invokeLocalEngine(ctx, { ...config, llmQualityModel: "" }, { op: "script", task: "fact_reasoning" }, file("fallback"));
    expect(out).toMatchObject({ model: "qwen3.5:9b", llmProfile: { profile: "fast", reviewRequired: true } });
  });
  it("waits (retryable RAM_BUSY) instead of loading the CPU quality model when free RAM is short; nothing runs", async () => {
    vi.spyOn(os, "freemem").mockReturnValue(20 * 2 ** 30);
    const { ctx, config, file } = await setup();
    await expect(invokeLocalEngine(ctx, config, { op: "script", task: "script_final" }, file("ram"))).rejects.toMatchObject({ code: "RAM_BUSY", errorClass: "RETRYABLE" });
    await expect(fs.stat(file("ram"))).rejects.toThrow(); // the request file was never written
    // the fast model does not need that RAM
    await expect(invokeLocalEngine(ctx, config, { op: "script", task: "draft" }, file("ram-ok"))).resolves.toMatchObject({ model: "qwen3.5:9b" });
  });
  it("gaming guard: a GPU stage waits with GPU_BUSY while another program holds the VRAM; CPU quality work is unaffected", async () => {
    vi.spyOn(os, "freemem").mockReturnValue(40 * 2 ** 30);
    const { ctx, config, file } = await setup();
    guard.result = { ok: false, reason: "GPU_BUSY: free VRAM 7268 MB < 9000 MB needed (a game is using 9035 MB)", retryAfterMs: 60000, freeMb: 7268, needMb: 9000, downgradeToCpu: false };
    await expect(invokeLocalEngine(ctx, config, { op: "script", task: "draft" }, file("busy"))).rejects.toMatchObject({ code: "GPU_BUSY", errorClass: "RETRYABLE" });
    await expect(fs.stat(file("busy"))).rejects.toThrow();
  });
});
