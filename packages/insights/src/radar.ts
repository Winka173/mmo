export type SignalPoint = { at: string; views: number | null; likes: number | null; followers: number | null; source: string };

export type RadarCandidate = {
  id: string;
  title: string;
  conceptVi: string;
  source: string;
  sourceUrl: string;
  creator: string | null;
  observedAt: string;
  /** from duplicate/originality scan: 0..1 */
  novelty: number;
  /** a Vietnamese market item with the same concept was found in checked sources */
  vnDuplicateFound: boolean;
  /** media reuse permitted? (idea is always usable for an ORIGINAL remake) */
  mediaRightsOk: boolean;
  /** affiliate/educational/game value estimate 0..1 from editor/discovery */
  value: number;
  signals: SignalPoint[];
};

export type Opportunity = {
  id: string;
  title: string;
  score: number;
  breakdown: { freshness: number; growth: number | null; novelty: number; rights: number; value: number; vnPenalty: number };
  growthLabel: "đo được" | "xấp xỉ (dữ liệu thưa)" | "không có dữ liệu";
  angles: string[];
  attribution: string;
  action: "ORIGINAL_REMAKE" | "LICENSED_REUSE" | "SKIP_DUPLICATE";
  notes: string[];
};

/** Engagement growth per hour, normalised by account size when (and only when) follower count is observed. */
export function growthSlope(signals: SignalPoint[]): { perHour: number | null; normalised: boolean; points: number } {
  const pts = signals.filter((s) => s.views !== null).sort((a, b) => a.at.localeCompare(b.at));
  if (pts.length < 2) return { perHour: null, normalised: false, points: pts.length };
  const first = pts[0];
  const last = pts[pts.length - 1];
  const hours = Math.max(1, (new Date(last.at).getTime() - new Date(first.at).getTime()) / 3600_000);
  const raw = (last.views! - first.views!) / hours;
  const followers = last.followers ?? first.followers;
  return followers ? { perHour: raw / Math.max(100, followers), normalised: true, points: pts.length } : { perHour: raw, normalised: false, points: pts.length };
}

const ANGLES = [
  (t: string) => `Giải thích “vì sao” đằng sau: ${t}`,
  (t: string) => `Tự kiểm chứng bằng thí nghiệm/đo đạc riêng: ${t}`,
  (t: string) => `So sánh với bối cảnh Việt Nam (giá, quy định, khí hậu): ${t}`,
  (t: string) => `Những hiểu lầm phổ biến về: ${t}`,
];

/**
 * OpportunityRadar: freshness + growth + novelty + rights + value, with a heavy penalty when the
 * same concept already exists in Vietnamese. Sparse/untrusted metrics are labelled approximate; a
 * missing follower count is never invented. Output is an IDEA to remake originally, with credit.
 */
export function rankOpportunities(cands: RadarCandidate[], now: Date): Opportunity[] {
  const slopes = cands.map((c) => growthSlope(c.signals));
  const maxSlope = Math.max(1e-9, ...slopes.map((s) => s.perHour ?? 0));
  return cands
    .map((c, i) => {
      const ageH = Math.max(0, (now.getTime() - new Date(c.observedAt).getTime()) / 3600_000);
      const freshness = Math.max(0, 1 - ageH / (24 * 14));
      const s = slopes[i];
      const growth = s.perHour === null ? null : Math.max(0, s.perHour) / maxSlope;
      const vnPenalty = c.vnDuplicateFound ? 0.5 : 0;
      const rights = c.mediaRightsOk ? 1 : 0.7; // idea-only is fine; media reuse would need a licence
      const score = Math.round((0.2 * freshness + 0.2 * (growth ?? 0.3) + 0.3 * c.novelty + 0.1 * rights + 0.2 * c.value - vnPenalty) * 1000) / 10;
      const notes: string[] = [];
      if (s.points < 3 && s.points > 0) notes.push("chỉ có ít điểm dữ liệu — tăng trưởng là xấp xỉ");
      if (!s.normalised && s.perHour !== null) notes.push("không thấy số follower — không chuẩn hóa theo quy mô kênh (không suy đoán)");
      if (c.vnDuplicateFound) notes.push("đã có nội dung tiếng Việt cùng chủ đề trong nguồn đã kiểm tra — phạt điểm nặng");
      if (!c.mediaRightsOk) notes.push("không có quyền dùng media gốc — chỉ làm video gốc từ ý tưởng");
      return {
        id: c.id,
        title: c.title,
        score,
        breakdown: { freshness: Math.round(freshness * 100) / 100, growth: growth === null ? null : Math.round(growth * 100) / 100, novelty: c.novelty, rights, value: c.value, vnPenalty },
        growthLabel: s.perHour === null ? ("không có dữ liệu" as const) : s.points < 3 ? ("xấp xỉ (dữ liệu thưa)" as const) : ("đo được" as const),
        angles: ANGLES.map((f) => f(c.conceptVi || c.title)),
        attribution: `Ý tưởng tham khảo: ${c.creator ?? "không rõ tác giả"} — ${c.sourceUrl} (quan sát ${c.observedAt.slice(0, 10)})`,
        action: c.vnDuplicateFound && c.novelty < 0.4 ? ("SKIP_DUPLICATE" as const) : c.mediaRightsOk ? ("LICENSED_REUSE" as const) : ("ORIGINAL_REMAKE" as const),
        notes,
      };
    })
    .sort((a, b) => b.score - a.score);
}
