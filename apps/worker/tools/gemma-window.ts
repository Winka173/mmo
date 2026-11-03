/**
 * Waits for a free-RAM window (Asset Forge frees RAM between its stages) and then runs the real quality-script stage
 * (task script_final -> Gemma 4 31B on CPU) with the 02/11 trial brief, for comparison with the Qwen3.5-9B script.
 * Low cost: one os.freemem() reading every INTERVAL minutes; nothing is loaded until the 26 GB gate is met.
 * Never pauses, closes or touches Asset Forge. Evidence: docs/evidence/gemma-window.json.
 * Run from apps/worker: node ../../node_modules/tsx/dist/cli.mjs tools/gemma-window.ts [maxHours]
 */
import os from "node:os";
import path from "node:path";
import * as fs from "node:fs/promises";
import { buildContext } from "../src/context.js";
import { StudioConfig } from "@ttm/automation";
import { invokeLocalEngine } from "../src/local-engine.js";
import { stopManagedLlm } from "../src/managed-llm.js";

const root = process.env.ACS_ROOT ?? path.resolve(import.meta.dirname, "../../..");
process.env.ACS_ENGINE_RUNNER ??= path.join(root, "engines/runner.py");
const evidenceFile = path.join(root, "docs/evidence/gemma-window.json"), trialRun = "ce1ff632-8d67-4ce3-ae34-0a1cf8948d03";
const trialData = path.join(root, ".local/trial/2026-11-02T07-22-57-937Z/data");
const intervalMin = Number(process.env.GEMMA_INTERVAL_MIN ?? 5), maxHours = Number(process.argv[2] ?? 20), gate = 27;
const samples: { at: string; freeGb: number }[] = [];
const save = (extra: Record<string, unknown>) => fs.writeFile(evidenceFile, JSON.stringify({ purpose: "Real Gemma 4 31B script_final run when RAM allows; Asset Forge untouched", gateGb: gate, intervalMin, samples, ...extra }, null, 2));
async function main() {
  const base = JSON.parse(await fs.readFile(path.join(trialData, "config/studio.json"), "utf8"));
  const quality = JSON.parse(await fs.readFile(path.join(root, ".local/quality-setup/data/config/studio.json"), "utf8"));
  const config = StudioConfig.parse({ ...base, llmQualityModel: "gemma4:31b", llmQualityModelDigest: quality.llmQualityModelDigest, llmQualityDevice: "cpu", llmQualityRamGraceMs: 60000 });
  const run = JSON.parse(await fs.readFile(path.join(trialData, "studio/runs", `${trialRun}.json`), "utf8"));
  const qwen = JSON.parse(await fs.readFile(path.join(trialData, "studio/artifacts", trialRun, "llm-evidence.json"), "utf8"));
  const ctx = await buildContext({ dataDir: path.join(root, ".local/gemma-window/data") });
  const deadline = Date.now() + maxHours * 3600_000;
  for (;;) {
    const freeGb = +(os.freemem() / 2 ** 30).toFixed(1); samples.push({ at: new Date().toISOString(), freeGb });
    if (freeGb >= gate) {
      try {
        const started = Date.now();
        const result: any = await invokeLocalEngine(ctx, config, { op: "script", task: "script_final", language: run.language, system: `Write a concise video script in ${run.language}. Use ONLY supplied facts. Do not invent features, dates, firsthand tests or evidence. Return JSON {"shots":[{"text":"narration"}]} with 3 to 6 short scenes. No markdown. Target ${run.snapshot.durationSec} seconds.`, prompt: run.snapshot.brief }, path.join(root, ".local/gemma-window/script.request.json"));
        await save({ status: "RAN", wallSeconds: (Date.now() - started) / 1000, gemma: { model: result.model, device: result.device, profile: result.llmProfile, shots: result.script?.shots }, qwen: { model: qwen.model, device: qwen.device, profile: qwen.llmProfile, shots: qwen.script?.shots }, brief: run.snapshot.brief });
        stopManagedLlm();
        return;
      } catch (error: any) { samples.push({ at: new Date().toISOString(), freeGb: -1 }); await save({ status: "WAITING", lastError: String(error.message).slice(0, 300) }); }
    } else await save({ status: "WAITING" });
    if (Date.now() > deadline) { await save({ status: "NO_WINDOW", note: `No ${gate} GB free-RAM window within ${maxHours} h` }); return; }
    await new Promise((r) => setTimeout(r, intervalMin * 60_000));
  }
}
main().then(() => process.exit(0), async (e) => { await save({ status: "ERROR", error: String(e?.message ?? e).slice(0, 500) }); process.exit(1); });
