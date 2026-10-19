import { approveJob, rejectJob } from "../actions";
import { getQueue } from "../lib/data";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const q = await getQueue();
  const states = ["needs_review", "manual_action", "queued", "running", "failed"] as const;
  const lists = await Promise.all(states.map((s) => q.list(s)));
  return (
    <div className="space-y-6">
      {states.map((s, i) => (
        <section key={s} className="card overflow-x-auto">
          <h2 className="mb-2 font-semibold">{s} ({lists[i].length})</h2>
          <table>
            <tbody>
              {lists[i].map((j) => (
                <tr key={j.id}>
                  <td className="font-mono text-xs">{j.id}</td>
                  <td className="text-xs">{j.kind} {String(j.payload.projectId ?? "")} {String(j.payload.platform ?? "")}</td>
                  <td className="text-xs text-slate-500">{j.lastError ? `${j.lastError.errorCode}: ${j.lastError.message}` : ""}{j.lastError?.manualFallback ? ` → ${j.lastError.manualFallback}` : ""}</td>
                  <td className="whitespace-nowrap">
                    {s === "needs_review" && <form action={approveJob.bind(null, j.id)} className="inline"><button className="btn">Duyệt</button></form>}{" "}
                    {(s === "needs_review" || s === "manual_action") && <form action={rejectJob.bind(null, j.id)} className="inline"><button className="btn-ghost">Từ chối</button></form>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <p className="text-xs text-slate-500">Duyệt chỉ là quyết định biên tập: worker vẫn kiểm tra lại quyền, nguồn, affiliate và kill switch trước khi đăng.</p>
    </div>
  );
}
