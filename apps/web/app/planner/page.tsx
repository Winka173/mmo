import * as fs from "node:fs/promises";
import { schedulePreview } from "@ttm/games";
import { getStore } from "../lib/data";

export const dynamic = "force-dynamic";

/** Daily Planner: schedule preview (cadence, holidays, lineage spacing) + opportunity radar. */
export default async function Planner() {
  const store = await getStore();
  const plan = await schedulePreview(store);
  const opp = await fs.readFile(store.p("discovery", "opportunities.json"), "utf8").then((s) => JSON.parse(s), () => null);
  const local = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().replace("T", " ").slice(0, 16);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Kế hoạch đăng & cơ hội</h1>
      <section className="card"><h2 className="h2">Lịch đề xuất (giờ Việt Nam)</h2>
        <ul className="text-sm">{plan.assigned.map((a) => <li key={a.itemId}>{local(a.at)} · {a.itemId} — {a.reason}</li>)}</ul>
        <ul className="text-xs text-amber-700">{plan.deferred.map((d) => <li key={d.itemId}>Hoãn {d.itemId}: {d.reason}</li>)}</ul>
        {!plan.assigned.length && !plan.deferred.length && <p className="text-sm text-slate-500">Chưa có video live nào sẵn sàng.</p>}
      </section>
      <section className="card"><h2 className="h2">Opportunity Radar</h2>
        {opp ? <ul className="space-y-2 text-sm">{opp.items.map((o: any) => <li key={o.id}><b>{o.score}</b> · {o.title} · <i>{o.action}</i> · tăng trưởng: {o.growthLabel}<div className="text-xs text-slate-500">{o.attribution}</div><div className="text-xs">{o.notes.join(" · ")}</div><div className="text-xs">Góc mới: {o.angles.slice(0, 2).join(" | ")}</div></li>)}</ul> : <p className="text-sm text-slate-500">Chạy <code>factory trends</code> (hoặc chờ lịch 07:20) sau khi có ứng viên discovery.</p>}
      </section>
    </div>
  );
}
