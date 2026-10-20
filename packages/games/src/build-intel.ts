import type { BuildManifest, FeatureStatusV4, GameProject, VerifiedFeature } from "./schemas.js";

export type ChangelogEntry = { version: string | null; date: string | null; section: string; text: string; status: FeatureStatusV4; line: number };

const SECTION_STATUS: [RegExp, FeatureStatusV4][] = [
  [/^(added|new|thêm|mới|changed|thay đổi|improved|cải thiện|fixed|sửa|tính năng)/i, "confirmed"],
  [/^(removed|deprecated|đã bỏ|loại bỏ|gỡ bỏ)/i, "deprecated"],
  [/^(in[ -]?development|wip|prototype|đang phát triển|thử nghiệm|experimental)/i, "in_development"],
  [/^(planned|roadmap|upcoming|coming soon|dự kiến|kế hoạch|sắp tới)/i, "planned"],
];
const INLINE_TAG: [RegExp, FeatureStatusV4][] = [
  [/\[(planned|dự kiến|roadmap)\]/i, "planned"],
  [/\[(wip|prototype|in[- ]?dev(elopment)?|đang phát triển|thử nghiệm)\]/i, "in_development"],
  [/\[(removed|deprecated|đã bỏ)\]/i, "deprecated"],
];

/**
 * Parse a Keep-a-Changelog-style (EN or VI) markdown. Headings `## [0.4.0] - 2026-10-10` start a
 * release; `### Added|Planned|…` set status; inline `[planned]` / `[wip]` override per line.
 * Unknown sections default to `in_development` (never optimistically "confirmed").
 */
export function parseChangelog(md: string): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  let version: string | null = null;
  let date: string | null = null;
  let section = "";
  let status: FeatureStatusV4 = "in_development";
  for (const [i, raw] of md.split(/\r?\n/).entries()) {
    const line = raw.trim();
    const h2 = /^##\s+\[?v?([0-9A-Za-z._-]+)\]?(?:\s*[-–]\s*(\d{4}-\d{2}-\d{2}))?/.exec(line);
    if (h2 && !line.startsWith("###")) {
      version = /unreleased/i.test(h2[1]) ? null : h2[1];
      date = h2[2] ?? null;
      section = "";
      status = /unreleased/i.test(line) ? "in_development" : "in_development";
      continue;
    }
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) {
      section = h3[1].trim();
      status = SECTION_STATUS.find(([re]) => re.test(section))?.[1] ?? "in_development";
      if (version === null && status === "confirmed") status = "in_development"; // "Unreleased / Added" is not shipped yet
      continue;
    }
    const item = /^[-*+]\s+(.+)$/.exec(line);
    if (!item || !section) continue;
    let st = status;
    let text = item[1];
    for (const [re, s] of INLINE_TAG)
      if (re.test(text)) {
        st = s;
        text = text.replace(re, "").trim();
      }
    out.push({ version, date, section, text, status: st, line: i + 1 });
  }
  return out;
}

export type FeatureMapEntry = { id: string; name: string; keywords: string[]; status: FeatureStatusV4; buildId: string | null; source: string; marketingApproved: boolean; spoiler: boolean };

const slug = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "feature";

/**
 * GameBuildIntelligence: verified-features.json (explicit, human-curated) always wins over the
 * changelog; changelog entries add items the curator has not listed yet.
 */
export function buildFeatureMap(input: { verified: VerifiedFeature[]; changelogs: { build: BuildManifest; md: string }[] }): FeatureMapEntry[] {
  const map = new Map<string, FeatureMapEntry>();
  const builds = [...input.changelogs].sort((a, b) => a.build.date.localeCompare(b.build.date));
  for (const { build, md } of builds)
    for (const e of parseChangelog(md)) {
      const id = `cl-${slug(e.text)}`;
      map.set(id, { id, name: e.text, keywords: [e.text], status: e.status, buildId: e.version ? build.buildId : null, source: `builds/${build.buildId}/changelog.md:${e.line}`, marketingApproved: e.status === "confirmed", spoiler: false });
    }
  for (const f of input.verified)
    map.set(f.id, { id: f.id, name: f.name, keywords: [f.name, ...f.keywords], status: f.status, buildId: f.buildId, source: "verified-features.json", marketingApproved: f.status === "confirmed" || f.marketingApproved, spoiler: f.spoiler });
  return [...map.values()];
}

/** Truthful wording per status: never present unimplemented features as playable. */
export function phraseFeature(name: string, status: FeatureStatusV4): string {
  switch (status) {
    case "confirmed":
      return name;
    case "in_development":
      return `${name} (đang phát triển, có thể thay đổi)`;
    case "planned":
      return `Dự kiến: ${name} (chưa có trong game)`;
    case "deprecated":
      return `${name} (đã loại bỏ)`;
  }
}

const norm = (s: string) => s.toLowerCase().normalize("NFC");
const DEV_WORDING = /(đang phát triển|dự kiến|chưa có trong game|sắp có|thử nghiệm|in development|planned|coming soon)/i;
const PLAYABLE_WORDING = /(đã có|chơi ngay|có thể chơi|ra mắt rồi|available now|play now|now live|đã cập nhật)/i;
const DATE_WORDING = /(\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|ra mắt (vào )?(ngày|tháng)|phát hành (vào )?(ngày|tháng)|launch(es|ing)? (on|in)|release date|đếm ngược|countdown|còn \d+ ngày)/i;
const METRIC_WORDING = /(\d[\d.,]*\s*(k|nghìn|triệu|m)?\s*(người chơi|lượt tải|downloads|players|wishlists?|lượt wishlist)|top\s*\d+|đánh giá \d|rating \d|\d+\s*sao|bán được)/i;

export type ClaimViolation = { kind: "UNRELEASED_AS_PLAYABLE" | "ROADMAP_NOT_APPROVED" | "DEPRECATED_PROMOTED" | "UNCONFIRMED_DATE" | "UNVERIFIED_METRIC" | "SPOILER" | "EMBARGO"; text: string; detail: string };

/**
 * Scan every on-screen/narrated line against the feature map and game facts.
 * Returns hard violations (block publish) — approval cannot override them except roadmap mentions
 * that an editor explicitly approved AND that use "đang phát triển" wording.
 */
export function checkGameClaims(lines: string[], features: FeatureMapEntry[], game: Pick<GameProject, "releaseDate">, opts: { roadmapApproved?: boolean } = {}): ClaimViolation[] {
  const v: ClaimViolation[] = [];
  for (const line of lines.filter(Boolean)) {
    const l = norm(line);
    for (const f of features) {
      if (!f.keywords.some((k) => k.length >= 3 && l.includes(norm(k)))) continue;
      if (f.status === "deprecated" && !/đã loại bỏ|removed/i.test(line)) v.push({ kind: "DEPRECATED_PROMOTED", text: line, detail: `"${f.name}" đã bị loại bỏ khỏi game` });
      if (f.status === "planned" || f.status === "in_development") {
        if (PLAYABLE_WORDING.test(line) || !DEV_WORDING.test(line)) v.push({ kind: "UNRELEASED_AS_PLAYABLE", text: line, detail: `"${f.name}" là ${f.status} — phải ghi rõ "đang phát triển"/"dự kiến"` });
        else if (f.status === "planned" && !f.marketingApproved && !opts.roadmapApproved) v.push({ kind: "ROADMAP_NOT_APPROVED", text: line, detail: `nhắc tới roadmap "${f.name}" cần biên tập viên duyệt` });
      }
      if (f.spoiler) v.push({ kind: "SPOILER", text: line, detail: `"${f.name}" được đánh dấu spoiler` });
    }
    if (DATE_WORDING.test(line) && !game.releaseDate?.confirmed) v.push({ kind: "UNCONFIRMED_DATE", text: line, detail: "chưa có ngày phát hành được xác nhận — không đưa ngày/đếm ngược" });
    if (METRIC_WORDING.test(line)) v.push({ kind: "UNVERIFIED_METRIC", text: line, detail: "không nêu số người chơi/lượt tải/đánh giá/doanh số khi không có bằng chứng" });
  }
  return v;
}

/** Footage build label: older-build footage must be labelled, never presented as latest. */
export function buildLabelFor(assetBuildId: string | null, latest: BuildManifest | null, builds: BuildManifest[]): { label: string; stale: boolean } {
  if (!assetBuildId) return { label: "Bản dựng: chưa rõ", stale: true };
  const b = builds.find((x) => x.buildId === assetBuildId);
  const ver = b ? `v${b.version}` : assetBuildId;
  if (latest && assetBuildId !== latest.buildId) return { label: `Footage bản cũ ${ver} — bản mới nhất ${latest.version}`, stale: true };
  return { label: `Bản dựng ${ver}${b?.date ? ` · ${b.date}` : ""}`, stale: false };
}
