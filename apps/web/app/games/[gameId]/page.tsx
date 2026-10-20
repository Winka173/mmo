import { buildFeatureMap, groupByBuild } from "@ttm/games";
import Link from "next/link";
import { notFound } from "next/navigation";
import Msg from "../../components/Msg";
import UploadDropzone from "../../components/UploadDropzone";
import { GAME_STATUS_VI, KIND_VI, gameMediaUrl, getAccounts, getGames } from "../../lib/data";
import { addBuild, createCampaign, newVideo, patchAsset, saveFeature } from "../actions";

export const dynamic = "force-dynamic";

export default async function GameDetail({ params, searchParams }: { params: Promise<{ gameId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { gameId } = await params;
  const sp = await searchParams;
  const games = await getGames();
  const game = await games.get(gameId);
  if (!game) notFound();
  const [media, builds, features, campaigns, videos, accounts] = await Promise.all([games.media(gameId), games.listBuilds(gameId), games.getFeatures(gameId), games.listCampaigns(gameId), games.listVideos(gameId), (await getAccounts()).list()]);
  const changelogs = [];
  for (const b of builds) {
    const md = await games.readChangelog(gameId, b.buildId);
    if (md) changelogs.push({ build: b, md });
  }
  const fmap = buildFeatureMap({ verified: features.features, changelogs });
  const groups = groupByBuild(media);
  const own = accounts.filter((a) => a.owner.kind === "game" && a.owner.id === gameId);
  return (
    <div className="space-y-6">
      <Msg msg={sp.msg} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{game.publicTitle}</h1>
          <p className="text-sm text-slate-500">{[game.style, game.engine, game.status && GAME_STATUS_VI[game.status], game.genres.join(", ")].filter(Boolean).join(" · ")} · {game.releaseDate?.confirmed ? `phát hành ${game.releaseDate.date}` : "chưa có ngày phát hành xác nhận"}</p>
        </div>
        <Link href={`/games/${gameId}/edit`} className="btn-ghost">Sửa thông tin & brand kit</Link>
      </div>

      <section className="card space-y-3">
        <h2 className="h2">Video của game</h2>
        <ul className="text-sm">{videos.map((v) => <li key={v.projectId}><Link className="underline" href={`/games/${gameId}/videos/${v.projectId}`}>{v.title}</Link> · {v.contentType} · {v.formats.join("+")} · <b>{v.status}</b> · rev {v.revision}</li>)}</ul>
        <form action={newVideo.bind(null, gameId)} className="flex flex-wrap items-end gap-2 text-sm">
          <label className="label">Loại<select name="contentType" className="input">{["GAMEPLAY_HIGHLIGHT", "GAME_DEVLOG", "GAME_TRAILER", "GAME_TEASER", "GAME_MECHANIC", "GAME_CHARACTER", "GAME_UNIT", "GAME_VEHICLE", "GAME_TACTIC", "GAME_CRAFTING", "GAME_ART_SHOWCASE", "GAME_PATCH_UPDATE", "GAME_ANNOUNCEMENT", "GAME_TUTORIAL", "GAME_COMPARISON", "GAME_LAUNCH", "GAME_SHORT", "GAME_LONG"].map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="label">Tiêu đề<input name="title" className="input" required /></label>
          <label className="label">Mã (slug)<input name="slug" className="input" placeholder="vd: boss-tang-3" /></label>
          <button className="btn">+ Tạo video game</button>
        </form>
      </section>

      <section className="card space-y-3">
        <h2 className="h2">Thư viện media ({media.length})</h2>
        <UploadDropzone gameId={gameId} builds={builds.map((b) => b.buildId)} />
        {Object.entries(groups).map(([b, list]) => <p key={b} className="text-xs text-slate-500">Nhóm theo build {b}: {list.map((a) => a.originalName).join(", ")}</p>)}
        <div className="grid gap-3 md:grid-cols-2">
          {media.map((a) => (
            <form key={a.assetId} action={patchAsset.bind(null, gameId, a.assetId)} className="rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700">
              <div className="flex gap-2">
                {a.image ? <img src={gameMediaUrl(a.path)} alt={a.originalName} className="h-20 w-28 rounded object-cover" /> : a.video ? <video src={gameMediaUrl(a.proxyPath ?? a.path)} className="h-20 w-28 rounded bg-black" preload="metadata" muted /> : <div className="h-20 w-28 rounded bg-slate-200" />}
                <div className="min-w-0">
                  <div className="truncate font-semibold" title={a.originalName}>{a.originalName}</div>
                  <div>{KIND_VI[a.kind]} · {a.video ? `${a.video.width}×${a.video.height} ${a.video.fps}fps ${a.video.durationSec.toFixed(1)}s${a.video.hasAudio ? "" : " (không tiếng)"}` : a.image ? `${a.image.width}×${a.image.height}` : a.mime}</div>
                  <div className="text-slate-500">sha {a.sha256.slice(0, 10)}… · QA {a.qa.status}{a.qa.notes.length ? `: ${a.qa.notes.join(", ")}` : ""}{a.proxyPath ? " · có proxy 30fps" : ""}</div>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1">
                <select name="kind" defaultValue={a.kind} className="input" aria-label="Loại">{Object.entries(KIND_VI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <select name="buildId" defaultValue={a.buildId ?? ""} className="input" aria-label="Build"><option value="">(chưa gán build)</option>{builds.map((b) => <option key={b.buildId}>{b.buildId}</option>)}</select>
                <input name="annotation" defaultValue={a.annotation} placeholder="điều thực sự xảy ra" className="input col-span-2" />
                <select name="debugOverlay" defaultValue={a.flags.debugOverlay === null ? "" : a.flags.debugOverlay ? "yes" : "no"} className="input col-span-2" aria-label="Debug"><option value="">Chưa xem lộ debug/thông tin riêng</option><option value="no">Đã xem: không lộ thông tin</option><option value="yes">CÓ lộ debug/thông tin riêng</option></select>
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                <label><input type="checkbox" name="publishAllowed" defaultChecked={a.flags.publishAllowed} /> được đăng</label>
                <label><input type="checkbox" name="includeAudio" defaultChecked={a.flags.includeAudio} /> giữ tiếng game</label>
                <label><input type="checkbox" name="spoiler" defaultChecked={a.flags.spoiler} /> spoiler</label>
                <label><input type="checkbox" name="bugVisible" defaultChecked={a.flags.bugVisible} /> có bug lộ</label>
                {a.kind === "thumbnail" && <label><input type="checkbox" name="lockedThumbnail" defaultChecked={a.flags.lockedThumbnail} /> khóa thumbnail</label>}
                <button className="btn-ghost ml-auto">Lưu</button>
              </div>
            </form>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-2">
          <h2 className="h2">Build & changelog</h2>
          <ul className="text-sm">{builds.map((b) => <li key={b.buildId}>{b.latest ? "⭐ " : ""}{b.buildId} · v{b.version} · {b.date}{b.knownLimitations.length ? ` · hạn chế: ${b.knownLimitations.join("; ")}` : ""}</li>)}</ul>
          <form action={addBuild.bind(null, gameId)} className="grid grid-cols-2 gap-2 text-sm">
            <input name="buildId" required placeholder="buildId" className="input" /><input name="version" required placeholder="phiên bản" className="input" />
            <input name="date" type="date" required className="input" /><input name="platforms" placeholder="nền tảng (phẩy)" className="input" />
            <input name="limitations" placeholder="hạn chế đã biết (phẩy)" className="input col-span-2" />
            <textarea name="changelog" rows={4} className="input col-span-2 font-mono text-xs" placeholder={"## [0.5.0] - 2026-11-01\n### Added\n- Tính năng đã có\n### Planned\n- Tính năng dự kiến"} />
            <label className="text-xs"><input type="checkbox" name="latest" /> build mới nhất</label><button className="btn">Thêm build</button>
          </form>
        </section>
        <section className="card space-y-2">
          <h2 className="h2">Bản đồ tính năng (GameBuildIntelligence)</h2>
          <ul className="text-xs">{fmap.map((f) => <li key={f.id}><b className={f.status === "confirmed" ? "text-emerald-600" : f.status === "deprecated" ? "text-slate-400" : "text-amber-600"}>{f.status}</b> {f.name} <span className="text-slate-500">({f.source}{f.marketingApproved ? "" : ", chưa duyệt nhắc tới"})</span></li>)}</ul>
          <form action={saveFeature.bind(null, gameId)} className="grid grid-cols-2 gap-2 text-sm">
            <input name="id" required pattern="[a-z0-9_-]{2,60}" placeholder="id" className="input" /><input name="name" required placeholder="tên tính năng" className="input" />
            <select name="status" className="input"><option value="confirmed">đã có (confirmed)</option><option value="in_development">đang phát triển</option><option value="planned">dự kiến</option><option value="deprecated">đã bỏ</option></select>
            <input name="keywords" placeholder="từ khóa (phẩy)" className="input" />
            <label className="text-xs"><input type="checkbox" name="marketingApproved" /> được phép nhắc trong marketing</label><label className="text-xs"><input type="checkbox" name="spoiler" /> spoiler</label>
            <button className="btn col-span-2">Lưu tính năng</button>
          </form>
        </section>
      </div>

      <section className="card space-y-2">
        <h2 className="h2">Chiến dịch</h2>
        <ul className="text-sm">{campaigns.map((c) => <li key={c.campaignId}>{c.name} · {c.kind} · mục tiêu {c.objective} · {c.startDate ?? "?"}→{c.endDate ?? "?"} · {c.status}</li>)}</ul>
        <form action={createCampaign.bind(null, gameId)} className="grid gap-2 text-sm sm:grid-cols-4">
          <input name="campaignId" required pattern="[a-z0-9-]{3,60}" placeholder="mã chiến dịch" className="input" /><input name="name" required placeholder="tên" className="input" />
          <select name="kind" className="input">{["awareness", "community", "devlog", "prelaunch", "launch", "update", "feature_drop", "patch", "playtest", "countdown"].map((k) => <option key={k}>{k}</option>)}</select>
          <select name="objective" className="input">{["follow", "wishlist", "waitlist", "demo", "install", "store_click", "community", "playtest"].map((k) => <option key={k}>{k}</option>)}</select>
          <input name="startDate" type="date" className="input" /><input name="endDate" type="date" className="input" /><input name="countdownTo" type="date" className="input" aria-label="đếm ngược đến" />
          <input name="pillars" placeholder="trụ cột nội dung (phẩy)" className="input" />
          <input name="messages" placeholder="thông điệp (phẩy)" className="input sm:col-span-2" /><input name="personas" placeholder="chân dung người chơi (phẩy)" className="input sm:col-span-2" />
          <fieldset className="sm:col-span-4 text-xs">Kênh: {own.map((a) => <label key={a.id} className="mr-3"><input type="checkbox" name="targetAccounts" value={a.id} /> {a.displayName}</label>)}</fieldset>
          <button className="btn">Tạo chiến dịch</button>
        </form>
      </section>
    </div>
  );
}
