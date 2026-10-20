import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FactoryError, nowIso, type Format, type MediaRights, type Platform } from "@ttm/core";
import { MultiAccountManager } from "@ttm/governance";
import {
  BrandIdentityEngine,
  BrandKitFile,
  EspeakNgTts,
  FORMAT_SPECS,
  ffmpeg,
  qaVideo,
  reencodeLockedThumbnail,
  renderGameplayVideo,
  renderThumbnailCandidates,
  scoreThumbnail,
  toRenderKit,
  type GameplaySegment,
  type TtsProvider,
} from "@ttm/media";
import { writeJsonAtomic, type DataStore } from "@ttm/storage";
import sharp from "sharp";
import { judgeVideo } from "@ttm/quality";
import { buildFeatureMap, phraseFeature } from "./build-intel.js";
import { analyzeFootage, type FootageMap } from "./footage.js";
import { validateGameVideo, type Readiness } from "./readiness.js";
import { approvalHash, GameRegistry } from "./registry.js";
import type { GameAsset, GameProject, GameVideoInput } from "./schemas.js";

export type ProduceDeps = { store: DataStore; tts?: TtsProvider | null; log?: (m: string) => void };

export async function loadGameContext(games: GameRegistry, gameId: string) {
  const game = await games.mustGet(gameId);
  const [assets, verified, builds, latest] = await Promise.all([games.media(game.gameId), games.getFeatures(game.gameId), games.listBuilds(game.gameId), games.latestBuild(game.gameId)]);
  const changelogs = [];
  for (const b of builds) {
    const md = await games.readChangelog(game.gameId, b.buildId);
    if (md) changelogs.push({ build: b, md });
  }
  return { game, assets, builds, latest, features: buildFeatureMap({ verified: verified.features, changelogs }) };
}

/** Footage analysis cached per asset content hash. */
export async function footageFor(games: GameRegistry, gameId: string, assets: GameAsset[], ids: string[], opts: { cachedOnly?: boolean } = {}): Promise<Record<string, FootageMap>> {
  const out: Record<string, FootageMap> = {};
  for (const id of [...new Set(ids)]) {
    const a = assets.find((x) => x.assetId === id);
    if (!a?.video) continue;
    const cache = games.dir(gameId, "media", "analysis", `${a.sha256}.json`);
    const hit = await fs.readFile(cache, "utf8").then((s) => JSON.parse(s) as FootageMap, () => null);
    if (hit) {
      out[id] = hit;
      continue;
    }
    if (opts.cachedOnly) continue;
    const fm = await analyzeFootage(a.assetId, games.store.p(a.proxyPath ?? a.path));
    await writeJsonAtomic(cache, fm, { keepBackup: false });
    out[id] = fm;
  }
  return out;
}

export async function gameReadiness(store: DataStore, gameId: string, projectId: string, opts: { analyze?: boolean; now?: Date } = {}) {
  const games = new GameRegistry(store);
  const ctx = await loadGameContext(games, gameId);
  const input = await games.getVideo(ctx.game.gameId, projectId);
  if (!input) throw new FactoryError("GAME_VIDEO_MISSING", "HUMAN_REQUIRED", `Chưa có input.json cho ${gameId}/${projectId}`);
  // analyze:false => use cached analysis only (fast UI); default => analyse missing clips
  const footage = await footageFor(games, ctx.game.gameId, ctx.assets, input.clips.map((c) => c.assetId), { cachedOnly: opts.analyze === false });
  const kit = await new BrandIdentityEngine(store).load({ kind: "game", id: ctx.game.gameId });
  const review = await games.getReview(ctx.game.gameId, projectId);
  const accountsByPlatform: Partial<Record<Platform, string[]>> = {};
  const mam = new MultiAccountManager(store);
  for (const p of input.targets) accountsByPlatform[p] = (await mam.candidates({ brand: ctx.game.gameId, gameId: ctx.game.gameId }, p, ctx.game.destinationAllowlist)).map((a) => a.id);
  const readiness = validateGameVideo({ ...ctx, latestBuild: ctx.latest, input, footage, hasBrandKit: !!kit, accountsByPlatform, roadmapApproved: review.roadmapMentionApproved, now: opts.now });
  await games.writeProjectFile(ctx.game.gameId, projectId, "readiness.json", readiness);
  await games.writeProjectFile(ctx.game.gameId, projectId, "footage-map.json", footage);
  return { ...ctx, input, footage, kit, review, readiness };
}

function neutralKit(game: GameProject): BrandKitFile {
  return BrandKitFile.parse({ kitVersion: 1, owner: { kind: "game", id: game.gameId }, name: game.publicTitle, colors: { bg1: "#2B2D33", bg2: "#16171B", accent: "#E8E8E8", text: "#FFFFFF", muted: "#B9BCC4", badge: "#9AD1FF" }, updatedAt: nowIso() });
}

const SHORT_BUDGET = 54;

/** Select/trim clips so a Short stays within budget, keeping user order (trim from clip ends). */
export function fitClipsToBudget<T extends { in: number; out: number }>(clips: T[], budget: number): T[] {
  const total = clips.reduce((a, c) => a + (c.out - c.in), 0);
  if (total <= budget) return clips;
  const k = budget / total;
  return clips.map((c) => ({ ...c, out: Math.round((c.in + Math.max(1.5, (c.out - c.in) * k)) * 100) / 100 }));
}

function gameMetadata(game: GameProject, input: GameVideoInput, opts: { buildLabel: string | null; hasConcept: boolean; ctaUrl: string | null }) {
  const tags = [...new Set([game.publicTitle.replace(/\s+/g, ""), ...game.tags.map((t) => t.replace(/\s+/g, "")), "GameDev", "IndieGame"])].slice(0, 8).map((t) => `#${t}`).join(" ");
  const lines = [
    input.topic || input.title,
    opts.buildLabel ? `🎮 ${opts.buildLabel}. Footage gameplay thật quay từ game.` : null,
    opts.hasConcept ? "⚠️ Có cảnh minh họa concept/AI — không phải gameplay." : null,
    game.status && game.status !== "released" ? `Trạng thái: ${game.status.replace("_", " ")} — tính năng có thể thay đổi.` : null,
    opts.ctaUrl ? `👉 ${input.cta.text || "Xem thêm"}: ${opts.ctaUrl}` : `👉 ${input.cta.text || "Theo dõi để xem cập nhật phát triển"}`,
    game.studio ? `© ${game.studio}` : null,
  ].filter(Boolean) as string[];
  const desc = lines.join("\n");
  return {
    youtube_shorts: { title: `${input.title} #shorts`.slice(0, 100), description: `${desc}\n\n${tags}`.slice(0, 5000), linkNote: "Link trong mô tả Shorts có thể không click được — kiểm tra UI chính thức." },
    youtube_long: { title: input.title.slice(0, 100), description: `${desc}\n\n${tags}`.slice(0, 5000), linkNote: "Link trong mô tả video dài click được." },
    facebook: { caption: `${desc}\n${tags}`, linkNote: "Link trong caption Facebook có thể click." },
    instagram: { caption: `${desc.replace(/https:\/\/\S+/g, "(link ở bio)")}\n${tags}`.slice(0, 2200), linkNote: "Link caption Instagram KHÔNG click được — cập nhật link bio." },
    tiktok: { caption: `${input.title} ${tags}`.slice(0, 2200), linkNote: "TikTok: link ở bio nếu đủ điều kiện." },
  };
}

/**
 * Produce a game video project: render each requested format from the user's OWN footage, make
 * thumbnails (user-locked thumbnail always wins), QA, and register the result as a normal project
 * (gameId-scoped) so the shared publish pipeline + gates apply. Never publishes.
 */
export async function produceGameVideo(deps: ProduceDeps, gameId: string, projectId: string, opts: { mode?: "demo" | "live"; now?: Date } = {}) {
  const log = deps.log ?? (() => undefined);
  const store = deps.store;
  const games = new GameRegistry(store);
  const r = await gameReadiness(store, gameId, projectId, { now: opts.now });
  const { game, input, assets, readiness } = r;
  if (!readiness.renderable) {
    await games.saveVideo({ ...input, status: "held" }, "producer");
    throw new FactoryError(readiness.state === "WAITING_FOR_CAPTURE" ? "WAITING_FOR_CAPTURE" : "GAME_INPUT_BLOCKED", "BLOCKED", [...readiness.renderBlockers, ...readiness.missing].map((i) => i.message).join("; "), { nextAction: "Mở Create Game Video, bổ sung asset/sửa kịch bản theo danh sách lỗi" });
  }
  const kitFile = r.kit ?? neutralKit(game);
  BrandIdentityEngine.assertOwnKit(kitFile, { kind: "game", id: game.gameId });
  const kit = toRenderKit(kitFile);
  const byId = new Map(assets.map((a) => [a.assetId, a]));
  const logoAsset = input.logoAssetId ? byId.get(input.logoAssetId) : assets.find((a) => a.kind === "logo" && a.flags.publishAllowed);
  const logoFile = logoAsset ? store.p(logoAsset.path) : kitFile.logoPath ? store.p(kitFile.logoPath) : null;
  const tts =
    input.voice.enabled && input.narration.some(Boolean)
      ? (deps.tts ?? new EspeakNgTts({ voice: kitFile.voice.voice, speedWpm: kitFile.voice.speedWpm, pitch: kitFile.voice.pitch, lexicon: BrandIdentityEngine.lexicon(kitFile) }))
      : null;
  const ctaLink = input.cta.linkLabel ? game.storeLinks.find((l) => l.label === input.cta.linkLabel && l.confirmedByOwner) ?? null : null;
  const ctaTitle = input.cta.text || (ctaLink ? ctaLink.label : "Theo dõi để xem cập nhật phát triển");
  const ctaSub = ctaLink ? ctaLink.url.replace(/^https:\/\//, "") : game.status && game.status !== "released" ? `${game.publicTitle} đang phát triển` : game.publicTitle;
  const projDir = (...p: string[]) => store.p("projects", projectId, ...p);

  const outputs: Record<string, any> = {};
  const qaOk: Record<string, boolean> = {};
  const usedAssetIds = new Set<string>();
  for (const format of input.formats) {
    let clips = input.clips.map((c, i) => ({ ...c, i }));
    if (format === "short_9x16") clips = fitClipsToBudget(clips, SHORT_BUDGET);
    const segments: GameplaySegment[] = clips.map((c) => {
      const a = byId.get(c.assetId)!;
      usedAssetIds.add(a.assetId);
      const src = a.proxyPath ?? a.path;
      return {
        id: `clip-${c.i + 1}`,
        file: store.p(src),
        in: c.in,
        out: Math.min(c.out, a.video!.durationSec),
        srcWidth: a.video!.rotation % 180 ? a.video!.height : a.video!.width,
        srcHeight: a.video!.rotation % 180 ? a.video!.width : a.video!.height,
        hasAudio: a.video!.hasAudio,
        keepAudio: input.keepGameAudio && a.flags.includeAudio,
        caption: c.caption || c.annotation,
        narration: input.voice.enabled ? (input.narration[c.i] || null) : null,
        label: readiness.clipLabels[a.assetId] ?? null,
        chapterTitle: format === "long_16x9" ? (c.caption || c.annotation || `Phần ${c.i + 1}`).slice(0, 60) : null,
      };
    });
    if (format === "long_16x9" || segments.length === 0)
      for (const id of input.screenshots) {
        const a = byId.get(id)!;
        usedAssetIds.add(a.assetId);
        segments.push({ id: `still-${a.assetId}`, file: store.p(a.path), in: 0, out: 3, srcWidth: a.image!.width, srcHeight: a.image!.height, hasAudio: false, keepAudio: false, caption: a.annotation || (a.kind === "key_art" ? "Key art chính chủ" : "Ảnh chụp màn hình trong game"), narration: tts ? `${a.annotation || (a.kind === "key_art" ? "Key art của game" : "Ảnh chụp màn hình trong game")}.` : null, label: a.kind === "ai_concept" ? "Hình minh họa concept/AI — không phải gameplay" : a.kind === "screenshot" ? "Ảnh chụp trong game" : null, still: true, stillSec: 2.4, chapterTitle: format === "long_16x9" ? (a.annotation || "Hình ảnh").slice(0, 60) : null });
      }
    const badges = [...(opts.mode === "demo" ? ["FIXTURE — footage tổng hợp kiểm thử"] : []), ...(segments.some((s) => s.label?.startsWith("Hình minh họa")) ? ["Có cảnh concept — không phải gameplay"] : [])];
    log(`[${projectId}] dựng ${format}: ${segments.length} đoạn`);
    const outDir = projDir("renders", format);
    const render = await renderGameplayVideo({
      format,
      brand: kit,
      gameName: game.publicTitle,
      logoFile,
      hook: input.hook || input.title,
      segments,
      cta: { title: ctaTitle, sub: ctaSub, narration: tts ? ctaTitle : null },
      tts,
      workDir: projDir("work", format),
      outDir,
      badges,
      onProgress: (s, d) => log(`[${projectId}/${format}] ${s} ${d}`),
    });

    // thumbnails — user-locked always wins; otherwise truthful candidates from real frames
    const aspect = format === "long_16x9" ? "16x9" : "9x16";
    const userThumbId = aspect === "16x9" ? input.thumbnail.user16x9 : input.thumbnail.user9x16;
    const userThumb = userThumbId ? byId.get(userThumbId) : null;
    const thumbOut = path.join(outDir, `${format}.thumbnail.jpg`);
    let thumbInfo: Record<string, unknown>;
    if (userThumb && (input.thumbnail.mode === "LOCK_USER_THUMBNAIL" || userThumb.flags.lockedThumbnail)) {
      usedAssetIds.add(userThumb.assetId);
      const re = await reencodeLockedThumbnail(store.p(userThumb.path), aspect, thumbOut);
      thumbInfo = { ...re, mode: "LOCK_USER_THUMBNAIL", resizeMode: re.mode, source: userThumb.assetId, sourceSha256: userThumb.sha256, needsApproval: false, note: "Thumbnail người dùng khóa — chỉ chuẩn hóa kích thước/định dạng" };
    } else {
      const hero = input.thumbnail.heroFrame ?? (() => {
        const first = input.clips.find((c) => byId.get(c.assetId)?.flags.isGameplayCapture);
        const fm = first ? r.footage[first.assetId] : null;
        const t = fm?.heroCandidates.find((h) => h.t >= first!.in && h.t <= first!.out)?.t ?? first?.in ?? 0;
        return first ? { assetId: first.assetId, t } : null;
      })();
      let frame: string | null = null;
      if (hero) {
        const a = byId.get(hero.assetId)!;
        frame = path.join(projDir("work", format), "hero.png");
        await ffmpeg(["-ss", hero.t.toFixed(2), "-i", store.p(a.proxyPath ?? a.path), "-frames:v", "1", frame]);
      } else if (userThumb) frame = store.p(userThumb.path);
      else {
        const shot = input.screenshots.map((id) => byId.get(id)).find((a) => a && a.kind !== "ai_concept");
        frame = shot ? store.p(shot.path) : null;
      }
      const cands = await renderThumbnailCandidates({ frame, title: input.thumbnail.textOverlay ?? input.title, brand: kit, logo: logoFile ? await fs.readFile(logoFile) : null, aspect, outPrefix: path.join(outDir, `${format}.thumb`) });
      const scored: (Awaited<ReturnType<typeof scoreThumbnail>> & { layout: string })[] = [];
      for (const c of cands) scored.push({ ...(await scoreThumbnail({ ...c, aspect }, { brand: kit })), layout: c.layout });
      scored.sort((a, b) => b.score - a.score);
      await fs.writeFile(thumbOut, await sharp(scored[0].file).jpeg({ quality: 90 }).toBuffer());
      thumbInfo = { mode: input.thumbnail.mode, heroFrame: hero, candidates: scored.map((s) => ({ file: path.relative(store.root, s.file), layout: s.layout, score: s.score, checks: s.checks })), selected: path.relative(store.root, scored[0].file), needsApproval: true, note: "Tự chọn theo heuristic (chưa có số liệu thử nghiệm) — cần duyệt" };
    }
    await writeJsonAtomic(path.join(outDir, "thumbnails.json"), thumbInfo);

    const spec = FORMAT_SPECS[format];
    const qa = await qaVideo({ projectId, format, file: render.video, srt: render.srt, poster: render.poster, minSec: Math.min(spec.minSec, 5), maxSec: format === "short_9x16" ? 60 : spec.maxSec });
    if (render.chapters) qa.checks.push({ name: "chương YouTube hợp lệ", ok: render.chapters.ok, detail: render.chapters.ok ? render.chapters.text.replace(/\n/g, " | ") : render.chapters.reason! });
    // Quality Judge on the real output (frames, audio, subtitles vs speech); hard failures hold
    const judge = await judgeVideo({ file: render.video, srt: render.srt, format, sceneTimings: render.sceneTimings, mode: "FAST_QA", subtitleSyncCheck: false, minSec: Math.min(spec.minSec, 5), maxSec: format === "short_9x16" ? 60 : spec.maxSec, thumbnailScore: typeof (thumbInfo as any).candidates?.[0]?.score === "number" ? (thumbInfo as any).candidates[0].score : null });
    await writeJsonAtomic(path.join(outDir, "judge-report.json"), judge);
    const judgeHard = judge.hard.filter((h) => !h.ok && !["DURATION"].includes(h.code));
    if (judgeHard.length) qa.checks.push({ name: "Quality Judge", ok: false, detail: judgeHard.map((h) => `${h.code}: ${h.detail}`).join("; ") });
    qa.passed = qa.checks.every((c) => c.ok);
    await store.saveQa(qa);
    qaOk[format] = qa.passed;
    await writeJsonAtomic(path.join(outDir, "render-proof.json"), { ...render, ffprobe: qa.ffprobe, sha256: qa.sha256, renderedAt: nowIso(), brandKit: { owner: kitFile.owner, kitVersion: kitFile.kitVersion }, logo: logoAsset?.assetId ?? null });
    outputs[format] = { video: render.video, durationSec: Math.round(render.durationSec * 10) / 10, qaPassed: qa.passed, failed: qa.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`), compositions: render.compositions, thumbnail: thumbInfo.mode, chapters: render.chapters?.text ?? null };
  }

  // ------------------------------------------------------------------ records for the shared pipeline
  const t = nowIso();
  const rights: MediaRights[] = [...usedAssetIds].map((id) => {
    const a = byId.get(id)!;
    return {
      assetId: a.assetId,
      originUrl: null,
      author: a.rights.owner,
      ownershipType: a.rights.ownershipType === "OWNED" ? "OWNED" : a.rights.ownershipType === "GENERATED_LOCAL" ? "GENERATED_LOCAL" : a.rights.ownershipType === "UNKNOWN" ? "UNKNOWN" : a.rights.ownershipType,
      licenseId: a.rights.licenseId,
      licenseEvidencePath: a.rights.licenseEvidencePath,
      commercialUse: a.rights.commercialUse,
      adaptationAllowed: true,
      redistributionAllowed: true,
      platformScope: a.rights.platformScope,
      attribution: a.rights.attribution,
      expiresAt: a.rights.expiresAt,
      acquiredHow: "local_import",
      hash: a.sha256,
      status: a.rights.ownershipType === "UNKNOWN" || !a.flags.publishAllowed ? "RIGHTS_REVIEW" : "VERIFIED",
      notes: `${a.kind} · ${a.originalName}`,
    } as MediaRights;
  });
  const existing = await store.getProject(projectId);
  const holds = readiness.publishBlockers.length || readiness.missing.length ? "HOLD_POLICY" : readiness.requiresApproval.length ? "READY_FOR_REVIEW" : "READY_FOR_REVIEW";
  const allQa = Object.values(qaOk).every(Boolean);
  await store.saveProject({
    schemaVersion: 1,
    id: projectId,
    brand: game.gameId,
    gameId: game.gameId,
    lineageId: existing?.lineageId ?? projectId,
    language: input.language,
    contentType: input.contentType,
    title: input.title,
    mode: opts.mode ?? existing?.mode ?? "live",
    status: allQa ? holds : "NEEDS_USER",
    revision: input.revision,
    topicId: null,
    productId: null,
    formats: input.formats as Format[],
    categories: [],
    originalityChecklist: null,
    createdAt: existing?.createdAt ?? t,
    updatedAt: t,
  });
  await store.saveRights({ schemaVersion: 1, projectId, assets: rights, music: [], voice: tts ? { ...tts.license(), commercialUseOk: tts.license().commercialUseOk } : null });
  await store.saveClaims(projectId, []);
  await writeJsonAtomic(projDir("brief.json"), { projectId, title: input.title, hook: input.hook || input.title, hookNarration: input.hook || input.title, points: input.clips.map((c, i) => ({ title: c.caption || c.annotation || `Clip ${i + 1}`, narration: input.narration[i] || c.caption || c.annotation || "…", kind: "point" })).concat(input.clips.length ? [] : [{ title: input.title, narration: input.title, kind: "point" }]), cta: ctaTitle, ctaNarration: ctaTitle, disclosures: [], credits: game.studio ? [game.studio] : [] });
  await writeJsonAtomic(projDir("plan.json"), { family: "GAME", targets: input.targets, summary: input.topic || input.title, hashtags: game.tags, badges: [], minSecOverride: 5, brand: game.gameId, signals: {} });
  const buildLabel = Object.values(readiness.clipLabels).find((l) => l.startsWith("Bản dựng") || l.startsWith("Footage bản cũ")) ?? null;
  await writeJsonAtomic(projDir("metadata.json"), gameMetadata(game, input, { buildLabel, hasConcept: Object.values(readiness.clipLabels).some((l) => l.startsWith("Hình minh họa")), ctaUrl: ctaLink ? withUtm(ctaLink.url, game.utm, projectId) : null }));
  const gates = {
    rights: { ok: rights.every((x) => x.status === "VERIFIED"), hold: rights.every((x) => x.status === "VERIFIED") ? null : "HOLD_RIGHTS", reasons: rights.filter((x) => x.status !== "VERIFIED").map((x) => `asset ${x.assetId}: ${x.status}`) },
    game: { ok: readiness.publishable, hold: readiness.publishable ? null : "HOLD_POLICY", reasons: [...readiness.publishBlockers, ...readiness.missing].map((i) => i.message) },
    approval: { ok: readiness.requiresApproval.length === 0, hold: null, reasons: readiness.requiresApproval.map((i) => i.message) },
  };
  await writeJsonAtomic(projDir("gates.json"), { evaluatedAt: t, gates });
  const review = await games.getReview(game.gameId, projectId);
  if (review.approvedInputHash && review.approvedInputHash !== approvalHash(input, assets)) {
    review.history.push({ at: t, by: "producer", action: "approval.invalidated", note: "input/thumbnail/asset thay đổi sau khi duyệt" });
    review.approvedInputHash = null;
    review.approvedAt = null;
    review.approvedBy = null;
    await games.saveReview(game.gameId, review);
  }
  await games.writeProjectFile(game.gameId, projectId, "render-plan.json", { formats: input.formats, outputs, renderedAt: t, brandKit: kitFile.owner });
  await games.writeProjectFile(game.gameId, projectId, "rights.json", rights);
  await games.writeProjectFile(game.gameId, projectId, "storyboard.json", { title: input.title, hook: input.hook, clips: input.clips, screenshots: input.screenshots, cta: { title: ctaTitle, sub: ctaSub } });
  await games.saveVideo({ ...input, status: allQa ? "rendered" : "held" }, "producer");
  await store.audit({ actor: "producer", action: "game.video.render", subject: `${game.gameId}/${projectId}`, detail: { formats: input.formats, qa: qaOk } });
  return { projectId, gameId: game.gameId, outputs, readiness, qaOk };
}

/** Append UTM parameters where the game configured them (own links only). */
export function withUtm(url: string, utm: GameProject["utm"], content: string): string {
  if (!utm) return url;
  const u = new URL(url);
  u.searchParams.set("utm_source", utm.source);
  u.searchParams.set("utm_medium", utm.medium);
  u.searchParams.set("utm_campaign", utm.campaign);
  u.searchParams.set("utm_content", content);
  return u.toString();
}

/** Approve a game video (editorial). Records the input+asset fingerprint; any later change invalidates. */
export async function approveGameVideo(store: DataStore, gameId: string, projectId: string, actor: string, opts: { roadmapMention?: boolean } = {}) {
  const games = new GameRegistry(store);
  const input = await games.getVideo(gameId, projectId);
  if (!input) throw new Error("không có input");
  const review = await games.getReview(gameId, projectId);
  review.approvedInputHash = approvalHash(input, await games.media(gameId));
  review.approvedBy = actor;
  review.approvedAt = nowIso();
  if (opts.roadmapMention) review.roadmapMentionApproved = true;
  review.history.push({ at: review.approvedAt, by: actor, action: "approve", note: opts.roadmapMention ? "kèm duyệt nhắc roadmap" : "" });
  await games.saveReview(gameId, review);
  await store.audit({ actor, action: "game.video.approve", subject: `${gameId}/${projectId}` });
  return review;
}

export async function isApprovalValid(store: DataStore, gameId: string, projectId: string): Promise<{ ok: boolean; reason: string | null }> {
  const games = new GameRegistry(store);
  const input = await games.getVideo(gameId, projectId);
  const review = await games.getReview(gameId, projectId);
  if (!input || !review.approvedInputHash) return { ok: false, reason: "chưa được duyệt" };
  if (review.approvedInputHash !== approvalHash(input, await games.media(gameId))) return { ok: false, reason: "nội dung/thumbnail/asset đã thay đổi sau khi duyệt — cần duyệt lại" };
  return { ok: true, reason: null };
}

export { phraseFeature };
