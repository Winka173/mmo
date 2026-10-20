import { ABTestingEngine } from "@ttm/insights";
import Msg from "../components/Msg";
import { createExperiment } from "../admin/actions";
import { getStore } from "../lib/data";

export const dynamic = "force-dynamic";

export default async function Experiments({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const list = await new ABTestingEngine(await getStore()).list();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Thử nghiệm A/B</h1>
      <Msg msg={sp.msg} />
      <p className="text-sm text-slate-500">Không đăng hai video gần như giống nhau cùng lúc lên một kênh. Thumbnail: ưu tiên “Test &amp; compare” của YouTube Studio (thao tác thủ công). Thiết kế theo thời gian chỉ cho tương quan, không chứng minh nhân quả. Thiếu số liệu ⇒ không kết luận.</p>
      <table className="card"><thead><tr><th>ID</th><th>Biến</th><th>Thiết kế</th><th>Chỉ số</th><th>Trạng thái</th><th>Kết quả</th></tr></thead>
        <tbody>{list.map((e) => <tr key={e.id}><td>{e.id}</td><td>{e.variable}</td><td>{e.design}</td><td>{e.primaryMetric}</td><td>{e.status}</td><td className="text-xs">{e.result ? `${e.result.verdict}: ${e.result.detail}` : "—"}</td></tr>)}</tbody></table>
      <form action={createExperiment} className="card grid gap-2 text-sm sm:grid-cols-3">
        <label className="label">ID<input name="id" required pattern="[a-z0-9-]{3,60}" className="input" /></label>
        <label className="label sm:col-span-2">Giả thuyết<input name="hypothesis" required minLength={10} className="input" /></label>
        <label className="label">Biến<select name="variable" className="input">{["title", "thumbnail", "hook", "cta", "length", "narration", "posting_slot"].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="label">Thiết kế<select name="design" className="input"><option value="platform_native">platform_native (ngẫu nhiên của nền tảng)</option><option value="temporal_matched">temporal_matched</option><option value="sequential_series">sequential_series</option></select></label>
        <label className="label">Chỉ số chính<select name="metric" className="input">{["ctr", "views_7d", "avg_view_duration", "completion_rate", "clicks"].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="label">Nền tảng<input name="platform" defaultValue="youtube_long" className="input" /></label>
        <label className="label">Chủ sở hữu (brand/gameId)<input name="owner" defaultValue="tutomo" className="input" /></label>
        <label className="label">Mẫu tối thiểu/nhánh<input name="minSample" type="number" defaultValue={8} className="input" /></label>
        <label className="label">Nhánh A<input name="armA" required className="input" /></label><label className="label">Nhánh B<input name="armB" required className="input" /></label>
        <div className="text-xs"><label><input type="checkbox" name="sameFeed" /> đăng cùng lúc trên cùng kênh</label><br /><label><input type="checkbox" name="affiliate" /> nội dung affiliate</label></div>
        <button className="btn">Tạo thử nghiệm</button>
      </form>
    </div>
  );
}
