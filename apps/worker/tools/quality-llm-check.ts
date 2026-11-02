/**
 * Real-machine check for the quality text profile (docs/AI_MODEL_DECISIONS.md work items A and B):
 *  1. install QUALITY_MODEL_TAG into the ACS-owned Ollama store through the qwen-quality setup profile,
 *  2. apply the installed model to a scratch config,
 *  3. verify it with the VI/EN fixtures and the controlled vision fixture (setup "verify" mode),
 *  4. prove the routing: a draft task runs on the fast model, a script_final task on the quality model on CPU.
 * Run from apps/worker: node ../../node_modules/tsx/dist/cli.mjs tools/quality-llm-check.ts
 * Evidence: docs/evidence/acs-quality-llm.json. Never run while a game holds the GPU (the VRAM guard would also refuse).
 */
import os from "node:os";
import path from "node:path";
import * as fs from "node:fs/promises";
import { buildContext } from "../src/context.js";
import { StudioStore, ModelSetupStore } from "@ttm/automation";
import { runJob } from "../src/handlers.js";
import { invokeLocalEngine } from "../src/local-engine.js";
import { stopManagedLlm } from "../src/managed-llm.js";

const root = process.env.ACS_ROOT ?? path.resolve(import.meta.dirname, "../../..");
process.env.ACS_ENGINE_RUNNER ??= path.join(root, "engines/runner.py");
async function runSetup(ctx: any, mode: "install" | "verify", profile: "qwen-quality" | "qwen3.5-9b") {
  const row = await new ModelSetupStore(ctx.store).enqueue({ profile, mode, root });
  const job = await ctx.queue.claim({ kinds: ["STUDIO_SETUP"], maxConcurrent: 1, gpuSlots: 1 });
  if (!job) throw new Error(`${profile} ${mode} job not available`);
  await runJob(ctx, job).catch(() => undefined);
  return (await new ModelSetupStore(ctx.store).get(row.id))!;
}
async function main() {
  const ctx = await buildContext({ dataDir: path.join(root, ".local/quality-setup/data") });
  const studio = new StudioStore(ctx.store);
  const models = path.join(root, ".local/models/ollama");
  const tags = await fetch("http://127.0.0.1:11435/api/tags").then((r) => r.json()).catch(() => null);
  const base = {
    ...(await studio.config()), python: path.join(root, ".local/engines/speech/Scripts/python.exe"), llmManaged: true,
    llmBinary: path.join(root, ".local/tools/ollama/ollama.exe"), llmModelStore: models, llmPort: 11435, llmDevice: "cuda" as const,
    llmModel: "qwen3.5:9b", llmModelDigest: tags?.models?.find((m: any) => m.name === "qwen3.5:9b")?.digest ?? "",
  };
  await studio.saveConfig(base as any);
  await ctx.store.updateSettings((s: any) => ({ ...s, paused: false, killSwitch: false }), "quality-llm-check");
  const evidence: Record<string, unknown> = { startedAt: new Date().toISOString() };
  try {
    const install = await runSetup(ctx, "install", "qwen-quality");
    evidence.install = { state: install.state, error: install.error ?? null, status: install.progress?.status ?? null };
    if (!install.resultConfig || !["installed", "verified"].includes(install.state)) throw new Error(`install did not finish: ${install.error ?? install.state}`);
    const applied = { ...(await studio.config()), llmQualityModel: (install.resultConfig as any).llmQualityModel, llmQualityModelDigest: (install.resultConfig as any).llmQualityModelDigest, llmQualityDevice: "cpu" as const };
    await studio.saveConfig(applied as any);
    // Reading 20 GB of weights during install leaves Windows with little free RAM for a short while. The app waits for RAM
    // (RAM_BUSY is retryable); this tool does the same before verifying.
    for (let i = 0; i < 60 && os.freemem() / 2 ** 30 < Number((applied as any).llmQualityMinFreeRamGb ?? 26); i++) await new Promise((resolve) => setTimeout(resolve, 10_000));
    const verify = await runSetup(ctx, "verify", "qwen-quality");
    evidence.verify = { state: verify.state, error: verify.error ?? null, vision: (verify.progress as any)?.visionStatus ?? null, evidence: (verify.progress as any)?.evidence ?? null };
    const config = await studio.config();
    const routed: Record<string, unknown> = {};
    for (const task of ["draft", "script_final"] as const) {
      const out = await invokeLocalEngine(ctx, config, { op: "script", task, language: "vi-VN", maxTokens: 400, prompt: "Viết một câu hook 12 từ bằng tiếng Việt cho video giới thiệu game thủ thành.", schema: { type: "object", properties: { hook: { type: "string" } }, required: ["hook"], additionalProperties: false } }, path.join(ctx.store.p("studio", "setup"), `route-${task}.request.json`));
      routed[task] = { model: out.model, device: out.device, profile: out.llmProfile, seconds: out.seconds, usage: out.usage, hook: out.script?.hook };
    }
    evidence.routing = routed;
    evidence.verdict = (routed.draft as any).model === base.llmModel && (routed.script_final as any).model === (applied as any).llmQualityModel ? "ROUTING_VERIFIED" : "ROUTING_MISMATCH";
  } catch (error: any) {
    evidence.error = String(error?.message ?? error); process.exitCode = 2;
  } finally { stopManagedLlm(); }
  evidence.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(root, "docs/evidence/acs-quality-llm.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
main().catch((error) => { console.error(error); stopManagedLlm(); process.exitCode = 1; });
