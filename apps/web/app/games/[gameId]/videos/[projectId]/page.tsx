import * as fs from "node:fs/promises";
import { Platform } from "@ttm/core";
import { gameReadiness, isApprovalValid } from "@ttm/games";
import Link from "next/link";
import { notFound } from "next/navigation";
import ClipEditor from "../../../../components/ClipEditor";
import Msg from "../../../../components/Msg";
import { KIND_VI, gameMediaUrl, getAccounts, getGames, getStore } from "../../../../lib/data";
import { analyzeVideo, approveVideo, renderVideo, saveVideo, undoVideo } from "../../../actions";

export const dynamic = "force-dynamic";

const TYPES = ["GAMEPLAY_HIGHLIGHT", "GAME_DEVLOG", "GAME_TRAILER", "GAME_TEASER", "GAME_MECHANIC", "GAME_CHARACTER", "GAME_UNIT", "GAME_VEHICLE", "GAME_TACTIC", "GAME_CRAFTING", "GAME_ART_SHOWCASE", "GAME_PATCH_UPDATE", "GAME_ANNOUNCEMENT", "GAME_TUTORIAL", "GAME_COMPARISON", "GAME_LAUNCH", "GAME_SHORT", "GAME_LONG"];
const PLATFORM_VI: Record<string, string> = { youtube_shorts: "YouTube Shorts", youtube_long: "YouTube (dài 16:9)", facebook: "Facebook Reels", instagram: "Instagram Reels", tiktok: "TikTok" };
/** Approximate platform UI overlays on a 9:16 frame (percent) — preview only, re-check in the official app. */
const SAFE: Record<string, { top: number; bottom: number; right: number }> = { tiktok: { top: 9, bottom: 22, right: 14 }, youtube_shorts: { top: 8, bottom: 20, right: 13 }, instagram: { top: 9, bottom: 21, right: 13 }, facebook: { top: 9, bottom: 21, right: 13 } };

const Issues = ({ title, items, tone }: { title: string; items: { message: string; code: string }[]; tone: string }) =>
  items.length ? (
    <div><div className={`text-xs font-semibold ${tone}`}>{title} ({items.length})</div><ul className="list-disc pl-5 text-xs">{items.map((i, k) => <li key={k}><code>{i.code}</code> {i.message}</li>)}</ul></div>
  ) : null;

/** Create Game Video wizard — game, gameplay clips + trims, thumbnail upload/lock, script, build, CTA, channels, preview. */
export default async function GameVideoWizard({ params, searchParams }: { params: Promise<{ gameId: string; projectId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { gameId, projectId } = await params;
  const sp = await searchParams;
  const games = await getGames();
  const store = await getStore();
  const v = await games.getVideo(gameId, projectId);
  if (!v) notFound();
  const r = await gameReadiness(store, gameId, projectId, { analyze: false });
  const { game, assets, readiness, footage } = r;
  const builds = await games.listBuilds(gameId);
  const accounts = (await (await getAccounts()).list()).filter((a) => a.owner.kind === "game" && a.owner.id === gameId && game.destinationAllowlist.includes(a.id));
  const approval = await isApprovalValid(store, gameId, projectId);
  const videos = assets.filter((a) => a.video && ["gameplay", "trailer", "ai_concept"].includes(a.kind));
  const images = assets.filter((a) => a.image);
  const clipAssets = videos.map((a) => ({ assetId: a.assetId, name: a.originalName, url: gameMediaUrl(a.proxyPath ?? a.path), duration: a.video!.durationSec, label: KIND_VI[a.kind] + (a.buildId ? ` · ${a.buildId}` : ""), heroTimes: (footage[a.assetId]?.highlights ?? []).slice(0, 4).map((h) => h.in) }));
  const initialClips = v.clips.map((c, i) => ({ ...c, narration: v.narration[i] ?? "" }));
  const renders = await Promise.all(
    (["short_9x16", "long_16x9"] as const).map(async (f) => {
      const dir = store.p("projects", projectId, "renders", f);
      const has = await fs.stat(`${dir}/${f}.mp4`).catch(() => null);
      const thumbs = await fs.readFile(`${dir}/thumbnails.json`, "utf8").then((s) => JSON.parse(s), () => null);
      const srt = await fs.readFile(`${dir}/${f}.vi.srt`, "utf8").catch(() => "");
      const qa = await store.getQa(projectId, f);
      return { f, has: !!has, thumbs, srt, qa, t: has?.mtimeMs ?? 0 };
    }),
  );
  const jobQ = (await store.getProject(projectId))?.status;
  const save = saveVideo.bind(null, gameId, projectId);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs"><Link className="underline" href="/games">Thư viện game</Link> / <Link className="underline" href={`/games/${gameId}`}>{game.publicTitle}</Link></p>
          <h1 className="text-2xl font-bold">{v.title}</h1>
          <p className="text-xs text-slate-500">{projectId} · rev {v.revision} · {v.status} · dự án: {jobQ ?? "chưa dựng"} · duyệt: {approval.ok ? "✅ hợp lệ" : `⛔ ${approval.reason}`}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={undoVideo.bind(null, gameId, projectId)}><button className="btn-ghost">↶ Hoàn tác lần sửa cuối</button></form>
          <form action={analyzeVideo.bind(null, gameId, projectId)}><button className="btn-ghost">Phân tích footage</button></form>
          <form action={renderVideo.bind(null, gameId, projectId)}><button className="btn" disabled={!readiness.renderable}>Dựng 9:16 / 16:9</button></form>
        </div>
      </div>
      <Msg msg={sp.msg} />

      <section className="card space-y-2" aria-live="polite">
        <h2 className="h2">Mức sẵn sàng: <span className={readiness.state === "READY" ? "text-emerald-600" : readiness.state === "HOLD_REVIEW" ? "text-amber-600" : "text-red-600"}>{readiness.state}</span> {readiness.renderable ? "· có thể dựng" : "· chưa dựng được"} {readiness.publishable ? "· có thể đăng sau khi duyệt" : "· chưa đăng được"}</h2>
        <Issues title="Thiếu" items={readiness.missing} tone="text-red-600" />
        <Issues title="Chặn dựng" items={readiness.renderBlockers} tone="text-red-600" />
        <Issues title="Chặn đăng" items={readiness.publishBlockers} tone="text-red-600" />
        <Issues title="Cần duyệt" items={readiness.requiresApproval} tone="text-amber-600" />
        <Issues title="Lưu ý" items={readiness.warnings} tone="text-slate-500" />
        <form action={approveVideo.bind(null, gameId, projectId)} className="flex items-center gap-3 text-sm">
          <label><input type="checkbox" name="roadmap" /> Duyệt việc nhắc tính năng roadmap (kèm “đang phát triển”)</label>
          <button className="btn-ghost" disabled={!renders.some((x) => x.has)}>Duyệt nội dung hiện tại</button>
        </form>
      </section>

      <form action={save} className="space-y-6">
        <section className="card grid gap-3 sm:grid-cols-2">
          <h2 className="h2 sm:col-span-2">1 · Loại video & mục tiêu</h2>
          <label className="label">Loại<select name="contentType" defaultValue={v.contentType} className="input">{TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="label">Tiêu đề *<input name="title" defaultValue={v.title} required className="input" /></label>
          <label className="label">Hook (1–3 giây đầu)<input name="hook" defaultValue={v.hook} className="input" /></label>
          <label className="label">Chủ đề / mô tả<input name="topic" defaultValue={v.topic} className="input" /></label>
          <fieldset className="text-sm"><legend className="label">Định dạng</legend>
            <label className="mr-3"><input type="checkbox" name="formats" value="short_9x16" defaultChecked={v.formats.includes("short_9x16")} /> Short 9:16 (1080×1920)</label>
            <label><input type="checkbox" name="formats" value="long_16x9" defaultChecked={v.formats.includes("long_16x9")} /> YouTube 16:9 (1920×1080)</label>
          </fieldset>
          <fieldset className="text-sm"><legend className="label">Nền tảng đích</legend>{Platform.options.map((p) => <label key={p} className="mr-3"><input type="checkbox" name="targets" value={p} defaultChecked={v.targets.includes(p)} /> {PLATFORM_VI[p]}</label>)}</fieldset>
          <label className="label">Ngôn ngữ<select name="language" defaultValue={v.language} className="input"><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label>
          <div className="flex flex-wrap gap-3 text-sm"><label><input type="checkbox" name="voice" defaultChecked={v.voice.enabled} /> Có lời đọc (TTS theo brand kit game)</label><label><input type="checkbox" name="keepGameAudio" defaultChecked={v.keepGameAudio} /> Giữ âm thanh game</label><label><input type="checkbox" name="allowConceptShots" defaultChecked={v.allowConceptShots} /> Cho phép cảnh concept/AI (luôn có nhãn)</label></div>
          <label className="label">Ưu tiên (1 cao – 9 thấp)<input type="number" name="priority" min={1} max={9} defaultValue={v.priority} className="input" /></label>
        </section>

        <section className="card space-y-2">
          <h2 className="h2">2 · Gameplay: chọn clip, cắt in/out, chú thích</h2>
          <ClipEditor assets={clipAssets} initial={initialClips} />
        </section>

        <section className="card grid gap-3 sm:grid-cols-2">
          <h2 className="h2 sm:col-span-2">3 · Ảnh, logo & thumbnail</h2>
          <fieldset className="sm:col-span-2 text-xs"><legend className="label">Ảnh chụp/key art đưa vào video</legend>
            <div className="flex flex-wrap gap-2">{images.filter((a) => !["logo", "thumbnail"].includes(a.kind)).map((a) => <label key={a.assetId} className="flex flex-col items-center"><img src={gameMediaUrl(a.path)} alt={a.originalName} className="h-16 w-24 rounded object-cover" /><span><input type="checkbox" name="screenshots" value={a.assetId} defaultChecked={v.screenshots.includes(a.assetId)} /> {KIND_VI[a.kind]}</span></label>)}</div>
          </fieldset>
          <label className="label">Logo<select name="logoAssetId" defaultValue={v.logoAssetId ?? ""} className="input"><option value="">(tự chọn logo đã tải / chữ nếu chưa có)</option>{images.filter((a) => a.kind === "logo").map((a) => <option key={a.assetId} value={a.assetId}>{a.originalName}</option>)}</select></label>
          <label className="label">Chế độ thumbnail<select name="thumbMode" defaultValue={v.thumbnail.mode} className="input"><option value="LOCK_USER_THUMBNAIL">LOCK_USER_THUMBNAIL — dùng đúng ảnh tôi tải</option><option value="AUTO_ENHANCE">AUTO_ENHANCE — tối ưu từ ảnh/khung của tôi</option><option value="GENERATE_CANDIDATES">GENERATE_CANDIDATES — tạo ≥3 phương án</option></select></label>
          <label className="label">Thumbnail 16:9 (YouTube)<select name="user16x9" defaultValue={v.thumbnail.user16x9 ?? ""} className="input"><option value="">(không — tự chọn khung gameplay)</option>{images.map((a) => <option key={a.assetId} value={a.assetId}>{a.originalName} · {a.image!.width}×{a.image!.height}</option>)}</select></label>
          <label className="label">Cover 9:16<select name="user9x16" defaultValue={v.thumbnail.user9x16 ?? ""} className="input"><option value="">(không — tự chọn)</option>{images.map((a) => <option key={a.assetId} value={a.assetId}>{a.originalName} · {a.image!.width}×{a.image!.height}</option>)}</select></label>
          <label className="label">Khung hero (clip)<select name="heroAsset" defaultValue={v.thumbnail.heroFrame?.assetId ?? ""} className="input"><option value="">(tự chọn khung nét nhất)</option>{videos.map((a) => <option key={a.assetId} value={a.assetId}>{a.originalName}</option>)}</select></label>
          <label className="label">Thời điểm hero (s)<input name="heroT" type="number" step="0.1" defaultValue={v.thumbnail.heroFrame?.t ?? ""} className="input" /></label>
          <label className="label sm:col-span-2">Chữ trên thumbnail (ngắn, ≤7 từ)<input name="textOverlay" defaultValue={v.thumbnail.textOverlay ?? ""} className="input" /></label>
          <label className="label">Nhạc (chỉ có license)<select name="musicAssetId" defaultValue={v.musicAssetId ?? ""} className="input"><option value="">(không dùng nhạc)</option>{assets.filter((a) => a.kind === "music").map((a) => <option key={a.assetId} value={a.assetId}>{a.originalName} · {a.rights.licenseId ?? "chưa có license"}</option>)}</select></label>
        </section>

        <section className="card grid gap-3 sm:grid-cols-2">
          <h2 className="h2 sm:col-span-2">4 · Kịch bản, build & CTA</h2>
          <label className="label sm:col-span-2">Ghi chú kịch bản<textarea name="scriptNotes" defaultValue={v.scriptNotes} rows={2} className="input" /></label>
          <label className="label">Build<select name="buildId" defaultValue={v.buildId ?? ""} className="input"><option value="">—</option>{builds.map((b) => <option key={b.buildId} value={b.buildId}>{b.buildId} (v{b.version}){b.latest ? " ⭐" : ""}</option>)}</select></label>
          <label className="label">CTA<input name="ctaText" defaultValue={v.cta.text} className="input" placeholder={game.storeLinks.length ? "Thêm vào wishlist" : "Theo dõi để xem cập nhật phát triển"} /></label>
          <label className="label">Link CTA (chỉ link chính thức đã xác nhận)<select name="ctaLink" defaultValue={v.cta.linkLabel ?? ""} className="input"><option value="">(không link — CTA theo dõi)</option>{game.storeLinks.filter((l) => l.confirmedByOwner).map((l) => <option key={l.label} value={l.label}>{l.label} — {l.url}</option>)}</select></label>
        </section>

        <section className="card grid gap-3 sm:grid-cols-2">
          <h2 className="h2 sm:col-span-2">5 · Kênh đăng (chỉ tài khoản của {game.publicTitle})</h2>
          {v.targets.length ? v.targets.map((p) => <label key={p} className="label">{PLATFORM_VI[p]}<select name={`acct_${p}`} defaultValue={v.accounts[p] ?? ""} className="input"><option value="">—</option>{accounts.filter((a) => a.platform === p).map((a) => <option key={a.id} value={a.id}>{a.displayName}{a.confirmedAt ? "" : " (chưa xác nhận)"}</option>)}</select></label>) : <p className="text-sm text-slate-500">Chọn nền tảng ở bước 1 rồi lưu.</p>}
        </section>
        <button className="btn">Lưu nháp</button>
      </form>

      <section className="space-y-4">
        <h2 className="h2">Xem trước bản dựng</h2>
        <div className="grid gap-6 md:grid-cols-2">
          {renders.map((x) => (
            <div key={x.f} className="card space-y-2">
              <h3 className="font-semibold">{x.f === "short_9x16" ? "Short 9:16" : "YouTube 16:9"} {x.qa ? (x.qa.passed ? "✅ QA đạt" : "❌ QA lỗi") : ""}</h3>
              {x.has ? (
                <>
                  <video controls preload="metadata" className="max-h-[70vh] w-full rounded bg-black" src={`/api/media/${projectId}/${x.f}/${x.f}.mp4?v=${x.t}`} />
                  <div className="flex gap-2"><a className="btn inline-block" href={`/api/media/${projectId}/${x.f}/${x.f}.mp4?download=1`}>Tải MP4</a><a className="btn-ghost inline-block" href={`/api/media/${projectId}/${x.f}/${x.f}.vi.srt?download=1`}>Tải SRT</a></div>
                  <div className="text-xs"><b>Thumbnail ({x.thumbs?.mode}):</b> {x.thumbs?.note}</div>
                  <div className="flex flex-wrap gap-2">
                    <div className="relative">
                      <img src={`/api/media/${projectId}/${x.f}/${x.f}.thumbnail.jpg?v=${x.t}`} alt="thumbnail đã chọn" className={x.f === "short_9x16" ? "h-64 rounded" : "w-64 rounded"} />
                    </div>
                    {(x.thumbs?.candidates ?? []).map((c: any) => <figure key={c.file} className="text-[10px]"><img src={`/api/media/${projectId}/${x.f}/${c.file.split("/").pop()}`} alt={c.layout} className={x.f === "short_9x16" ? "h-32 rounded" : "w-32 rounded"} /><figcaption>{c.layout} · {c.score}/100</figcaption></figure>)}
                  </div>
                  {x.f === "short_9x16" && (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(SAFE).map(([p, s]) => (
                        <figure key={p} className="text-[10px]">
                          <div className="relative h-48 w-[108px] overflow-hidden rounded bg-black">
                            <img src={`/api/media/${projectId}/${x.f}/${x.f}.poster.png?v=${x.t}`} alt="" className="h-full w-full object-cover" />
                            <div className="safe-zone left-0 right-0 top-0" style={{ height: `${s.top}%` }} />
                            <div className="safe-zone bottom-0 left-0 right-0" style={{ height: `${s.bottom}%` }} />
                            <div className="safe-zone bottom-0 right-0 top-0" style={{ width: `${s.right}%` }} />
                          </div>
                          <figcaption>{PLATFORM_VI[p]} (ước lượng)</figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
                  <details><summary className="cursor-pointer text-xs">Phụ đề & QA</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11px]">{x.srt}</pre><ul className="text-[11px]">{x.qa?.checks.map((c) => <li key={c.name}>{c.ok ? "✅" : "❌"} {c.name}: {c.detail}</li>)}</ul></details>
                </>
              ) : <p className="text-sm text-slate-500">Chưa dựng.</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
