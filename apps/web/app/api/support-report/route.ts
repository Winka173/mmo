import os from "node:os";
import path from "node:path";
import * as fs from "node:fs/promises";
import { probeGpu, writeMediaArchive } from "@ttm/media";
import { StudioStore } from "@ttm/automation";
import { getQueue, getStore } from "../../lib/data";
export const dynamic = "force-dynamic";

const TAIL = 3_000_000;
const redact = (text: string) => {
  const home = os.homedir();
  return text.split(home).join("<HOME>").split(home.replaceAll("\\", "/")).join("<HOME>").split(path.basename(home)).join("<USER>")
    .replace(/(authorization|token|secret|password|api[-_]?key)(["']?\s*[:=]\s*["']?)[A-Za-z0-9._\-]{12,}/gi, "$1$2<REDACTED>");
};
async function tail(file: string) {
  try {
    const stat = await fs.stat(file); const handle = await fs.open(file, "r");
    const size = Math.min(stat.size, TAIL); const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, stat.size - size); await handle.close();
    return buffer.toString("utf8");
  } catch { return null; }
}

/** One zip for bug reports: machine facts, redacted config, failed jobs and log tails. No prompts, media or credentials. */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== `http://${request.headers.get("host")}`) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const store = await getStore(); const studio = new StudioStore(store);
  const [gpu, config, failed] = await Promise.all([probeGpu({ verifyNvenc: false }), studio.config(), getQueue().then((q) => q.list("failed")).catch(() => [])]);
  const facts = {
    createdAt: new Date().toISOString(), os: `${os.platform()} ${os.release()}`, node: process.version,
    ramGb: { total: Math.round(os.totalmem() / 2 ** 30), free: Math.round((os.freemem() / 2 ** 30) * 10) / 10 },
    gpu: { available: gpu.available, name: gpu.name, vramTotalMb: gpu.vramTotalMb, vramUsedMb: gpu.vramUsedMb, driver: gpu.driver },
  };
  const jobs = failed.slice(0, 100).map((j: any) => ({ id: j.id, kind: j.kind, attempts: j.attempts, error: String(j.error ?? "").slice(0, 800), updatedAt: j.updatedAt ?? null }));
  const entries: { name: string; data: Buffer }[] = [
    { name: "README.txt", data: Buffer.from("ACS support report. Contains machine facts, the (redacted) configuration, failed jobs and log tails. Prompts, media and credentials are not included.\n") },
    { name: "system.json", data: Buffer.from(redact(JSON.stringify(facts, null, 2))) },
    { name: "config.json", data: Buffer.from(redact(JSON.stringify(config, null, 2))) },
    { name: "failed-jobs.json", data: Buffer.from(redact(JSON.stringify(jobs, null, 2))) },
  ];
  for (const [name, file] of [["logs/managed-llm.log", store.p("state", "managed-llm.log")], ["logs/worker.log", store.p("state", "worker.log")]] as const) {
    const content = await tail(file); if (content) entries.push({ name, data: Buffer.from(redact(content)) });
  }
  const dir = store.p("exports", "support"); await fs.mkdir(dir, { recursive: true });
  const name = `ACS-report-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
  await writeMediaArchive(path.join(dir, name), dir, entries);
  const stat = await fs.stat(path.join(dir, name));
  return Response.json({ name, path: path.join(dir, name), bytes: stat.size });
}

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name") ?? "";
  if (!/^ACS-report-[0-9TZ-]+\.zip$/.test(name)) return Response.json({ error: "Unknown report" }, { status: 404 });
  const store = await getStore(); const file = store.p("exports", "support", name);
  try { return new Response(await fs.readFile(file), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${name}"` } }); }
  catch { return Response.json({ error: "Report not found" }, { status: 404 }); }
}
