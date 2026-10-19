import * as fs from "node:fs/promises";
import { notFound } from "next/navigation";
import { getStore } from "../../lib/data";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getStore();
  const project = await store.getProject(id).catch(() => null);
  if (!project) notFound();
  const [qa, pubs, claims, ledger] = await Promise.all([
    Promise.all(project.formats.map((f) => store.getQa(id, f))),
    store.getPublications(id),
    store.getClaims(id),
    fs.readFile(store.p("projects", id, "sources-ledger.md"), "utf8").catch(() => "Chưa có sổ nguồn."),
  ]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{project.title}</h1>
      <p className="text-sm text-slate-500">{project.contentType} · {project.mode} · {project.status} · rev {project.revision}</p>
      <div className="grid gap-6 md:grid-cols-2">
        {project.formats.map((f, i) => (
          <div key={f} className="card space-y-2">
            <h2 className="font-semibold">{f}</h2>
            {qa[i] ? (
              <>
                <video controls preload="metadata" className="max-h-[70vh] w-full rounded" src={`/api/media/${id}/${f}/${f}.mp4`} />
                <a className="btn inline-block" href={`/api/media/${id}/${f}/${f}.mp4?download=1`}>Tải MP4</a>{" "}
                <a className="btn-ghost inline-block" href={`/api/media/${id}/${f}/${f}.vi.srt?download=1`}>Tải SRT</a>
                <ul className="text-xs">
                  {qa[i]!.checks.map((c) => <li key={c.name}>{c.ok ? "✅" : "❌"} {c.name}: {c.detail}</li>)}
                </ul>
              </>
            ) : <p className="text-sm">Chưa render.</p>}
          </div>
        ))}
      </div>
      <section className="card">
        <h2 className="font-semibold">Xuất bản</h2>
        <ul className="text-sm">{pubs.map((p) => <li key={p.idempotencyKey}>{p.platform}: <b>{p.state}</b> {p.url ? <a className="underline" href={p.url}>{p.url}</a> : null} {p.lastError ? <span className="text-slate-500">— {p.lastError}</span> : null}</li>)}</ul>
      </section>
      <section className="card">
        <h2 className="font-semibold">Claims ({claims.length})</h2>
        <ul className="text-sm">{claims.map((c) => <li key={c.id}><b>{c.status}</b> — {c.text}</li>)}</ul>
      </section>
      <section className="card"><h2 className="font-semibold">Sổ nguồn & quyền</h2><pre className="whitespace-pre-wrap text-xs">{ledger}</pre></section>
    </div>
  );
}
