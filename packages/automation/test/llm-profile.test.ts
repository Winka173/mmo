import { describe, expect, it } from "vitest";
import { engineKey, parseLlmTask, ramAdmission, resolveLlmProfile, StudioConfig } from "../src/index.js";

const base = StudioConfig.parse({ llmManaged: true, llmModel: "qwen3.5:9b", llmModelDigest: "d9", llmDevice: "cuda" });
const withQuality = StudioConfig.parse({ llmManaged: true, llmModel: "qwen3.5:9b", llmModelDigest: "d9", llmDevice: "cuda", llmQualityModel: "gemma4:31b", llmQualityModelDigest: "d35", llmQualityDevice: "cpu" });

describe("LLM profiles (fast and quality)", () => {
  it("routine work stays on the fast GPU profile", () => {
    for (const task of ["draft", "classify", "comment_reply", "unknown-thing", undefined]) {
      const c = resolveLlmProfile(withQuality, task);
      expect(c).toMatchObject({ profile: "fast", model: "qwen3.5:9b", device: "cuda", reviewRequired: false });
      expect(c.config.llmModel).toBe("qwen3.5:9b");
    }
    expect(parseLlmTask("nope")).toBe("draft");
  });
  it("final scripts, translation, fact reasoning and judging use the quality model on CPU with its own digest", () => {
    for (const task of ["script_final", "translate", "fact_reasoning", "judge_text", "judge_vision"]) {
      const c = resolveLlmProfile(withQuality, task);
      expect(c).toMatchObject({ profile: "quality", model: "gemma4:31b", device: "cpu", reviewRequired: false, minFreeRamGb: 26 });
      expect(c.config).toMatchObject({ llmModel: "gemma4:31b", llmModelDigest: "d35", llmDevice: "cpu" });
    }
  });
  it("the managed server keeps the GPU visible while the CPU quality model runs, so profile switches never restart it", () => {
    expect(resolveLlmProfile(withQuality, "script_final").config.llmServerDevice).toBe("cuda");
    expect(resolveLlmProfile(withQuality, "draft").config.llmServerDevice).toBe("cuda");
    const cpuOnly = StudioConfig.parse({ llmDevice: "cpu", llmQualityModel: "x", llmQualityDevice: "cpu" });
    expect(resolveLlmProfile(cpuOnly, "script_final").config.llmServerDevice).toBe("cpu");
  });
  it("without a quality model a quality task falls back to the fast model and is flagged for human review", () => {
    const c = resolveLlmProfile(base, "fact_reasoning");
    expect(c).toMatchObject({ profile: "fast", reviewRequired: true });
    expect(c.reason).toMatch(/human review/);
  });
  it("engine health and quality-lock keys differ per model", () => {
    const fast = engineKey(resolveLlmProfile(withQuality, "draft").config, "script");
    const quality = engineKey(resolveLlmProfile(withQuality, "script_final").config, "script");
    expect(fast).not.toBe(quality);
  });
  it("admits the CPU quality model only with enough free RAM", () => {
    expect(ramAdmission(40, 26).ok).toBe(true);
    const low = ramAdmission(22.4, 26);
    expect(low.ok).toBe(false);
    expect(low.reason).toMatch(/RAM_BUSY/);
    expect(ramAdmission(1, 0).ok).toBe(true);
  });
  it("old configs without the new fields still parse and use the fast profile", () => {
    const old = StudioConfig.parse({ llmModel: "qwen3.5:9b" });
    expect(old.llmQualityModel).toBe("");
    expect(old.vramGuard).toEqual({ enabled: true, marginMb: 1500 });
    expect(resolveLlmProfile(old, "script_final").profile).toBe("fast");
  });
});
