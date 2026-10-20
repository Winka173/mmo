import * as fs from "node:fs/promises";
import Link from "next/link";
import { approveJob, rejectJob } from "../actions";
import { getGames, getQueue, getStore } from "../lib/data";

export const dynamic = "force-dynamic";

/** Review Queue: every held item with the reasons it is held (click to inspect provenance). */
export default async function ReviewQueue() {
  const store = await getStore();
  const q = await getQueue();
  const games = await getGames();
  const held = [...(await q.list("needs_review")), ...(await q.list("manual_action"))].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const rows = await Promise.all(
    held.map(async (j) => {
      const projectId = String(j.payload.projectId ?? "");
      const project = projectId ? await store.getProject(projectId) : null;
      const gates = await fs.readFile(store.p("projects", projectId || "_", "gates.json"), "utf8").then((s) => JSON.parse(s).gates, () => null);
      const fmt = String(j.payload.format ?? project?.formats[0] ?? "short_9x16");
      const thumb = (await fs.stat(store.p("projects", projectId || "_", "renders", fmt, `${fmt}.thumbnail.jpg`)).catch(() => null)) ? `${fmt}.thumbnail.jpg` : `${fmt}.thumbnail.png`;
      const gameVideo = project?.gameId ? await games.getVideo(project.gameId, projectId) : null;
      return { j, project, gates, fmt, thumb, gameVideo };
    }),
  );
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Hàng chờ duyệt ({rows.length})</h1>
      <p className="text-sm text-slate-500">Duyệt chỉ là quyết định biên tập — không vượt qua cổng quyền/fact/game. Mọi cổng được kiểm tra lại ngay trước khi đăng; thay đổi thumbnail/asset sau khi duyệt sẽ hủy duyệt.</p>
      {rows.map(({ j, project, gates, fmt, thumb, gameVideo }) => (
        <div key={j.id} className="card flex flex-col gap-3 sm:flex-row">
          {project && <img src={`/api/media/${project.id}/${fmt}/${thumb}`} alt="" className="h-28 w-auto rounded object-cover" />}
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-semibold">{project?.title ?? j.kind} → {String(j.payload.platform ?? "")}{project?.gameId ? <span className="badge ml-2 bg-indigo-100 text-indigo-800">game: {project.gameId}</span> : null}{project?.mode === "demo" && <span className="badge ml-2 bg-slate-200">demo</span>}</div>
            <div className="text-xs text-slate-500">Job {j.id} · {j.state} · {j.lastError?.errorCode}</div>
            <p className="text-xs">{j.lastError?.message}</p>
            {gates && <ul className="text-xs">{Object.entries(gates).map(([k, g]: any) => <li key={k}>{g.ok ? "✅" : "⛔"} {k}{g.reasons?.length ? `: ${g.reasons.slice(0, 3).join("; ")}` : ""}</li>)}</ul>}
            <div className="mt-1 flex gap-2 text-xs">
              {project && <Link className="underline" href={project.gameId && gameVideo ? `/games/${project.gameId}/videos/${project.id}` : `/projects/${project.id}`}>Xem chi tiết & nguồn gốc</Link>}
              {project && <Link className="underline" href={`/inspect/${project.id}`}>Bằng chứng / độ trùng / quyền</Link>}
            </div>
          </div>
          <div className="flex gap-2 self-start">
            {j.state === "needs_review" && <form action={approveJob.bind(null, j.id)}><button className="btn">Duyệt</button></form>}
            <form action={rejectJob.bind(null, j.id)}><button className="btn-ghost">Từ chối</button></form>
          </div>
        </div>
      ))}
    </div>
  );
}
