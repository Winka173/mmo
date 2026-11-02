import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { Autopilot, StudioStore, FileQueue, discoverStudioTools } from "@ttm/automation";
import { DataStore } from "@ttm/storage";
import { buildContext } from "../apps/worker/src/context.js";
import { runJob } from "../apps/worker/src/handlers.js";

async function main() {
  if (process.argv[2] === "--child") {
    const ctx = await buildContext({ dataDir: process.argv[3] });
    const job = await ctx.queue.claim({ maxConcurrent: 1, gpuSlots: 1, kinds: ["STUDIO_RUN"] });
    assert.ok(job); await runJob(ctx, job); return;
  }
  const root = process.cwd(); const dataDir = path.join(root, ".local/crash-resume", randomUUID());
  const store = new DataStore(dataDir); await store.init(); const studio = new StudioStore(store);
  const detected = await discoverStudioTools(root, await studio.config());
  await studio.saveConfig({ ...detected.config, ttsDevice: "cpu", asrModel: "", pythonAsr: "" });
  const source = path.join(root, ".local/e2e-studio/fixture-input");
  assert.ok((await fs.stat(path.join(source, "fixture.mp4"))).isFile(), "Run studio-e2e.ts once to generate the clearly labeled fixture");
  const now = new Date().toISOString();
  const autopilot = await studio.saveAutopilot(Autopilot.parse({ id: randomUUID(), name: "Crash recovery fixture — NOT GAMEPLAY", sourceFolder: source,
    brief: "Software fixture. No public posting.", scriptText: "This is a software crash recovery test. Original files remain available after the application restarts.\n\nThis second narration segment is produced locally and must be reused without changes after recovery.",
    rights: "AUTHORIZED_REUSE", rightsEvidence: "FFmpeg calibration footage and test-authored narration", languages: ["en-US"], createdAt: now, updatedAt: now }));
  const queued = await studio.enqueue(autopilot, "en-US", now);
  const dir = store.p("studio", "artifacts", queued.id); let output = "";
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/studio-crash-resume.ts", "--child", dataDir], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", b => output += b); child.stderr.on("data", b => output += b);
  let interrupted = false;
  try {
    for (let i = 0; i < 720; i++) {
      const row = await studio.run(queued.id);
      if (row?.state === "failed" || child.exitCode !== null) throw new Error(`Child exited before render interruption: ${row?.error ?? output.slice(-2000)}`);
      if (row?.stages.some(s => s.id === "render" && s.state === "running")) { interrupted = true; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(interrupted, "Never reached the real FFmpeg render stage");
  } finally {
    if (child.pid) await new Promise(resolve => { const stop = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }); stop.on("close", resolve); });
  }
  const digest = async (file: string) => createHash("sha256").update(await fs.readFile(file)).digest("hex");
  const files = ["voice-0.wav", "voice-1.wav", "source-0.mp4", "voice-model-pin.json"];
  const before = Object.fromEntries(await Promise.all(files.map(async f => [f, await digest(path.join(dir, f))])));
  const queue = new FileQueue(store); const recovery = await queue.recover(); assert.equal(recovery.requeued, 1);
  const ctx = await buildContext({ dataDir }); const job = await ctx.queue.claim({ maxConcurrent: 1, gpuSlots: 1, kinds: ["STUDIO_RUN"] });
  assert.equal(job?.id, queued.jobId); await runJob(ctx, job!);
  const after = Object.fromEntries(await Promise.all(files.map(async f => [f, await digest(path.join(dir, f))])));
  assert.deepEqual(after, before); assert.equal((await studio.run(queued.id))?.state, "ready");
  assert.equal((await queue.get(queued.jobId))?.state, "succeeded");
  const report = { status: "VERIFIED", scope: "controlled real worker process killed during FFmpeg rendering", fixture: true, genuineGameplay: false,
    runId: queued.id, jobId: queued.jobId, recovery, reusedByteIdentical: files, hashes: after, attempts: (await queue.get(queued.jobId))?.attempts,
    outputs: dir, humanReview: "NOT_REVIEWED", publication: "BLOCKED", at: new Date().toISOString() };
  await fs.writeFile("docs/evidence/acs-crash-resume.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
