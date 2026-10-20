import type { Platform } from "@ttm/core";
import { buildLabelFor, checkGameClaims, type FeatureMapEntry } from "./build-intel.js";
import type { FootageMap } from "./footage.js";
import { GAMEPLAY_REQUIRED_TYPES, type BuildManifest, type GameAsset, type GameProject, type GameVideoInput } from "./schemas.js";

export type Issue = { code: string; field: string; message: string };

export type Readiness = {
  /** can render now (draft preview is always allowed when there are no render blockers) */
  renderable: boolean;
  /** can be queued for publishing once approved */
  publishable: boolean;
  state: "READY" | "DRAFT" | "WAITING_FOR_CAPTURE" | "HOLD_REVIEW" | "BLOCKED";
  missing: Issue[];
  renderBlockers: Issue[];
  publishBlockers: Issue[];
  /** items a human must explicitly approve (roadmap mention, debug-leak review, auto thumbnail…) */
  requiresApproval: Issue[];
  warnings: Issue[];
  clipLabels: Record<string, string>;
  checkedAt: string;
};

const SHORT_MAX = 60;

export function validateGameVideo(x: {
  game: GameProject;
  input: GameVideoInput;
  assets: GameAsset[];
  features: FeatureMapEntry[];
  builds: BuildManifest[];
  latestBuild: BuildManifest | null;
  footage?: Record<string, FootageMap>;
  hasBrandKit: boolean;
  /** account ids known to MultiAccountManager per platform for this game (already allowlist-filtered) */
  accountsByPlatform?: Partial<Record<Platform, string[]>>;
  roadmapApproved?: boolean;
  now?: Date;
}): Readiness {
  const { game, input } = x;
  const now = x.now ?? new Date();
  const missing: Issue[] = [];
  const renderBlockers: Issue[] = [];
  const publishBlockers: Issue[] = [];
  const requiresApproval: Issue[] = [];
  const warnings: Issue[] = [];
  const clipLabels: Record<string, string> = {};
  const byId = new Map(x.assets.map((a) => [a.assetId, a]));

  if (!game.ownerRights) missing.push({ code: "OWNER_RIGHTS_MISSING", field: "game.ownerRights", message: "Chưa khai báo chủ sở hữu/quyền với game (bắt buộc trước khi đăng)" });
  if (!x.hasBrandKit) warnings.push({ code: "BRAND_KIT_MISSING", field: "brand-kit.json", message: "Game chưa có brand kit — dùng bảng màu trung tính, không tự bịa logo/nhận diện" });
  const logo = input.logoAssetId ? byId.get(input.logoAssetId) : x.assets.find((a) => a.kind === "logo" && a.flags.publishAllowed);
  if (!logo) warnings.push({ code: "LOGO_MISSING", field: "logoAssetId", message: "Chưa có logo — video dùng tên game dạng chữ (không tạo logo giả). Hãy tải logo lên." });
  else if (logo.gameId !== game.gameId) renderBlockers.push({ code: "CROSS_GAME_ASSET", field: "logoAssetId", message: `Logo thuộc game khác (${logo.gameId})` });

  // ------------------------------------------------------------------ clips
  let gameplayClips = 0;
  let shortSec = 0;
  for (const [i, c] of input.clips.entries()) {
    const a = byId.get(c.assetId);
    const f = `clips[${i}]`;
    if (!a) {
      renderBlockers.push({ code: "ASSET_NOT_IN_GAME", field: f, message: `Clip ${c.assetId} không thuộc thư viện của game ${game.gameId} (chặn dùng nhầm asset game khác)` });
      continue;
    }
    if (!a.video) {
      renderBlockers.push({ code: "NOT_A_VIDEO", field: f, message: `${a.originalName} không phải video` });
      continue;
    }
    if (a.qa.status === "rejected") renderBlockers.push({ code: "ASSET_REJECTED", field: f, message: `${a.originalName} đã bị loại ở bước nhập` });
    if (!a.flags.publishAllowed) publishBlockers.push({ code: "ASSET_NOT_PUBLISHABLE", field: f, message: `${a.originalName} được đánh dấu không được phép đăng (nội bộ/chưa công bố)` });
    if (!(c.out > c.in) || c.out > a.video.durationSec + 0.05) renderBlockers.push({ code: "BAD_TRIM", field: f, message: `in/out ${c.in}–${c.out}s ngoài độ dài ${a.video.durationSec.toFixed(2)}s` });
    shortSec += Math.max(0, Math.min(c.out, a.video.durationSec) - c.in);
    if (a.kind === "ai_concept" || a.flags.aiGenerated) {
      if (!input.allowConceptShots) renderBlockers.push({ code: "AI_AS_GAMEPLAY", field: f, message: `${a.originalName} là hình AI/concept — không được dùng như gameplay. Bật "cho phép cảnh concept có nhãn" nếu muốn minh họa.` });
      clipLabels[c.assetId] = "Hình minh họa concept/AI — không phải gameplay";
    } else if (a.kind === "gameplay" && a.flags.isGameplayCapture) {
      gameplayClips++;
      const bl = buildLabelFor(a.buildId, x.latestBuild, x.builds);
      clipLabels[c.assetId] = bl.label;
      if (bl.stale) warnings.push({ code: "BUILD_STALE", field: f, message: `${a.originalName}: ${bl.label} — video sẽ ghi rõ nhãn bản dựng, không tuyên bố là bản mới nhất` });
    } else if (a.kind === "trailer") clipLabels[c.assetId] = "Trailer chính chủ";
    else clipLabels[c.assetId] = a.kind;
    if (a.flags.debugOverlay === true) requiresApproval.push({ code: "DEBUG_LEAK", field: f, message: `${a.originalName} có thể lộ thông tin debug/riêng tư — cần người duyệt` });
    const fm = x.footage?.[a.assetId];
    if (fm?.leak.suspicious) requiresApproval.push({ code: "DEBUG_LEAK", field: f, message: `OCR phát hiện chữ nghi lộ thông tin ở ${fm.leak.matches.map((m) => `${m.t}s "${m.text.trim()}"`).join(", ")} — giữ lại chờ duyệt` });
    else if (fm?.leak.method === "unavailable" && a.flags.debugOverlay === null) warnings.push({ code: "LEAK_UNCHECKED", field: f, message: `${a.originalName}: chưa kiểm tra tự động được chữ debug (thiếu OCR) — hãy xem lại khung hình` });
    if (fm && fm.boringRatio > 0.4) warnings.push({ code: "BORING_FOOTAGE", field: f, message: `${a.originalName}: ${Math.round(fm.boringRatio * 100)}% đứng hình/màn chờ` });
    if (a.flags.bugVisible) requiresApproval.push({ code: "BUG_VISIBLE", field: f, message: `${a.originalName} có lỗi hiển thị không đại diện — cần duyệt` });
    if (a.flags.spoiler) requiresApproval.push({ code: "SPOILER", field: f, message: `${a.originalName} chứa spoiler` });
    if (input.formats.includes("long_16x9") && a.video.height > a.video.width) warnings.push({ code: "ASPECT_COMPOSITION", field: f, message: `${a.originalName} là video dọc — bản 16:9 dùng nền mờ, không cắt xén gây hiểu nhầm; xem trước trước khi duyệt` });
    if (input.formats.includes("short_9x16") && a.video.width > a.video.height * 1.2) warnings.push({ code: "ASPECT_COMPOSITION", field: f, message: `${a.originalName} là video ngang — bản 9:16 dùng nền mờ` });
  }
  for (const id of input.screenshots) {
    const a = byId.get(id);
    if (!a) renderBlockers.push({ code: "ASSET_NOT_IN_GAME", field: "screenshots", message: `Ảnh ${id} không thuộc game ${game.gameId}` });
    else if (!a.image) renderBlockers.push({ code: "NOT_AN_IMAGE", field: "screenshots", message: `${a.originalName} không phải ảnh` });
    else if (a.kind === "ai_concept" && !input.allowConceptShots) renderBlockers.push({ code: "AI_AS_GAMEPLAY", field: "screenshots", message: `${a.originalName} là ảnh AI/concept` });
  }
  const needsGameplay = GAMEPLAY_REQUIRED_TYPES.has(input.contentType);
  if (needsGameplay && gameplayClips === 0)
    renderBlockers.push({ code: "WAITING_FOR_CAPTURE", field: "clips", message: `${input.contentType} cần ít nhất 1 clip gameplay thật (do bạn quay). Có thể làm devlog/art showcase từ asset chính chủ thay thế.` });
  if (!input.clips.length && !input.screenshots.length) missing.push({ code: "NO_MEDIA", field: "clips", message: "Chưa chọn clip gameplay hoặc ảnh nào" });
  if (input.formats.includes("short_9x16") && shortSec > SHORT_MAX - 4) warnings.push({ code: "SHORT_TRIMMED", field: "clips", message: `Tổng clip ${shortSec.toFixed(1)}s — bản Short sẽ được rút gọn còn ≤ ${SHORT_MAX - 4}s + CTA` });

  // ------------------------------------------------------------------ thumbnail
  const t = input.thumbnail;
  for (const [k, need] of [["user16x9", input.formats.includes("long_16x9")], ["user9x16", input.formats.includes("short_9x16")]] as const) {
    const id = t[k];
    if (id) {
      const a = byId.get(id);
      if (!a) renderBlockers.push({ code: "ASSET_NOT_IN_GAME", field: `thumbnail.${k}`, message: `Thumbnail ${id} không thuộc game này` });
      else if (!a.image) renderBlockers.push({ code: "NOT_AN_IMAGE", field: `thumbnail.${k}`, message: "Thumbnail phải là ảnh PNG/JPG/WEBP" });
    } else if (need && t.mode === "LOCK_USER_THUMBNAIL" && k === "user16x9") missing.push({ code: "LOCKED_THUMBNAIL_MISSING", field: `thumbnail.${k}`, message: "Chế độ khóa thumbnail nhưng chưa tải thumbnail 16:9" });
  }
  if (!t.user16x9 && input.formats.includes("long_16x9")) requiresApproval.push({ code: "THUMB_AUTO", field: "thumbnail", message: "Thumbnail 16:9 sẽ tự chọn từ khung gameplay/ảnh chính chủ — cần bạn duyệt" });

  // ------------------------------------------------------------------ truthfulness
  const lines = [input.title, input.hook, input.cta.text, ...input.narration, ...input.clips.map((c) => c.caption), ...input.clips.map((c) => c.annotation), input.thumbnail.textOverlay ?? ""];
  for (const v of checkGameClaims(lines, x.features, game, { roadmapApproved: x.roadmapApproved })) {
    const issue = { code: v.kind, field: "script", message: `${v.detail}: “${v.text.slice(0, 80)}”` };
    if (v.kind === "ROADMAP_NOT_APPROVED") requiresApproval.push(issue);
    else renderBlockers.push(issue);
  }

  // ------------------------------------------------------------------ CTA / links
  const links = game.storeLinks.filter((l) => l.confirmedByOwner);
  if (input.cta.linkLabel) {
    const l = links.find((x2) => x2.label === input.cta.linkLabel);
    if (!l) renderBlockers.push({ code: "CTA_LINK_INVALID", field: "cta.linkLabel", message: `Link "${input.cta.linkLabel}" không có trong danh sách link chính thức đã xác nhận của game` });
    else if (l.checkOk === false) publishBlockers.push({ code: "CTA_LINK_DEAD", field: "cta.linkLabel", message: `Link ${l.url} kiểm tra gần nhất bị lỗi` });
  }
  if (/wishlist|danh sách mong muốn/i.test(input.cta.text) && !links.some((l) => ["wishlist", "steam"].includes(l.kind))) renderBlockers.push({ code: "CTA_NO_STORE", field: "cta.text", message: "CTA nhắc wishlist nhưng game chưa có trang store/wishlist đã xác nhận — dùng CTA theo dõi" });
  if (/(tải ngay|download now|cài đặt ngay|install now)/i.test(input.cta.text) && !links.some((l) => ["app_store", "google_play", "steam", "itch", "demo"].includes(l.kind))) renderBlockers.push({ code: "CTA_NO_STORE", field: "cta.text", message: "CTA kêu gọi tải nhưng chưa có link tải chính thức" });

  // ------------------------------------------------------------------ music
  if (input.musicAssetId) {
    const m = byId.get(input.musicAssetId);
    if (!m) renderBlockers.push({ code: "ASSET_NOT_IN_GAME", field: "musicAssetId", message: "Nhạc không thuộc game này" });
    else {
      const r = m.rights;
      const scopeOk = !r.platformScope || input.targets.every((p) => r.platformScope!.includes(p));
      if (r.ownershipType === "UNKNOWN" || r.commercialUse !== true) publishBlockers.push({ code: "MUSIC_LICENSE", field: "musicAssetId", message: "Nhạc chưa có quyền dùng thương mại đã xác nhận" });
      if (!scopeOk) publishBlockers.push({ code: "MUSIC_LICENSE", field: "musicAssetId", message: `License nhạc không bao gồm: ${input.targets.filter((p) => !r.platformScope!.includes(p)).join(", ")}` });
      if (r.expiresAt && new Date(r.expiresAt) <= now) publishBlockers.push({ code: "MUSIC_LICENSE", field: "musicAssetId", message: `License nhạc hết hạn ${r.expiresAt}` });
    }
  }

  // ------------------------------------------------------------------ publish-only
  if (game.embargoUntil && new Date(game.embargoUntil) > now) publishBlockers.push({ code: "EMBARGO", field: "game.embargoUntil", message: `Đang trong thời gian cấm công bố đến ${game.embargoUntil}` });
  if (!input.targets.length) missing.push({ code: "NO_TARGETS", field: "targets", message: "Chưa chọn nền tảng đích" });
  for (const p of input.targets) {
    const accs = x.accountsByPlatform?.[p] ?? [];
    const chosen = input.accounts[p];
    if (!accs.length) publishBlockers.push({ code: "NO_DESTINATION", field: `accounts.${p}`, message: `Game ${game.gameId} chưa có tài khoản ${p} trong destinationAllowlist — kết nối kênh riêng cho game (không đăng lên kênh Tủ Tò Mò)` });
    else if (chosen && !accs.includes(chosen)) publishBlockers.push({ code: "NOT_ALLOWLISTED", field: `accounts.${p}`, message: `Tài khoản ${chosen} không thuộc game này` });
  }
  if (game.draft) warnings.push({ code: "GAME_DRAFT", field: "game", message: "Hồ sơ game đang ở trạng thái nháp" });

  const renderable = renderBlockers.length === 0 && !missing.some((m) => m.code === "NO_MEDIA" || m.code === "LOCKED_THUMBNAIL_MISSING");
  const publishable = renderable && publishBlockers.length === 0 && missing.length === 0;
  const state: Readiness["state"] = renderBlockers.some((b) => b.code === "WAITING_FOR_CAPTURE")
    ? "WAITING_FOR_CAPTURE"
    : !renderable
      ? missing.length && !renderBlockers.length
        ? "DRAFT"
        : "BLOCKED"
      : !publishable
        ? publishBlockers.length
          ? "BLOCKED"
          : "DRAFT"
        : requiresApproval.length
          ? "HOLD_REVIEW"
          : "READY";
  return { renderable, publishable, state, missing, renderBlockers, publishBlockers, requiresApproval, warnings, clipLabels, checkedAt: now.toISOString() };
}
