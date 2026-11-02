import os from "node:os";
import * as fs from "node:fs/promises";
import { probeGpu } from "@ttm/media";
import { getStore } from "../../lib/data";
export const dynamic = "force-dynamic";
/** Live machine facts for the top-bar chips: whole-device VRAM (so a game counts), RAM and the data drive. Read-only. */
export async function GET() {
  const store = await getStore();
  const [gpu, disk] = await Promise.all([probeGpu({ verifyNvenc: false }), fs.statfs(store.root).catch(() => null)]);
  const gib = (n: number) => Math.round((n / 2 ** 30) * 10) / 10;
  return Response.json({
    gpu: { available: gpu.available, name: gpu.name, vramTotalMb: gpu.vramTotalMb, vramUsedMb: gpu.vramUsedMb, utilizationPct: gpu.utilizationPct, temperatureC: gpu.temperatureC },
    ram: { totalGb: gib(os.totalmem()), freeGb: gib(os.freemem()) },
    disk: disk ? { totalGb: gib(disk.blocks * disk.bsize), freeGb: gib(disk.bavail * disk.bsize) } : null,
    sampledAt: new Date().toISOString(),
  });
}
