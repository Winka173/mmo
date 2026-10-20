import * as fs from "node:fs/promises";
import * as path from "node:path";
import { nowIso } from "@ttm/core";
import { MultiAccountManager } from "@ttm/governance";
import { BrandIdentityEngine, ffmpeg } from "@ttm/media";
import type { DataStore } from "@ttm/storage";
import sharp from "sharp";
import { GameMediaIntake } from "./intake.js";
import { GameRegistry } from "./registry.js";

/**
 * Two playable test fixtures of different genres (spec Y2). All footage here is GENERATED locally
 * by FFmpeg/Sharp as stand-in "captures" so the pipeline can be exercised offline; every render of
 * a fixture is stamped "FIXTURE — footage tổng hợp kiểm thử" and fixture projects are mode=demo.
 */
const svg = (w: number, h: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);

async function png(file: string, w: number, h: number, body: string) {
  await sharp(svg(w, h, body)).png().toFile(file);
}

// ------------------------------------------------------------------ Machine Brigade art
async function mbArt(dir: string) {
  const f = (n: string) => path.join(dir, n);
  let rocks = "";
  for (let i = 0; i < 40; i++) rocks += `<circle cx="${(i * 197) % 1920}" cy="${(i * 331) % 1080}" r="${10 + ((i * 7) % 30)}" fill="#5b5237" opacity="0.6"/>`;
  let grid = "";
  for (let x = 0; x < 1920; x += 120) grid += `<line x1="${x}" y1="0" x2="${x}" y2="1080" stroke="#a89a6a" stroke-opacity="0.15"/>`;
  for (let y = 0; y < 1080; y += 120) grid += `<line x1="0" y1="${y}" x2="1920" y2="${y}" stroke="#a89a6a" stroke-opacity="0.15"/>`;
  await png(f("bg.png"), 1920, 1080, `<rect width="100%" height="100%" fill="#7d7350"/><path d="M0 760 C 500 640, 1200 900, 1920 700 L1920 1080 L0 1080Z" fill="#6a6143"/>${grid}${rocks}<rect x="60" y="40" width="380" height="64" rx="10" fill="#1f2a1f" opacity="0.8"/><text x="80" y="84" font-size="34" fill="#c8d44e" font-family="DejaVu Sans">HP 1200 · Đội hình A</text>`);
  await png(f("tank.png"), 260, 140, `<rect x="10" y="30" width="240" height="80" rx="18" fill="#c8d44e"/><rect x="80" y="10" width="110" height="60" rx="14" fill="#8f9a3a"/><rect x="170" y="32" width="90" height="16" rx="6" fill="#8f9a3a"/><rect x="0" y="100" width="260" height="36" rx="18" fill="#222"/>`);
  await png(f("scout.png"), 180, 110, `<rect x="10" y="30" width="160" height="50" rx="22" fill="#e2702e"/><rect x="60" y="10" width="70" height="36" rx="10" fill="#f0a060"/><circle cx="45" cy="88" r="20" fill="#222"/><circle cx="135" cy="88" r="20" fill="#222"/>`);
  await png(f("boom.png"), 260, 260, `<defs><radialGradient id="r"><stop offset="0" stop-color="#fff6c0"/><stop offset="0.45" stop-color="#ff9a1f"/><stop offset="1" stop-color="#ff4a00" stop-opacity="0"/></radialGradient></defs><circle cx="130" cy="130" r="128" fill="url(#r)"/>`);
  await png(f("logo.png"), 512, 512, `<rect x="16" y="16" width="480" height="480" rx="90" fill="#1f2a1f"/><path d="M96 330 L256 110 L416 330 Z" fill="#c8d44e"/><rect x="150" y="300" width="212" height="70" rx="14" fill="#e2702e"/><text x="256" y="455" font-size="66" font-weight="800" text-anchor="middle" fill="#eef2e3" font-family="DejaVu Sans">MB</text>`);
  await png(f("thumbnail-user-16x9.png"), 1600, 900, `<rect width="100%" height="100%" fill="#2d3a22"/><circle cx="1180" cy="430" r="300" fill="#e2702e" opacity="0.85"/><text x="90" y="420" font-size="150" font-weight="900" fill="#eef2e3" font-family="DejaVu Sans">ĐỘI HÌNH</text><text x="90" y="590" font-size="150" font-weight="900" fill="#c8d44e" font-family="DejaVu Sans">THẮNG TRẬN</text>`);
  await png(f("key-art.png"), 1920, 1080, `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f2a1f"/><stop offset="1" stop-color="#4a5a2a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="960" y="560" font-size="140" font-weight="900" text-anchor="middle" fill="#c8d44e" font-family="DejaVu Sans">MACHINE BRIGADE</text>`);
}

async function mbGameplay(dir: string, out: string, opts: { portrait: boolean; dur: number; fps: number }) {
  const f = (n: string) => path.join(dir, n);
  const scale = opts.portrait ? ",crop=608:1080:656:0,scale=1080:1920" : "";
  await ffmpeg([
    "-loop", "1", "-i", f("bg.png"), "-loop", "1", "-i", f("tank.png"), "-loop", "1", "-i", f("scout.png"), "-loop", "1", "-i", f("boom.png"),
    "-f", "lavfi", "-i", `anoisesrc=color=brown:amplitude=0.12:d=${opts.dur}:r=48000`,
    "-f", "lavfi", "-i", `aevalsrc='0.9*sin(2*PI*55*t)*exp(-7*mod(t,3.2))*gte(mod(t,3.2),1.6)':s=48000:d=${opts.dur}`,
    "-filter_complex",
    `[0][1]overlay=x='-260+t*170':y=640[a];[a][2]overlay=x='1900-t*210':y='380+50*sin(t*1.7)'[b];[b][3]overlay=x='820+60*sin(t)':y=420:enable='between(mod(t,3.2),1.6,2.1)'[c];[c][3]overlay=x=1320:y=700:enable='between(mod(t,4.1),2.4,2.9)',fps=${opts.fps}${scale},format=yuv420p[v];[4][5]amix=inputs=2:normalize=0,volume=0.8[aout]`,
    "-map", "[v]", "-map", "[aout]", "-t", String(opts.dur), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-ar", "48000", out,
  ], { timeoutMs: 10 * 60_000 });
}

// ------------------------------------------------------------------ Lantern Hollow art (2D pixel roguelike)
async function lhArt(dir: string) {
  const f = (n: string) => path.join(dir, n);
  let tiles = "";
  for (let y = 0; y < 720; y += 48) for (let x = 0; x < 1280; x += 48) tiles += `<rect x="${x + 1}" y="${y + 1}" width="46" height="46" fill="${(x / 48 + y / 48) % 2 ? "#2c2440" : "#332a4b"}"/>`;
  await png(f("bg.png"), 1280, 720, `<rect width="100%" height="100%" fill="#1b1528"/>${tiles}<rect x="0" y="0" width="1280" height="96" fill="#0f0b18"/><rect x="0" y="624" width="1280" height="96" fill="#0f0b18"/><text x="24" y="60" font-size="30" fill="#f5c84b" font-family="DejaVu Sans Mono">♥♥♥  Tầng 3 · 120 vàng</text>`);
  await png(f("hero.png"), 96, 96, `<rect x="30" y="8" width="36" height="30" fill="#f2d3a0"/><rect x="24" y="38" width="48" height="40" fill="#6a4fd1"/><rect x="72" y="30" width="10" height="50" fill="#d9d9d9"/><rect x="28" y="78" width="14" height="16" fill="#3a2a1a"/><rect x="54" y="78" width="14" height="16" fill="#3a2a1a"/><circle cx="16" cy="56" r="12" fill="#f5c84b"/>`);
  await png(f("bat.png"), 80, 48, `<path d="M0 20 L24 8 L40 22 L56 8 L80 20 L56 30 L40 44 L24 30 Z" fill="#9e2a4f"/><circle cx="34" cy="22" r="3" fill="#fff"/><circle cx="46" cy="22" r="3" fill="#fff"/>`);
  await png(f("light.png"), 1280, 720, `<defs><radialGradient id="r" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#f5c84b" stop-opacity="0.25"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#r)"/>`);
  await png(f("debug.png"), 1280, 720, `<rect x="900" y="110" width="360" height="150" fill="#000" opacity="0.85"/><text x="915" y="150" font-size="28" fill="#fff" font-family="DejaVu Sans Mono">DEBUG FPS: 60</text><text x="915" y="190" font-size="28" fill="#fff" font-family="DejaVu Sans Mono">dev-build 0.2.0</text><text x="915" y="230" font-size="22" fill="#fff" font-family="DejaVu Sans Mono">qa@studio.example</text>`);
  await png(f("logo.png"), 512, 512, `<rect x="16" y="16" width="480" height="480" rx="240" fill="#1b1528"/><rect x="206" y="120" width="100" height="40" rx="10" fill="#f5c84b"/><rect x="176" y="160" width="160" height="200" rx="40" fill="#f5c84b" opacity="0.9"/><circle cx="256" cy="260" r="46" fill="#fff6c0"/><text x="256" y="440" font-size="58" font-weight="800" text-anchor="middle" fill="#c9b6ff" font-family="DejaVu Sans">LANTERN</text>`);
  await png(f("screenshot-shop.png"), 1280, 720, `<rect width="100%" height="100%" fill="#241c36"/><rect x="200" y="140" width="880" height="440" rx="20" fill="#352a50" stroke="#f5c84b" stroke-width="6"/><text x="640" y="230" font-size="56" text-anchor="middle" fill="#f5c84b" font-family="DejaVu Sans">Cửa hàng lữ khách</text><text x="640" y="330" font-size="38" text-anchor="middle" fill="#e9e1ff" font-family="DejaVu Sans">Đèn lồng xanh · 40 vàng</text><text x="640" y="400" font-size="38" text-anchor="middle" fill="#e9e1ff" font-family="DejaVu Sans">Bình máu nhỏ · 15 vàng</text>`);
}

async function lhGameplay(dir: string, out: string, opts: { dur: number; debug: boolean }) {
  const f = (n: string) => path.join(dir, n);
  const debugIn = opts.debug ? ["-loop", "1", "-i", f("debug.png")] : [];
  const tail = opts.debug ? `[e][5]overlay=0:0,fps=60,format=yuv420p[v]` : `[e]fps=60,format=yuv420p[v]`;
  await ffmpeg([
    "-loop", "1", "-i", f("bg.png"), "-loop", "1", "-i", f("hero.png"), "-loop", "1", "-i", f("bat.png"), "-loop", "1", "-i", f("light.png"),
    "-f", "lavfi", "-i", `aevalsrc='0.35*sin(2*PI*880*t)*exp(-25*mod(t,0.9))+0.12*sin(2*PI*110*t)':s=48000:d=${opts.dur}`,
    ...debugIn,
    "-filter_complex",
    `[0][1]overlay=x='100+mod(t*160,1000)':y='360+70*sin(t*2.3)'[a];[a][2]overlay=x='1100-mod(t*120,900)':y='200+40*sin(t*5)'[b];[b][2]overlay=x='300+200*sin(t*0.8)':y='470+30*cos(t*4)'[c];[c][3]overlay=x='mod(t*160,1000)-540':y=0[d];[d]null[e];${tail}`,
    "-map", "[v]", "-map", "4:a", "-t", String(opts.dur), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-ar", "48000", out,
  ], { timeoutMs: 10 * 60_000 });
}

export type GameFixtureResult = {
  games: string[];
  projects: { gameId: string; projectId: string }[];
  imports: Record<string, { imported: number; rejected: { name: string; reason: string | null }[] }>;
};

/** Seed both fixtures (idempotent). Footage is generated once into DATA_DIR/fixtures-src/. */
export async function seedGameFixtures(store: DataStore): Promise<GameFixtureResult> {
  const games = new GameRegistry(store);
  const intake = new GameMediaIntake(games);
  const brands = new BrandIdentityEngine(store);
  const accounts = new MultiAccountManager(store);
  const src = store.p("state", "fixtures-src");
  const t = nowIso();
  const imports: GameFixtureResult["imports"] = {};
  const summary = (gameId: string, res: Awaited<ReturnType<GameMediaIntake["importFiles"]>>) => {
    const cur = (imports[gameId] ??= { imported: 0, rejected: [] });
    cur.imported += res.manifest.items.filter((i) => i.result === "imported" || i.result === "duplicate").length;
    cur.rejected.push(...res.manifest.items.filter((i) => i.result === "rejected").map((i) => ({ name: i.originalName, reason: i.reason })));
  };

  // ================================================================== Game A: Machine Brigade
  const mbDir = path.join(src, "machine-brigade");
  await fs.mkdir(mbDir, { recursive: true });
  if (!(await fs.stat(path.join(mbDir, "gameplay-battle-landscape.mp4")).catch(() => null))) {
    await mbArt(mbDir);
    await mbGameplay(mbDir, path.join(mbDir, "gameplay-battle-landscape.mp4"), { portrait: false, dur: 14, fps: 30 });
    await mbGameplay(mbDir, path.join(mbDir, "gameplay-mobile-portrait-60fps.mp4"), { portrait: true, dur: 9, fps: 60 });
  }
  await games.save(
    {
      gameId: "machine-brigade",
      internalName: "MB",
      publicTitle: "Machine Brigade",
      localizedTitles: { en: "Machine Brigade" },
      aliases: ["mb", "machinebrigade"],
      tagline: "Xếp đội hình xe quân sự — trận đấu tự động",
      description: "RTS/auto-battler mobile với phương tiện quân sự (FIXTURE kiểm thử).",
      studio: "Studio của bạn (fixture)",
      genres: ["strategy", "auto-battler", "military"],
      tags: ["MachineBrigade", "RTS"],
      gameplayModes: ["PvE"],
      style: "3D",
      platforms: [{ name: "Android", status: "in_development" }, { name: "PC", status: "planned" }],
      engine: "Unity",
      status: "pre_alpha",
      languages: ["vi", "en"],
      releaseDate: null,
      storeLinks: [],
      ctaGoal: "follow",
      destinationAllowlist: ["yt-machine-brigade"],
      ownerRights: { owner: "Chủ dự án Machine Brigade", statement: "Toàn bộ asset trong fixture được tạo cục bộ cho kiểm thử", evidencePath: null },
      draft: false,
      createdAt: t,
    },
    "fixture",
  );
  await brands.save({ owner: { kind: "game", id: "machine-brigade" }, kitVersion: 1, name: "Machine Brigade", tagline: "Devlog — đang phát triển", colors: { bg1: "#1F2A1F", bg2: "#0E140E", accent: "#C8D44E", text: "#EEF2E3", muted: "#A9B39A", badge: "#E2702E" }, voice: { engine: "espeak-ng", voice: "vi", speedWpm: 158, pitch: 35 }, pronunciation: [{ from: "Machine Brigade", to: "Mơ sin Bri gết" }], bannedPhrases: ["miễn phí 100%", "số 1 thế giới"], updatedAt: t }, "fixture");
  await games.saveBuild("machine-brigade", { buildId: "mb-0.3.1", version: "0.3.1", date: "2026-09-20", platforms: ["Android"], importedAt: t }, "## [0.3.1] - 2026-09-20\n### Added\n- Xe trinh sát\n- Xe tăng hạng trung\n### In development\n- Pháo tự hành\n");
  await games.saveBuild("machine-brigade", { buildId: "mb-0.4.0", version: "0.4.0", date: "2026-10-10", platforms: ["Android"], latest: true, importedAt: t, knownLimitations: ["Chưa có âm nhạc chính thức"] }, "## [0.4.0] - 2026-10-10\n### Added\n- Pháo tự hành\n- Trận đấu tự động theo đội hình\n### Planned\n- Chế độ đấu PvP\n");
  await games.saveFeatures("machine-brigade", { features: [{ id: "pvp", name: "Chế độ đấu PvP", keywords: ["PvP", "đấu người với người"], status: "planned" }, { id: "autobattle", name: "Trận đấu tự động", keywords: ["tự động"], status: "confirmed", buildId: "mb-0.4.0" }] });
  const mbFiles = [
    { path: path.join(mbDir, "logo.png"), opts: { kind: "logo" as const } },
    { path: path.join(mbDir, "gameplay-battle-landscape.mp4"), opts: { kind: "gameplay" as const, buildId: "mb-0.4.0", annotation: "Xe tăng và xe trinh sát tiến vào bản đồ sa mạc, pháo nổ", capturedAt: "2026-10-12T10:00:00Z", flags: { debugOverlay: false } } },
    { path: path.join(mbDir, "gameplay-mobile-portrait-60fps.mp4"), opts: { kind: "gameplay" as const, buildId: "mb-0.3.1", annotation: "Quay màn hình điện thoại: đội hình di chuyển", capturedAt: "2026-09-21T10:00:00Z", flags: { debugOverlay: false } } },
    { path: path.join(mbDir, "thumbnail-user-16x9.png"), opts: { kind: "thumbnail" as const, flags: { lockedThumbnail: true } } },
    { path: path.join(mbDir, "key-art.png"), opts: { kind: "key_art" as const, annotation: "Key art chính chủ" } },
  ];
  summary("machine-brigade", await intake.importFiles("machine-brigade", mbFiles));
  await accounts.upsert({ id: "yt-machine-brigade", platform: "youtube_shorts", owner: { kind: "game", id: "machine-brigade" }, displayName: "Machine Brigade (YouTube, fixture)", expectedRemoteId: null, addedAt: t }, "fixture");

  // ================================================================== Game B: Lantern Hollow
  const lhDir = path.join(src, "lantern-hollow");
  await fs.mkdir(lhDir, { recursive: true });
  if (!(await fs.stat(path.join(lhDir, "run-floor3.mp4")).catch(() => null))) {
    await lhArt(lhDir);
    await lhGameplay(lhDir, path.join(lhDir, "run-floor3.mp4"), { dur: 12, debug: false });
    await lhGameplay(lhDir, path.join(lhDir, "run-debug-build.mp4"), { dur: 6, debug: true });
    await fs.writeFile(path.join(lhDir, "upload-empty.mp4"), "");
    const good = await fs.readFile(path.join(lhDir, "run-floor3.mp4"));
    await fs.writeFile(path.join(lhDir, "upload-truncated.mp4"), good.subarray(0, Math.floor(good.length * 0.4)));
  }
  await games.save(
    {
      gameId: "lantern-hollow",
      internalName: "LH",
      publicTitle: "Lantern Hollow",
      localizedTitles: { en: "Lantern Hollow" },
      tagline: "Roguelike 2D pixel — mỗi tầng một chiếc đèn lồng",
      description: "Roguelike hành động 2D phong cách pixel fantasy (FIXTURE kiểm thử).",
      studio: "Lantern Team (fixture)",
      genres: ["roguelike", "action", "fantasy"],
      tags: ["LanternHollow", "Roguelike", "PixelArt"],
      gameplayModes: ["single-player"],
      style: "2D",
      platforms: [{ name: "PC", status: "in_development" }, { name: "Switch", status: "planned" }],
      engine: "Godot",
      status: "alpha",
      languages: ["vi"],
      releaseDate: null,
      storeLinks: [{ label: "Wishlist", kind: "wishlist", url: "https://lanternhollow.example/wishlist", confirmedByOwner: true }],
      utm: { source: "youtube", medium: "video", campaign: "alpha-teaser" },
      ctaGoal: "wishlist",
      destinationAllowlist: ["yt-lantern-hollow", "tt-lantern-hollow"],
      ownerRights: { owner: "Lantern Team", statement: "Asset fixture tạo cục bộ", evidencePath: null },
      draft: false,
      createdAt: t,
    },
    "fixture",
  );
  await brands.save({ owner: { kind: "game", id: "lantern-hollow" }, kitVersion: 1, name: "Lantern Hollow", tagline: "Alpha — đang phát triển", colors: { bg1: "#241C36", bg2: "#120D1C", accent: "#F5C84B", text: "#F3EEFF", muted: "#C9B6FF", badge: "#7FD6C2" }, voice: { engine: "espeak-ng", voice: "vi", speedWpm: 176, pitch: 62 }, pronunciation: [{ from: "Lantern Hollow", to: "Len tơn Hô lâu" }], updatedAt: t }, "fixture");
  await games.saveBuild("lantern-hollow", { buildId: "lh-0.2.0", version: "0.2.0-alpha", date: "2026-10-05", platforms: ["PC"], latest: true, importedAt: t }, "## [0.2.0-alpha] - 2026-10-05\n### Added\n- Tầng hầm thứ 3 với dơi đỏ\n- Cửa hàng lữ khách\n### Planned\n- Chế độ chơi hai người\n");
  await games.saveFeatures("lantern-hollow", { features: [{ id: "coop", name: "Chế độ chơi hai người", keywords: ["co-op", "hai người"], status: "planned" }] });
  const lhFiles = [
    { path: path.join(lhDir, "logo.png"), opts: { kind: "logo" as const } },
    { path: path.join(lhDir, "run-floor3.mp4"), opts: { kind: "gameplay" as const, buildId: "lh-0.2.0", annotation: "Hiệp sĩ chạy qua tầng 3, né dơi đỏ", flags: { debugOverlay: null } } },
    { path: path.join(lhDir, "run-debug-build.mp4"), opts: { kind: "gameplay" as const, buildId: "lh-0.2.0", annotation: "Bản quay từ dev build", flags: { debugOverlay: null } } },
    { path: path.join(lhDir, "screenshot-shop.png"), opts: { kind: "screenshot" as const, annotation: "Cửa hàng lữ khách trong game" } },
    { path: path.join(lhDir, "upload-empty.mp4"), opts: { kind: "gameplay" as const } },
    { path: path.join(lhDir, "upload-truncated.mp4"), opts: { kind: "gameplay" as const } },
  ];
  summary("lantern-hollow", await intake.importFiles("lantern-hollow", lhFiles));
  await accounts.upsert({ id: "yt-lantern-hollow", platform: "youtube_shorts", owner: { kind: "game", id: "lantern-hollow" }, displayName: "Lantern Hollow (YouTube, fixture)", expectedRemoteId: null, addedAt: t }, "fixture");
  await accounts.upsert({ id: "tt-lantern-hollow", platform: "tiktok", owner: { kind: "game", id: "lantern-hollow" }, displayName: "Lantern Hollow (TikTok, fixture)", expectedRemoteId: null, addedAt: t }, "fixture");

  // ================================================================== video projects (wizard state)
  const mbAssets = await games.media("machine-brigade");
  const mb = (kind: string, name: string) => mbAssets.find((a) => a.kind === kind && a.originalName.includes(name))!.assetId;
  await games.saveVideo(
    {
      projectId: "game-mb-highlight",
      gameId: "machine-brigade",
      contentType: "GAMEPLAY_HIGHLIGHT",
      title: "Machine Brigade: pháo tự hành mở màn trận đánh",
      topic: "Highlight trận đấu tự động với pháo tự hành mới ở bản 0.4.0",
      hook: "Đội hình này thắng trong 14 giây",
      narration: ["Xe tăng hạng trung giữ tuyến trước, pháo tự hành bắn yểm trợ từ xa.", "Đây là footage bản cũ trên điện thoại: đội hình di chuyển theo hàng."],
      targets: ["youtube_shorts"],
      formats: ["short_9x16", "long_16x9"],
      clips: [
        { assetId: mb("gameplay", "landscape"), in: 0.5, out: 13.5, caption: "Pháo tự hành yểm trợ tuyến trước", annotation: "Xe tăng + xe trinh sát, pháo nổ" },
        { assetId: mb("gameplay", "portrait"), in: 0.5, out: 8.5, caption: "Quay trên điện thoại (bản 0.3.1)", annotation: "đội hình di chuyển" },
      ],
      screenshots: [mb("key_art", "key-art")],
      logoAssetId: mb("logo", "logo"),
      thumbnail: { mode: "LOCK_USER_THUMBNAIL", user16x9: mb("thumbnail", "thumbnail-user") },
      buildId: "mb-0.4.0",
      cta: { text: "Theo dõi để xem cập nhật phát triển", linkLabel: null },
      accounts: { youtube_shorts: "yt-machine-brigade" },
      updatedAt: t,
    },
    "fixture",
  );
  const lhAssets = await games.media("lantern-hollow");
  const lh = (name: string) => lhAssets.find((a) => a.originalName.includes(name))!.assetId;
  await games.saveVideo(
    {
      projectId: "game-lh-teaser",
      gameId: "lantern-hollow",
      contentType: "GAME_TEASER",
      title: "Lantern Hollow — tầng 3 và lũ dơi đỏ",
      topic: "Teaser alpha 0.2.0: tầng hầm thứ 3 và cửa hàng lữ khách",
      hook: "Tầng 3 không dành cho người yếu tim",
      narration: ["Tầng hầm thứ ba có dơi đỏ bay theo đàn. Né chúng bằng cú lướt."],
      targets: ["youtube_shorts", "tiktok"],
      formats: ["short_9x16", "long_16x9"],
      clips: [{ assetId: lh("run-floor3"), in: 0, out: 11.5, caption: "Né đàn dơi đỏ ở tầng 3", annotation: "hiệp sĩ chạy, dơi bay" }],
      screenshots: [lh("screenshot-shop")],
      logoAssetId: lh("logo"),
      thumbnail: { mode: "GENERATE_CANDIDATES", textOverlay: "Tầng 3 đáng sợ" },
      buildId: "lh-0.2.0",
      cta: { text: "Thêm vào wishlist", linkLabel: "Wishlist" },
      accounts: { youtube_shorts: "yt-lantern-hollow", tiktok: "tt-lantern-hollow" },
      updatedAt: t,
    },
    "fixture",
  );
  return { games: ["machine-brigade", "lantern-hollow"], projects: [{ gameId: "machine-brigade", projectId: "game-mb-highlight" }, { gameId: "lantern-hollow", projectId: "game-lh-teaser" }], imports };
}
