import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Claim, FactoryError, nowIso, type ContentType, type Format, type MediaRights, type Project } from "@ttm/core";
import { BrowserPublicConnector, DEFAULT_SOURCE_POLICIES, GameProjectProvider, UserImportConnector, lawfulDownload, phraseByStatus, runDiscovery } from "@ttm/discovery";
import { EspeakNgTts, ffmpeg, MACHINE_BRIGADE_BRAND, logoSvg } from "@ttm/media";
import { TopicBrief, deriveCutdownBrief } from "@ttm/providers";
import { sha256File, writeJsonAtomic } from "@ttm/storage";
import sharp from "sharp";
import { FIXTURES, type Ctx } from "./context.js";
import type { ProjectPlan } from "./produce.js";

const read = async (rel: string) => JSON.parse(await fs.readFile(path.join(FIXTURES, rel), "utf8"));

const generatedAsset = (assetId: string, notes = "Đồ họa do hệ thống tự tạo (SVG/Sharp), không dùng tài sản bên thứ ba"): MediaRights => ({
  assetId,
  originUrl: null,
  author: "Tủ Tò Mò (tự tạo)",
  ownershipType: "GENERATED_LOCAL",
  licenseId: null,
  licenseEvidencePath: null,
  commercialUse: true,
  adaptationAllowed: true,
  redistributionAllowed: true,
  platformScope: null,
  attribution: null,
  expiresAt: null,
  acquiredHow: "generated",
  hash: null,
  status: "VERIFIED",
  notes,
});

async function createProject(
  ctx: Ctx,
  p: { id: string; type: ContentType; title: string; mode: "demo" | "live"; formats: Format[]; productId?: string | null; originality?: Project["originalityChecklist"] },
  brief: unknown,
  plan: Partial<ProjectPlan> & Pick<ProjectPlan, "family" | "targets" | "summary">,
  claims: Claim[],
  assets: MediaRights[],
): Promise<void> {
  const t = nowIso();
  const existing = await ctx.store.getProject(p.id);
  await ctx.store.saveProject({
    schemaVersion: 1,
    id: p.id,
    brand: plan.brand === "machine-brigade" ? "machine-brigade" : "tutomo",
    contentType: p.type,
    title: p.title,
    mode: p.mode,
    status: "CANDIDATE",
    revision: existing?.revision ?? 1,
    topicId: null,
    productId: p.productId ?? null,
    formats: p.formats,
    categories: [],
    originalityChecklist: p.originality ?? null,
    createdAt: existing?.createdAt ?? t,
    updatedAt: t,
  });
  await writeJsonAtomic(ctx.store.p("projects", p.id, "brief.json"), TopicBrief.parse(brief));
  await writeJsonAtomic(ctx.store.p("projects", p.id, "plan.json"), { hashtags: [], badges: [], minSecOverride: null, brand: "tutomo", signals: {}, ...plan });
  await ctx.store.saveClaims(p.id, claims);
  await ctx.store.saveRights({ schemaVersion: 1, projectId: p.id, assets, music: [], voice: null });
}

/** Pendulum diagram frames for the self-owned "source video" used by the translation fixture. */
async function pendulumFrame(angleDeg: number, caption: string, out: string) {
  const W = 1080;
  const H = 1920;
  const len = 900;
  const a = (angleDeg * Math.PI) / 180;
  const x = W / 2 + Math.sin(a) * len;
  const y = 380 + Math.cos(a) * len;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#f3efe6"/>
    <rect x="${W / 2 - 220}" y="340" width="440" height="40" rx="10" fill="#5b4636"/>
    <path d="M ${W / 2 - 520} ${380 + len} A ${len} ${len} 0 0 0 ${W / 2 + 520} ${380 + len}" stroke="#c9bba5" stroke-width="6" fill="none" stroke-dasharray="18 14"/>
    <line x1="${W / 2}" y1="380" x2="${x}" y2="${y}" stroke="#333" stroke-width="10"/>
    <circle cx="${x}" cy="${y}" r="90" fill="#c0392b"/>
    <text x="${W / 2}" y="1600" font-size="54" text-anchor="middle" fill="#333" font-family="DejaVu Sans, Arial">${caption}</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(out);
}

async function vehicleRender(kind: "scout" | "tank", out: string) {
  const c = MACHINE_BRIGADE_BRAND.colors;
  const body =
    kind === "scout"
      ? `<rect x="300" y="900" width="480" height="140" rx="40" fill="${c.accent}"/><rect x="420" y="830" width="200" height="90" rx="20" fill="${c.muted}"/><circle cx="390" cy="1060" r="60" fill="#222"/><circle cx="690" cy="1060" r="60" fill="#222"/>`
      : `<rect x="220" y="920" width="640" height="150" rx="30" fill="${c.accent}"/><rect x="380" y="830" width="300" height="110" rx="30" fill="${c.muted}"/><rect x="660" y="865" width="320" height="32" rx="10" fill="${c.muted}"/><rect x="200" y="1060" width="680" height="80" rx="40" fill="#222"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="100%" height="100%" fill="${c.bg2}"/>
    <rect y="1140" width="1080" height="780" fill="${c.bg1}"/>${body}
    <text x="540" y="1400" font-size="44" text-anchor="middle" fill="${c.text}" font-family="DejaVu Sans, Arial">Ảnh render fixture — không phải gameplay</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(out);
}

export type SeedResult = { projects: string[]; discovery: Record<string, unknown> };

/**
 * Seeds the legal offline fixtures. Everything is either generated locally, owned by the project,
 * or a factual claim with real (not-yet-fetched) sources. Nothing is downloaded from third parties.
 */
export async function seedFixtures(ctx: Ctx): Promise<SeedResult> {
  const projects: string[] = [];
  const venusClaims = (await read("fact-venus/claims.json")).map((c: unknown) => Claim.parse(c));

  // 1) FACT short — real sources, not yet fetched => publish gate holds until `factcheck` runs.
  await createProject(
    ctx,
    { id: "fixture-fact-venus", type: "FACT_SHORT", title: "Sao Kim: tự quay lâu hơn một năm", mode: "live", formats: ["short_9x16"] },
    await read("fact-venus/short.brief.json"),
    { family: "FACT", targets: ["youtube_shorts", "facebook", "instagram", "tiktok"], summary: "Vì sao người ta nói một ngày trên Sao Kim dài hơn một năm — và chỗ dễ hiểu nhầm.", hashtags: ["TuToMo", "SaoKim", "ThienVan", "KhoaHoc"], signals: { uniqueness: 0.7, factualConfidence: 0.8, audienceInterest: 0.7 } },
    venusClaims,
    [generatedAsset("generated-graphics")],
  );
  projects.push("fixture-fact-venus");

  // 2) AFFILIATE — synthetic DEMO product, no affiliate link => always HOLD_AFFILIATE.
  const product = await read("affiliate-demo/product.json");
  await ctx.store.saveProduct(product);
  await createProject(
    ctx,
    { id: "fixture-affiliate-demo", type: "AFFILIATE_REVIEW", title: "3 điều kiểm tra trước khi mua bình giữ nhiệt (DEMO)", mode: "demo", formats: ["short_9x16"], productId: product.id },
    await read("affiliate-demo/short.brief.json"),
    { family: "PRODUCT", targets: ["youtube_shorts", "facebook", "tiktok"], summary: "Checklist mua bình giữ nhiệt. (Video mẫu — sản phẩm giả lập)", hashtags: ["TuToMo", "MuaSamThongMinh"], badges: ["DEMO — SẢN PHẨM GIẢ LẬP"], signals: { affiliatePotential: 0.6 } },
    [],
    [generatedAsset("generated-graphics")],
  );
  projects.push("fixture-affiliate-demo");

  // 3) TRANSLATED_ADAPTATION of a self-owned source video (generated here, so rights are ours).
  const src = await read("adaptation-owned/source.json");
  const adaptDir = ctx.store.p("projects", "fixture-adaptation-owned");
  await fs.mkdir(path.join(adaptDir, "source"), { recursive: true });
  await fs.mkdir(path.join(adaptDir, "assets"), { recursive: true });
  const srcVideo = path.join(adaptDir, "source", "owned-source-en.mp4");
  if (!(await fs.stat(srcVideo).catch(() => null))) {
    const fA = path.join(adaptDir, "source", "f1.png");
    const fB = path.join(adaptDir, "source", "f2.png");
    await pendulumFrame(-28, "Owned demo source — pendulum", fA);
    await pendulumFrame(24, "Length sets the rhythm", fB);
    const en = path.join(adaptDir, "source", "en.wav");
    await new EspeakNgTts({ voice: "en-us" }).synthesize(src.segments.map((s: any) => s.en).join(" "), en);
    await ffmpeg(["-loop", "1", "-t", "4", "-i", fA, "-loop", "1", "-t", "4", "-i", fB, "-i", en, "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]", "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-r", "30", "-c:a", "aac", "-shortest", srcVideo]);
  }
  await ffmpeg(["-ss", "1", "-i", srcVideo, "-frames:v", "1", path.join(adaptDir, "assets", "owned-src-frame-1.png")]);
  await ffmpeg(["-ss", "5", "-i", srcVideo, "-frames:v", "1", path.join(adaptDir, "assets", "owned-src-frame-2.png")]);
  const ownedHash = await sha256File(srcVideo);
  const owned = (assetId: string): MediaRights => ({
    assetId,
    originUrl: null,
    author: "Tủ Tò Mò",
    ownershipType: "OWNED",
    licenseId: "OWNED-BY-CHANNEL",
    licenseEvidencePath: path.join(FIXTURES, "adaptation-owned", "source.json"),
    commercialUse: true,
    adaptationAllowed: true,
    redistributionAllowed: true,
    platformScope: null,
    attribution: "Video gốc: Tủ Tò Mò",
    expiresAt: null,
    acquiredHow: "local_import",
    hash: ownedHash,
    status: "VERIFIED",
    notes: "Video nguồn tiếng Anh do chính dự án tạo trong bước seed; transcript có sẵn (không cần ASR).",
  });
  await createProject(
    ctx,
    {
      id: "fixture-adaptation-owned",
      type: "TRANSLATED_ADAPTATION",
      title: "Vì sao đồng hồ quả lắc chạy đều? (bản dịch + bình luận)",
      mode: "demo",
      formats: ["short_9x16"],
      originality: { newNarration: true, originalLayout: true, substantialEditing: true, uniqueValueNote: "Thêm phần giải thích cách chỉnh đồng hồ bằng chiều dài con lắc; bố cục và lồng tiếng mới." },
    },
    await read("adaptation-owned/short.brief.json"),
    { family: "ADAPT", targets: ["youtube_shorts", "facebook"], summary: "Bản dịch tiếng Việt kèm bình luận từ video gốc do kênh sở hữu.", hashtags: ["TuToMo", "VatLy"], badges: ["Bản dịch từ video tự sở hữu"] },
    [],
    [owned("owned-src-clip"), owned("owned-src-frame-1"), owned("owned-src-frame-2")],
  );
  projects.push("fixture-adaptation-owned");

  // 4) YOUTUBE_LONG 16:9 sample + one cutdown Short derived from our own long brief.
  const longBrief = TopicBrief.parse(await read("fact-venus/long.brief.json"));
  await createProject(
    ctx,
    { id: "fixture-long-venus", type: "YOUTUBE_LONG", title: "Sao Kim — hành tinh kỳ lạ nhất ngay cạnh Trái Đất", mode: "live", formats: ["long_16x9"] },
    longBrief,
    { family: "FACT", targets: ["youtube_long"], summary: "Ba ngăn tủ về Sao Kim: tự quay siêu chậm, một năm ngắn hơn, và bề mặt như lò nung.", hashtags: ["TuToMo", "SaoKim", "ThienVan"], minSecOverride: 60 },
    venusClaims,
    [generatedAsset("generated-graphics")],
  );
  projects.push("fixture-long-venus");
  await createProject(
    ctx,
    { id: "fixture-long-venus-cut1", type: "FACT_SHORT", title: "Sao Kim quay ngược chiều", mode: "live", formats: ["short_9x16"] },
    deriveCutdownBrief(longBrief, [0, 1], "fixture-long-venus-cut1", "Sao Kim tự quay ngược và siêu chậm"),
    { family: "FACT", targets: ["youtube_shorts"], summary: "Trích từ video dài về Sao Kim.", hashtags: ["TuToMo", "SaoKim"], signals: { recentRepeatPenalty: 0.3 } },
    venusClaims,
    [generatedAsset("generated-graphics")],
  );
  projects.push("fixture-long-venus-cut1");

  // 5) Machine Brigade devlog from a local owned game folder (renders only; no gameplay capture).
  const gameDir = ctx.store.p("game", "machine-brigade", "fixture-project");
  await fs.mkdir(path.join(gameDir, "assets"), { recursive: true });
  await fs.copyFile(path.join(FIXTURES, "machine-brigade", "game-manifest.json"), path.join(gameDir, "game-manifest.json"));
  await vehicleRender("scout", path.join(gameDir, "assets", "render-scout.png"));
  await vehicleRender("tank", path.join(gameDir, "assets", "render-tank.png"));
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">${logoSvg(MACHINE_BRIGADE_BRAND, 0, 0, 400)}</svg>`)).png().toFile(path.join(gameDir, "assets", "logo.png"));
  const game = await new GameProjectProvider(gameDir).load();
  const readiness = GameProjectProvider.gameplayReadiness(game.manifest, game.assetFiles);
  const gameProjectDir = ctx.store.p("projects", "fixture-game-devlog");
  await fs.mkdir(path.join(gameProjectDir, "assets"), { recursive: true });
  for (const id of ["render-scout", "render-tank"]) await fs.copyFile(game.assetFiles[id], path.join(gameProjectDir, "assets", `${id}.png`));
  await writeJsonAtomic(path.join(gameProjectDir, "game-readiness.json"), { ...readiness, buildId: game.manifest.buildId, ledger: game.ledger, missing: game.missing });
  const m = game.manifest;
  const v = (id: string) => m.vehicles.find((x) => x.id === id)!;
  await createProject(
    ctx,
    { id: "fixture-game-devlog", type: "GAME_DEVLOG", title: `Machine Brigade devlog — build ${m.version}`, mode: "demo", formats: ["short_9x16"] },
    {
      projectId: "fixture-game-devlog",
      title: `Machine Brigade — devlog ${m.version}`,
      hook: `Devlog Machine Brigade · build ${m.version}`,
      hookNarration: `Cập nhật phát triển Machine Brigade, bản thử nghiệm ${m.version}. Đây là ảnh render, chưa phải cảnh gameplay.`,
      points: [
        { title: v("scout").name, narration: `${phraseByStatus(`${v("scout").name}: ${v("scout").role}`, v("scout").status)}.`, bullets: [`Tốc độ ${v("scout").stats.speed}/10`, `Giáp ${v("scout").stats.armor}/10`], assetId: "render-scout", kind: "point" },
        { title: v("tank").name, narration: `${phraseByStatus(`${v("tank").name}: ${v("tank").role}`, v("tank").status)}.`, bullets: [`Giáp ${v("tank").stats.armor}/10`], assetId: "render-tank", kind: "point" },
        { title: "Đang làm & dự kiến", narration: `${phraseByStatus(v("artillery").name, v("artillery").status)}. ${phraseByStatus(m.features.find((f) => f.id === "pvp")!.text, "planned")}.`, bullets: [phraseByStatus(v("artillery").name, "prototype"), phraseByStatus("Đấu PvP", "planned")], kind: "point" },
      ],
      cta: "Theo dõi để xem cập nhật phát triển",
      ctaNarration: "Theo dõi để xem các bản cập nhật phát triển tiếp theo.",
      disclosures: [`Build ${m.buildId} · ${m.buildDate}`],
      credits: [],
    },
    { family: "GAME", targets: [], summary: `Devlog build ${m.version}`, hashtags: ["MachineBrigade", "GameDev"], brand: "machine-brigade", badges: ["Ảnh render — không phải gameplay"] },
    [],
    ["render-scout", "render-tank"].map((id) => ({ ...generatedAsset(id), ownershipType: "OWNED" as const, licenseId: "OWNED-GAME-ASSET", licenseEvidencePath: path.join(gameDir, "game-manifest.json"), acquiredHow: "local_import" as const, hash: game.hashes[id], notes: "Asset game chính chủ (fixture)" })),
  );
  projects.push("fixture-game-devlog");

  // 6) Discovery: lawful sources only; blocked download -> IDEA_ONLY -> original remake.
  const blockedTaobao = new BrowserPublicConnector("taobao", DEFAULT_SOURCE_POLICIES[0], async () => {
    throw new Error("không bao giờ được gọi khi chưa được phép");
  }, (q) => `https://s.taobao.com/search?q=${encodeURIComponent(q)}`);
  const disc = await runDiscovery({
    store: ctx.store,
    connectors: [blockedTaobao, new UserImportConnector(path.join(FIXTURES, "discovery", "user-import.json"))],
    query: "thí nghiệm đơn giản",
  });
  const eggCand = disc.candidates.find((c) => c.item.originId === "fixture-dy-001")!;
  let blockedDownload: string;
  try {
    await lawfulDownload(eggCand.item.sourceUrl, ctx.store.p("quarantine", "should-not-exist.mp4"), { decision: eggCand.acquisition });
    throw new Error("BUG: tải được media không có quyền");
  } catch (e) {
    if (!(e instanceof FactoryError) || e.code !== "DOWNLOAD_NOT_PERMITTED") throw e;
    blockedDownload = `${e.code}: ${e.message} -> ${e.extra.manualFallback}`;
  }
  await createProject(
    ctx,
    { id: "fixture-remake-egg", type: "CHINA_INSPIRED_ORIGINAL", title: "Vì sao trứng nổi trong nước muối? (remake gốc)", mode: "demo", formats: ["short_9x16"] },
    await read("discovery/remake.brief.json"),
    { family: "FACT", targets: ["youtube_shorts", "tiktok"], summary: "Video gốc dựng lại từ ý tưởng (không dùng media nguồn).", hashtags: ["TuToMo", "ThiNghiem"], badges: ["Nội dung gốc — ý tưởng tham khảo"] },
    [Claim.parse({ id: "egg-density", text: "Vật nổi khi khối lượng riêng nhỏ hơn chất lỏng; hòa tan muối làm tăng khối lượng riêng của nước.", sources: [], riskTier: "LOW", status: "UNVERIFIED" })],
    [generatedAsset("generated-graphics")],
  );
  await writeJsonAtomic(ctx.store.p("projects", "fixture-remake-egg", "provenance.json"), {
    inspiredBy: { candidateId: eggCand.id, url: eggCand.canonicalUrl, source: eggCand.item.source, observedAt: eggCand.item.observedAt },
    mediaUsed: "NONE — chỉ dùng ý tưởng; hình ảnh/giọng/kịch bản là mới",
    blockedDownload,
    decisionTrace: disc.traceFile,
  });
  projects.push("fixture-remake-egg");

  return {
    projects,
    discovery: {
      traceFile: disc.traceFile,
      accepted: disc.trace.accepted.length,
      rejected: disc.trace.rejected,
      events: disc.trace.events.map((e) => `${e.code}: ${e.message}`),
      blockedDownload,
      gameReadiness: readiness,
    },
  };
}
