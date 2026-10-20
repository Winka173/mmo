import * as fs from "node:fs/promises";
import { SourceLicenseRegistry, BudgetRouter } from "@ttm/governance";
import { probeGpu } from "@ttm/media";
import { freeDiskGb, readDataVersion, verifyDataDir } from "@ttm/storage";
import { getQueue, getStore } from "../lib/data";

export const dynamic = "force-dynamic";

/** OperationsDashboard: queue health, job traces, external action ledger, GPU, storage, rights, costs, time-to-publish. */
export default async function Ops() {
  const store = await getStore();
  const q = await getQueue();
  const [s, counts, free, gpu, verify, regs, spend, dv] = await Promise.all([store.getSettings(), q.counts(), freeDiskGb(store.root), probeGpu({ verifyNvenc: false }), verifyDataDir(store, { hashMedia: false }), new SourceLicenseRegistry(store).list(), new BudgetRouter(store, [], () => store.getSettings()).spend(), readDataVersion(store)]);
  const running = await q.list("running");
  const failed = (await q.list("failed")).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10);
  const stale = running.filter((j) => j.heartbeatAt && Date.now() - new Date(j.heartbeatAt).getTime() > 5 * 60_000);
  const ledger: { at: string; project: string; platform: string; state: string; url: string | null; account: string | null }[] = [];
  const ttp: number[] = [];
  for (const p of await store.listProjects())
    for (const pub of await store.getPublications(p.id)) {
      ledger.push({ at: pub.updatedAt, project: p.id, platform: pub.platform, state: pub.state, url: pub.url, account: pub.accountId });
      if (pub.state === "PUBLISHED" && pub.confirmedAt) ttp.push((new Date(pub.confirmedAt).getTime() - new Date(p.createdAt).getTime()) / 3600_000);
    }
  const sched = await fs.readFile(store.p("state", "schedules.json"), "utf8").then((x) => JSON.parse(x), () => ({}));
  const expiring = regs.filter((r) => r.status !== "ACTIVE" || (r.expiresAt && new Date(r.expiresAt).getTime() - Date.now() < 14 * 86400_000));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Vận hành</h1>
      <section className="grid gap-3 sm:grid-cols-4 text-sm">
        <div className="card"><b>Hàng đợi</b><div>{Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div><div className={stale.length ? "text-red-600" : ""}>{stale.length} job mất heartbeat</div></div>
        <div className="card"><b>Lưu trữ</b><div>Trống: {free === null ? "?" : `${free.toFixed(1)} GB`} (ngưỡng {s.minFreeDiskGb})</div><div>Dữ liệu v{dv} · {verify.ok ? "toàn vẹn OK" : `${verify.issues.length} vấn đề`}</div></div>
        <div className="card"><b>GPU</b><div>{gpu.available ? `${gpu.name} · VRAM ${gpu.vramUsedMb}/${gpu.vramTotalMb} MB · ${gpu.temperatureC ?? "?"}°C · tải ${gpu.utilizationPct ?? "?"}%` : gpu.detail}</div></div>
        <div className="card"><b>Chi phí</b><div>ngày ${spend.day.toFixed(4)} · tháng ${spend.month.toFixed(4)} / ${s.budgets.monthlyUsdCap}</div><div>Kill switch {s.killSwitch ? "BẬT" : "tắt"} · đăng ngoài {s.externalPostingEnabled ? "BẬT" : "tắt"}</div></div>
      </section>
      <section className="card text-sm"><b>Thời gian đến khi đăng:</b> {ttp.length ? `trung vị ${ttp.sort((a, b) => a - b)[Math.floor(ttp.length / 2)].toFixed(1)} giờ (${ttp.length} bài)` : "chưa có bài đăng xác nhận"} · <b>Lịch:</b> {Object.entries(sched).map(([k, v]: any) => `${k} ${String(v?.lastSlot ?? v).slice(0, 16)}`).join("; ") || "chưa chạy"}</section>
      <section className="card"><h2 className="h2">Cảnh báo quyền ({expiring.length})</h2><ul className="text-xs">{expiring.map((r) => <li key={r.assetKey}>{r.status} · {r.assetKey} · hết hạn {r.expiresAt ?? "—"} {r.statusReason ?? ""}</li>)}</ul></section>
      <section className="card overflow-x-auto"><h2 className="h2">Sổ hành động bên ngoài (đăng bài)</h2>
        <table><thead><tr><th>Lúc</th><th>Dự án</th><th>Nền tảng</th><th>Tài khoản</th><th>Trạng thái</th><th>URL</th></tr></thead><tbody>{ledger.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30).map((l, i) => <tr key={i}><td className="text-xs">{l.at.slice(0, 16)}</td><td className="text-xs">{l.project}</td><td>{l.platform}</td><td className="text-xs">{l.account ?? "—"}</td><td>{l.state}</td><td className="text-xs">{l.url ?? ""}</td></tr>)}</tbody></table>
      </section>
      <section className="card"><h2 className="h2">Job lỗi gần đây (trace)</h2>
        {failed.map((j) => <details key={j.id} className="text-xs"><summary>{j.kind} {j.id} — {j.lastError?.errorCode}: {j.lastError?.message.slice(0, 120)}</summary><ol className="ml-4 list-decimal">{j.history.map((h, i) => <li key={i}>{h.at.slice(0, 19)} {h.from ?? "∅"} → {h.to}: {h.note}</li>)}</ol><p>Bước tiếp: {j.lastError?.nextAction} {j.lastError?.manualFallback ? `· thủ công: ${j.lastError.manualFallback}` : ""}</p></details>)}
        {!failed.length && <p className="text-sm text-slate-500">Không có.</p>}
      </section>
    </div>
  );
}
