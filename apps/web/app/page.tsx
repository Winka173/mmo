import Link from "next/link";
import { STATUS_VI, getQueue, getStore } from "./lib/data";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const store = await getStore();
  const q = await getQueue();
  const [settings, counts, projects] = await Promise.all([store.getSettings(), q.counts(), store.listProjects()]);
  const rows = await Promise.all(projects.map(async (p) => ({ p, pubs: await store.getPublications(p.id) })));
  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-4">
        <div className="card"><div className="text-xs text-slate-500">Kill switch</div><div className="text-lg font-bold">{settings.killSwitch ? "BẬT" : "Tắt"}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Đăng ra ngoài</div><div className="text-lg font-bold">{settings.externalPostingEnabled ? "BẬT" : "Tắt (an toàn)"}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Chờ duyệt / thủ công</div><div className="text-lg font-bold">{counts.needs_review} / {counts.manual_action}</div></div>
        <div className="card"><div className="text-xs text-slate-500">Đang chờ / chạy</div><div className="text-lg font-bold">{counts.queued} / {counts.running}</div></div>
      </section>
      <section className="card overflow-x-auto">
        <h2 className="mb-2 font-semibold">Dự án</h2>
        <table>
          <thead><tr><th>Tiêu đề</th><th>Loại</th><th>Chế độ</th><th>Trạng thái</th><th>Nền tảng</th></tr></thead>
          <tbody>
            {rows.map(({ p, pubs }) => (
              <tr key={p.id}>
                <td><Link className="text-amber-700 underline dark:text-amber-400" href={`/projects/${p.id}`}>{p.title}</Link></td>
                <td className="text-xs">{p.contentType}</td>
                <td><span className={`badge ${p.mode === "demo" ? "bg-slate-200 dark:bg-slate-700" : "bg-emerald-100 text-emerald-800"}`}>{p.mode}</span></td>
                <td className="text-xs">{STATUS_VI[p.status] ?? p.status}</td>
                <td className="text-xs">{pubs.map((x) => `${x.platform}: ${x.state}`).join(" · ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="text-sm text-slate-500">Chưa có dự án. Chạy <code>pnpm e2e:offline</code> để tạo fixture.</p>}
      </section>
    </div>
  );
}
