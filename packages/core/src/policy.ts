import type { Claim, MediaRights, Platform, Product, Project, RightsManifest, Settings } from "./schemas.js";

export type GateResult = { ok: boolean; hold: null | "HOLD_RIGHTS" | "HOLD_FACTS" | "HOLD_AFFILIATE" | "HOLD_POLICY"; reasons: string[] };

const pass = (): GateResult => ({ ok: true, hold: null, reasons: [] });

/** Types that reuse third-party expression and need explicit rights (spec D1). */
const REUSE_TYPES = new Set(["TRANSLATED_ADAPTATION", "LICENSED_REPOST"]);

export function isAssetUsable(a: MediaRights, now: Date, platform?: Platform): { ok: boolean; reason?: string } {
  if (a.status !== "VERIFIED") return { ok: false, reason: `asset ${a.assetId}: trạng thái quyền ${a.status}` };
  if (a.ownershipType === "UNKNOWN") return { ok: false, reason: `asset ${a.assetId}: chưa rõ nguồn gốc/quyền sở hữu` };
  if (a.expiresAt && new Date(a.expiresAt) <= now) return { ok: false, reason: `asset ${a.assetId}: giấy phép đã hết hạn ${a.expiresAt}` };
  if (a.commercialUse === false) return { ok: false, reason: `asset ${a.assetId}: giấy phép không cho phép sử dụng thương mại` };
  const needsLicense = !["OWNED", "GENERATED_LOCAL", "PUBLIC_DOMAIN"].includes(a.ownershipType);
  if (needsLicense && !a.licenseId) return { ok: false, reason: `asset ${a.assetId}: thiếu license ID` };
  if (needsLicense && !a.licenseEvidencePath) return { ok: false, reason: `asset ${a.assetId}: thiếu bằng chứng giấy phép` };
  if (platform && a.platformScope && !a.platformScope.includes(platform))
    return { ok: false, reason: `asset ${a.assetId}: giấy phép không bao gồm nền tảng ${platform}` };
  return { ok: true };
}

/** Rights gate — hard requirement, never offset by score (spec O4). */
export function rightsGate(project: Project, manifest: RightsManifest, now: Date, platform?: Platform): GateResult {
  const reasons: string[] = [];
  for (const a of [...manifest.assets, ...manifest.music]) {
    const r = isAssetUsable(a, now, platform);
    if (!r.ok) reasons.push(r.reason!);
    if (REUSE_TYPES.has(project.contentType) && a.ownershipType !== "OWNED" && a.ownershipType !== "GENERATED_LOCAL") {
      if (a.adaptationAllowed !== true) reasons.push(`asset ${a.assetId}: chưa xác nhận quyền phái sinh/biên dịch`);
      if (a.redistributionAllowed !== true) reasons.push(`asset ${a.assetId}: chưa xác nhận quyền phân phối lại`);
    }
  }
  if (manifest.voice && !manifest.voice.commercialUseOk) reasons.push(`giọng đọc ${manifest.voice.voice}: license chưa cho phép thương mại`);
  if (project.contentType === "TRANSLATED_ADAPTATION") {
    const oc = project.originalityChecklist;
    if (!oc || !oc.newNarration || !oc.uniqueValueNote.trim())
      reasons.push("bản biên dịch chưa ghi nhận giá trị gốc (lời bình mới, phân tích riêng)");
  }
  return reasons.length ? { ok: false, hold: "HOLD_RIGHTS", reasons } : pass();
}

/** Fact gate — unverified -> HOLD; important facts want 2 independent sources (spec B4). */
export function factGate(claims: Claim[], now: Date, opts: { maxAgeHoursTimeSensitive?: number } = {}): GateResult {
  const reasons: string[] = [];
  const maxAge = (opts.maxAgeHoursTimeSensitive ?? 24) * 3600_000;
  for (const c of claims) {
    if (c.status !== "VERIFIED") {
      reasons.push(`claim ${c.id}: trạng thái ${c.status} — cần kiểm chứng trước khi đăng`);
      continue;
    }
    const fetched = c.sources.filter((s) => s.fetchedAt);
    const publishers = new Set(fetched.map((s) => s.publisher.toLowerCase()));
    if (publishers.size === 0) reasons.push(`claim ${c.id}: không có nguồn đã được hệ thống truy xuất`);
    if (c.riskTier !== "LOW" && publishers.size < 2) reasons.push(`claim ${c.id}: rủi ro ${c.riskTier} cần ≥2 nguồn độc lập`);
    if (c.contradictionNotes.length) reasons.push(`claim ${c.id}: có mâu thuẫn giữa các nguồn`);
    if (c.timeSensitive && (!c.checkedAt || now.getTime() - new Date(c.checkedAt).getTime() > maxAge))
      reasons.push(`claim ${c.id}: thông tin theo thời gian cần kiểm tra lại`);
  }
  return reasons.length ? { ok: false, hold: "HOLD_FACTS", reasons } : pass();
}

/** Affiliate gate — invalid/expired link or unverified price -> NEEDS_INPUT (spec B5). */
export function affiliateGate(product: Product | null, claims: Claim[], now: Date): GateResult {
  if (!product) return pass();
  const reasons: string[] = [];
  if (product.isDemo) reasons.push("sản phẩm DEMO tổng hợp — không bao giờ được đăng live");
  const link = product.affiliateLink;
  if (!link) reasons.push("chưa có affiliate link hợp lệ từ chương trình Shopee Affiliate");
  else {
    if (link.expiresAt && new Date(link.expiresAt) <= now) reasons.push("affiliate link đã hết hạn");
    if (!link.verifiedAt) reasons.push("affiliate link chưa được kiểm tra hoạt động");
  }
  if (product.price && !product.price.verifiedAt) reasons.push("giá chưa xác minh — không được nêu giá");
  for (const f of product.features) {
    const c = f.claimId ? claims.find((x) => x.id === f.claimId) : undefined;
    if (!c || c.status !== "VERIFIED") reasons.push(`tính năng "${f.text}" chưa có claim đã kiểm chứng`);
  }
  if (!product.disclosure.trim()) reasons.push("thiếu công bố quảng cáo/affiliate");
  return reasons.length ? { ok: false, hold: "HOLD_AFFILIATE", reasons } : pass();
}

/** AUTO_SAFE eligibility (spec B11): all gates + opt-in + non-sensitive + live + external posting on. */
export function autoSafeEligibility(input: {
  project: Project;
  settings: Settings;
  platform: Platform;
  gates: GateResult[];
  qaPassed: boolean;
  publisherAuthorized: boolean;
}): GateResult {
  const { project, settings, platform } = input;
  const reasons: string[] = [];
  if (settings.killSwitch) reasons.push("kill switch đang BẬT");
  if (settings.paused) reasons.push("hệ thống đang tạm dừng (/pause)");
  if (!settings.externalPostingEnabled) reasons.push("đăng bài ra ngoài chưa được cho phép (externalPostingEnabled=false)");
  if (settings.defaultMode === "OFF") reasons.push("chế độ OFF");
  if (project.mode !== "live") reasons.push("dự án ở chế độ demo");
  if (!settings.autoSafeOptIns.includes(`${platform}:${project.contentType}`))
    reasons.push(`chưa opt-in AUTO_SAFE cho ${platform}:${project.contentType}`);
  if (["NEWS_SUMMARY", "TRANSLATED_ADAPTATION", "LICENSED_REPOST"].includes(project.contentType))
    reasons.push(`${project.contentType} mặc định cần duyệt thủ công`);
  if (project.categories.length) reasons.push(`chủ đề nhạy cảm (${project.categories.join(", ")}) luôn cần biên tập viên duyệt`);
  if (!input.qaPassed) reasons.push("QA render chưa đạt");
  if (!input.publisherAuthorized) reasons.push(`kết nối ${platform} chưa được cấp quyền đăng`);
  for (const g of input.gates) reasons.push(...g.reasons);
  return reasons.length ? { ok: false, hold: "HOLD_POLICY", reasons } : pass();
}

/**
 * Human approval addresses editorial choice only; it never overrides a rights/fact/affiliate gate
 * unless new evidence changed the underlying data (spec Q1).
 */
export function canApprove(gates: GateResult[]): { ok: boolean; reasons: string[] } {
  const blocking = gates.filter((g) => !g.ok && g.hold !== "HOLD_POLICY");
  return { ok: blocking.length === 0, reasons: blocking.flatMap((g) => g.reasons) };
}
