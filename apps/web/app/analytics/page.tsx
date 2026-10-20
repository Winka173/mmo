import * as fs from "node:fs/promises";
import { AnalyticsStore, SelfLearningEngine } from "@ttm/insights";
import Msg from "../components/Msg";
import { undoLearning } from "../admin/actions";
import { getStore } from "../lib/data";

export const dynamic = "force-dynamic";
const readJ = (f: string) => fs.readFile(f, "utf8").then((s) => JSON.parse(s), () => null);

/** Analytics & content lessons — unknown is shown as "?", never 0; fixtures excluded unless asked. */
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const store = await getStore();
  const a = new AnalyticsStore(store);
  const fixtures = sp.fixtures === "1";
  const agg: any = await a.rebuildAggregates({ includeFixtures: fixtures });
  const latest = (await a.latest({ includeFixtures: fixtures })).slice(-40);
  const rev = await a.revenueSummary({ includeFixtures: fixtures });
  const lessons = await readJ(store.p("learning", "lessons.json"));
  const hyp = await readJ(store.p("learning", "hypotheses.json"));
  const learned = await new SelfLearningEngine(store).getLearned();
  const v = (x: number | null) => (x === null ? "?" : x.toLocaleString("vi-VN"));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Phân tích & bài học</h1>
      <Msg msg={sp.msg} />
      <p className="text-sm text-slate-500">“?” = không có dữ liệu (không phải 0). {fixtures ? "Đang HIỂN THỊ cả dữ liệu fixture (nhãn rõ)." : <a className="underline" href="?fixtures=1">Xem cả dữ liệu fixture</a>}</p>
      <section className="grid gap-3 sm:grid-cols-3">
        {Object.entries(agg.byPlatform).map(([p, x]: any) => <div key={p} className="card text-sm"><b>{p}</b><div>Bài có số liệu 7 ngày: {x.posts}</div><div>Lượt xem: {v(x.views7d.value)} <span className="text-xs text-slate-500">({x.views7d.known} biết / {x.views7d.unknown} chưa biết)</span></div><div>Click: {v(x.clicks7d.value)}</div></div>)}
        <div className="card text-sm"><b>Affiliate</b><div>Net (approved+paid): {rev.known ? `${rev.net.toLocaleString("vi-VN")} ${rev.currency}` : "KHÔNG RÕ"}</div><div>Pending: {rev.known ? rev.pending.toLocaleString("vi-VN") : "?"} · hủy/hoàn: {rev.cancelled + rev.refunded}</div><div className="text-xs text-slate-500">{rev.note}</div></div>
      </section>
      <section className="card overflow-x-auto"><h2 className="h2">Snapshot gần nhất</h2>
        <table><thead><tr><th>Dự án</th><th>Nền tảng</th><th>Cửa sổ</th><th>Xem</th><th>Hoàn thành</th><th>Click</th><th>Nguồn</th><th>Cập nhật</th></tr></thead>
          <tbody>{latest.map((s) => <tr key={s.id}><td className="text-xs">{s.projectId}</td><td>{s.platform}</td><td>{s.window}</td><td>{v(s.views)}</td><td>{s.completionRate === null ? "?" : `${Math.round(s.completionRate * 100)}%`}</td><td>{v(s.clicks)}</td><td>{s.source}{s.isFixture ? " (fixture)" : ""}</td><td className="text-xs">{s.sourceUpdatedAt ?? s.capturedAt}</td></tr>)}</tbody></table>
        {!latest.length && <p className="text-sm text-slate-500">Chưa có số liệu. Nhập CSV: <code>factory analytics-import file.csv</code> hoặc kết nối API có quyền đọc số liệu.</p>}
      </section>
      <section className="card"><h2 className="h2">Bài học (quan sát — không phải nhân quả)</h2>
        <ul className="text-sm">{(lessons?.lessons ?? []).map((l: any) => <li key={l.id}><b>{l.status}</b> · {l.statement} · CI95 {l.ci95Pct[0]}%..{l.ci95Pct[1]}% · p={l.p} · n={l.nBucket}/{l.nOther}</li>)}</ul>
        {(lessons?.skipped ?? []).map((s: string) => <p key={s} className="text-xs text-slate-500">• {s}</p>)}
        <h3 className="mt-2 font-semibold">Đề xuất</h3>
        <ul className="text-sm">{(hyp?.proposals ?? []).map((p: any) => <li key={p.id}>[{p.status}] {p.change} — {p.uncertainty}; hoàn tác: {p.rollbackPlan}</li>)}</ul>
        <h3 className="mt-2 font-semibold">Thiết lập đã học (v{learned.version})</h3>
        <pre className="text-xs">{JSON.stringify(learned.cadence, null, 1)}</pre>
        <ul className="text-xs">{learned.history.slice(-5).map((h) => <li key={h.version}>v{h.version} {h.at.slice(0, 16)} {h.change} ({h.by})</li>)}</ul>
        <form action={undoLearning}><button className="btn-ghost">↶ Hoàn tác thay đổi đã học</button></form>
      </section>
    </div>
  );
}
