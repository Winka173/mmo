import { z } from "zod";

/**
 * Two text-model profiles (docs/AI_MODEL_DECISIONS.md section 3).
 *  fast    = StudioConfig.llm*          routine drafts, on the GPU
 *  quality = StudioConfig.llmQuality*   final scripts, translation, fact reasoning, judging, vision; CPU by default
 * The runner and the managed Ollama only ever see an effective config, so quality lock, digest pinning and engine
 * health keys stay per model.
 */
export const LlmTask = z.enum(["draft", "classify", "comment_reply", "script_final", "translate", "fact_reasoning", "judge_text", "judge_vision"]);
export type LlmTask = z.infer<typeof LlmTask>;
export const QUALITY_TASKS: readonly LlmTask[] = ["script_final", "translate", "fact_reasoning", "judge_text", "judge_vision"];
/** Tasks whose result must never be marked verified on the fast model alone. */
export const REVIEW_IF_FAST: readonly LlmTask[] = QUALITY_TASKS;

export type LlmChoice = {
  profile: "fast" | "quality";
  task: LlmTask;
  model: string;
  device: "cuda" | "cpu";
  /** True when a quality task had to run on the fast model: the result needs human review, never auto-verification. */
  reviewRequired: boolean;
  reason: string;
  /** Minimum free RAM (GB) to admit this choice; 0 when it does not need to be checked. */
  minFreeRamGb: number;
  config: Record<string, any>;
};

export function parseLlmTask(value: unknown): LlmTask {
  const parsed = LlmTask.safeParse(value);
  return parsed.success ? parsed.data : "draft";
}

export function resolveLlmProfile(config: Record<string, any>, taskValue?: unknown): LlmChoice {
  const task = parseLlmTask(taskValue);
  // The managed server must expose the GPU whenever any profile uses it; CPU-only requests set num_gpu=0 per call.
  const serverDevice: "cuda" | "cpu" = config.llmDevice === "cuda" || (config.llmQualityModel && config.llmQualityDevice === "cuda") ? "cuda" : "cpu";
  const wantsQuality = (QUALITY_TASKS as readonly string[]).includes(task);
  if (wantsQuality && config.llmQualityModel) {
    const device: "cuda" | "cpu" = config.llmQualityDevice === "cuda" ? "cuda" : "cpu";
    return {
      profile: "quality", task, model: config.llmQualityModel, device, reviewRequired: false, reason: `${task} uses the quality profile`,
      minFreeRamGb: device === "cpu" ? Number(config.llmQualityMinFreeRamGb ?? 26) : 0,
      config: { ...config, llmModel: config.llmQualityModel, llmModelDigest: config.llmQualityModelDigest ?? "", llmDevice: device, llmServerDevice: serverDevice },
    };
  }
  return {
    profile: "fast", task, model: config.llmModel, device: config.llmDevice === "cpu" ? "cpu" : "cuda",
    reviewRequired: wantsQuality, minFreeRamGb: 0,
    reason: wantsQuality ? `${task} wanted the quality model but none is installed: result is flagged for human review` : `${task} uses the fast profile`,
    config: { ...config, llmServerDevice: serverDevice },
  };
}

export function ramAdmission(freeGb: number, minFreeGb: number): { ok: boolean; reason: string } {
  if (minFreeGb <= 0 || freeGb >= minFreeGb) return { ok: true, reason: `free RAM ${freeGb.toFixed(1)} GB` };
  return { ok: false, reason: `RAM_BUSY: free RAM ${freeGb.toFixed(1)} GB < ${minFreeGb} GB needed for the quality model on CPU. Waiting; the model was not loaded.` };
}
