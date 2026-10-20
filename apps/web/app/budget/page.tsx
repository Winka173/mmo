import { BudgetRouter, costPerPublishedPost } from "@ttm/governance";
import { readJsonl } from "@ttm/storage";
import Msg from "../components/Msg";
import { saveBudget } from "../admin/actions";
import { getStore } from "../lib/data";

export const dynamic = "force-dynamic";

export default async function BudgetPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const store = await getStore();
  const s = await store.getSettings();
  const spend = await new BudgetRouter(store, [], () => store.getSettings()).spend();
  const month = new Date().toISOString().slice(0, 7);
  const cpp = await costPerPublishedPost(store, month);
  const { records } = await readJsonl<any>(store.p("costs", `${month}.jsonl`));
  const bar = (used: number, cap: number) => (cap > 0 ? Math.min(100, (used / cap) * 100) : used > 0 ? 100 : 0);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Ngân sách & chi phí</h1>
      <Msg msg={sp.msg} />
      <p className="text-sm text-slate-500">Claude Max / Claude Code là công cụ phát triển, KHÔNG phải API runtime miễn phí. Trần = 0 nghĩa là mọi gọi trả phí bị chặn; công cụ local (FFmpeg, eSpeak, Tesseract) luôn được ưu tiên.</p>
      <section className="grid gap-3 sm:grid-cols-4">
        {([["Ngày", spend.day, s.spend.dailyUsdCap], ["Tuần", spend.week, s.spend.weeklyUsdCap], ["Tháng", spend.month, s.budgets.monthlyUsdCap]] as const).map(([l, u, c]) => (
          <div key={l} className="card"><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-bold">${u.toFixed(4)} / ${c}</div><div className="mt-1 h-2 rounded bg-slate-200"><div className="h-2 rounded bg-amber-500" style={{ width: `${bar(u, c)}%` }} /></div></div>
        ))}
        <div className="card"><div className="text-xs text-slate-500">Chi phí / bài đã đăng (tháng)</div><div className="text-lg font-bold">{cpp.perPostUsd === null ? "chưa có bài" : `$${cpp.perPostUsd}`}</div><div className="text-xs">{cpp.published} bài · ${cpp.totalUsd.toFixed(4)}</div></div>
      </section>
      <form action={saveBudget} className="card grid gap-2 text-sm sm:grid-cols-3">
        <label className="label">Trần ngày ($)<input name="daily" type="number" step="0.01" min={0} defaultValue={s.spend.dailyUsdCap} className="input" /></label>
        <label className="label">Trần tuần ($)<input name="weekly" type="number" step="0.01" min={0} defaultValue={s.spend.weeklyUsdCap} className="input" /></label>
        <label className="label">Trần tháng ($)<input name="monthly" type="number" step="0.01" min={0} defaultValue={s.budgets.monthlyUsdCap} className="input" /></label>
        <label className="label">Trần mỗi video ($)<input name="perVideo" type="number" step="0.01" min={0} defaultValue={s.budgets.perVideoUsdCap} className="input" /></label>
        <label className="label sm:col-span-2">Provider trả phí được phép (phẩy)<input name="allow" defaultValue={s.spend.paidProviderAllowlist.join(", ")} className="input" /></label>
        <button className="btn">Lưu</button>
      </form>
      <section className="card"><h2 className="h2">Sổ chi phí tháng {month}</h2>
        <table><thead><tr><th>Thời điểm</th><th>Provider</th><th>Loại</th><th>USD</th><th>Ước tính?</th><th>Dự án</th></tr></thead><tbody>{records.slice(-50).reverse().map((r, i) => <tr key={i}><td className="text-xs">{r.at}</td><td>{r.provider}</td><td>{r.kind ?? r.category ?? ""}</td><td>{Number(r.usd).toFixed(4)}</td><td>{r.estimated ? "ước tính" : "thực tế"}</td><td className="text-xs">{r.projectId ?? ""}</td></tr>)}</tbody></table>
        {!records.length && <p className="text-sm text-slate-500">Chưa có chi phí trả phí nào trong tháng.</p>}
      </section>
    </div>
  );
}
