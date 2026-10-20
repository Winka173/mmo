import * as fs from "node:fs/promises";
import { OriginalityEngine } from "@ttm/discovery";
import { SourceLicenseRegistry } from "@ttm/governance";
import { notFound } from "next/navigation";
import Msg from "../../components/Msg";
import { getStore } from "../../lib/data";
import { overrideOriginality } from "../actions";

export const dynamic = "force-dynamic";

const readJ = (f: string) => fs.readFile(f, "utf8").then((s) => JSON.parse(s), () => null);

/** Evidence / Fact inspector + Originality/Duplicate inspector + Rights chain + Quality Judge report. */
export default async function Inspector({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const store = await getStore();
  const project = await store.getProject(id).catch(() => null);
  if (!project) notFound();
  const [claims, factCheck, citations, orig, rights, judges] = await Promise.all([
    store.getClaims(id),
    readJ(store.p("projects", id, "fact-check.json")),
    fs.readFile(store.p("projects", id, "citations.md"), "utf8").catch(() => null),
    new OriginalityEngine(store).read(id),
    store.getRights(id),
    Promise.all(project.formats.map(async (f) => ({ f, j: await readJ(store.p("projects", id, "renders", f, "judge-report.json")), r: await readJ(store.p("projects", id, "renders", f, "repair-log.json")) }))),
  ]);
  const reg = new SourceLicenseRegistry(store);
  const chains = await Promise.all([...(rights?.assets ?? []), ...(rights?.music ?? [])].map(async (a) => ({ a, events: await reg.events(a.hash ?? `${id}/${a.assetId}`) })));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Kiểm tra: {project.title}</h1>
      <Msg msg={sp.msg} />

      <section className="card space-y-2">
        <h2 className="h2">Bằng chứng & claim ({claims.length})</h2>
        {claims.map((c) => {
          const fc = factCheck?.claims?.find((x: any) => x.id === c.id);
          return (
            <div key={c.id} className="rounded border border-slate-200 p-2 text-sm dark:border-slate-700">
              <div><b className={c.status === "VERIFIED" ? "text-emerald-600" : c.status === "CONTRADICTED" ? "text-red-600" : "text-amber-600"}>{c.status}</b> · rủi ro {c.riskTier} · {c.topic} · kiểm tra: {c.checkedAt ?? "chưa"}</div>
              <p>{c.text}</p>
              {c.contradictionNotes.length > 0 && <p className="text-xs text-red-600">Mâu thuẫn: {c.contradictionNotes.join("; ")}</p>}
              <ul className="text-xs">{c.sources.map((s) => <li key={s.url}>[{s.tier}] {s.publisher}: <a className="underline" href={s.url}>{s.title}</a> — {s.fetchedAt ? `truy xuất ${s.fetchedAt.slice(0, 16)}` : "CHƯA truy xuất"}{s.excerpt ? <blockquote className="ml-3 border-l pl-2 text-slate-500">{s.excerpt}</blockquote> : null}</li>)}</ul>
              {fc && <p className="text-xs text-slate-500">Lần kiểm gần nhất: {fc.outcome} · độc lập: {fc.independent.domains.join(", ") || "—"} · {fc.reasons.join("; ")}</p>}
            </div>
          );
        })}
        {citations && <details><summary className="cursor-pointer text-xs">Trích dẫn xuất ra (citations.md)</summary><pre className="whitespace-pre-wrap text-xs">{citations}</pre></details>}
      </section>

      <section className="card space-y-2">
        <h2 className="h2">Độ trùng / độc đáo</h2>
        {orig ? (
          <>
            <p className="text-sm">Quyết định: <b>{orig.decision}</b> · novelty {orig.novelty} · so với {orig.checkedAgainst} mục · {orig.override ? `đã bỏ qua bởi ${orig.override.by}: ${orig.override.reason}` : ""}</p>
            <ul className="text-xs">{orig.reasons.map((r) => <li key={r}>• {r}</li>)}</ul>
            <table><thead><tr><th>So với</th><th>Loại</th><th>Mức</th><th>Điểm</th><th>Bằng chứng</th></tr></thead><tbody>{orig.matches.slice(0, 20).map((m, i) => <tr key={i}><td className="font-mono text-xs">{m.against}</td><td>{m.againstKind}</td><td>{m.level}</td><td>{m.score}</td><td className="text-xs">{m.evidence}</td></tr>)}</tbody></table>
            <p className="text-xs text-slate-500">{orig.rightsNote} {orig.limitation}</p>
            {orig.decision === "NEEDS_REVIEW" && !orig.override && (
              <form action={overrideOriginality.bind(null, id)} className="flex gap-2 text-sm"><input name="reason" required minLength={10} className="input" placeholder="Lý do cụ thể: góc nhìn mới / dữ liệu mới / hình tự quay…" /><button className="btn-ghost">Xác nhận không trùng (ghi audit)</button></form>
            )}
          </>
        ) : <p className="text-sm text-slate-500">Chưa có báo cáo (tạo khi dựng video).</p>}
      </section>

      <section className="card space-y-2">
        <h2 className="h2">Quyền & chuỗi nguồn gốc</h2>
        {chains.map(({ a, events }) => (
          <div key={a.assetId} className="text-xs">
            <b>{a.assetId}</b> · {a.ownershipType} · {a.licenseId ?? "—"} · <b>{a.status}</b>{a.expiresAt ? ` · hết hạn ${a.expiresAt.slice(0, 10)}` : ""}
            <ol className="ml-4 list-decimal">{events.map((e) => <li key={e.key}>{e.type} {e.projectId ?? ""} <span className="text-slate-500">{JSON.stringify(e.detail).slice(0, 140)}</span></li>)}</ol>
          </div>
        ))}
        {rights?.voice && <p className="text-xs">Giọng đọc: {rights.voice.engine}/{rights.voice.voice} — {rights.voice.license}</p>}
      </section>

      <section className="card space-y-2">
        <h2 className="h2">Quality Judge</h2>
        {judges.map(({ f, j, r }) => j ? (
          <div key={f} className="text-xs">
            <p className="text-sm"><b>{f}</b>: {j.verdict} · điểm biên tập {j.editorialScore}/100 · {j.sampledFrames} khung lấy mẫu · {j.premium.note}</p>
            <ul>{j.hard.map((h: any) => <li key={h.code}>{h.ok ? "✅" : "❌"} {h.code}: {h.detail} {h.evidence.map((e: any) => `[${e.t ?? "-"}s ${e.note}]`).join(" ")}</li>)}</ul>
            <ul className="mt-1">{j.soft.map((s: any) => <li key={s.name}>{s.score}/100 · {s.name} — {s.explanation}</li>)}</ul>
            {r && <p className="mt-1">Tự sửa: {r.status} {r.reason ?? ""} · {r.log.map((l: any) => `v${l.iteration + 1}: ${l.actions.map((a: any) => a.action).join("+") || "—"}`).join(" → ")}</p>}
            <p className="text-slate-500">{j.disclaimer}</p>
          </div>
        ) : <p key={f} className="text-xs text-slate-500">{f}: chưa có báo cáo judge.</p>)}
      </section>
    </div>
  );
}
