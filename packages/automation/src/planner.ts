import { ContentType, scoreTopic, type Settings, type TopicSignals } from "@ttm/core";
import { z } from "zod";

export const TopicCandidate = z.object({
  id: z.string(),
  title: z.string(),
  contentType: ContentType,
  family: z.enum(["knowledgeFact", "affiliate", "adaptation", "longForm", "game"]),
  signals: z.custom<TopicSignals>(),
  rightsOk: z.boolean(),
  qualityOk: z.boolean(),
  source: z.string(),
});
export type TopicCandidate = z.infer<typeof TopicCandidate>;

export type PlanDecision = {
  chosen: { candidate: TopicCandidate; score: number; reason: string }[];
  rejected: { id: string; reasons: string[] }[];
};

/**
 * DailyTopicPlanner: picks up to `dailyCaps.shorts` candidates. Ratios are a rolling-horizon
 * target (not a per-day quota): families below target get a bonus, families above get a penalty.
 * Game content is routed separately and never counts toward the Tủ Tò Mò mix.
 */
export function planDay(input: {
  candidates: TopicCandidate[];
  settings: Settings;
  /** families of shorts produced in the rolling window (e.g. last 14 days) */
  recentFamilies: string[];
  slots?: number;
}): PlanDecision {
  const { settings } = input;
  const slots = input.slots ?? settings.dailyCaps.shorts;
  const ratios = settings.ratios as Record<string, number>;
  const total = Math.max(1, input.recentFamilies.length);
  const rejected: PlanDecision["rejected"] = [];
  const scored: { candidate: TopicCandidate; score: number; reason: string }[] = [];
  for (const c of input.candidates) {
    const r = scoreTopic(c.signals, { rightsOk: c.rightsOk, qualityOk: c.qualityOk }, settings.budgets.perVideoUsdCap);
    if (!r.eligible) {
      rejected.push({ id: c.id, reasons: r.reasons });
      continue;
    }
    const target = ratios[c.family] ?? 0;
    const actual = input.recentFamilies.filter((f) => f === c.family).length / total;
    const mixAdj = c.family === "game" ? 0 : Math.max(-0.2, Math.min(0.2, target - actual));
    scored.push({ candidate: c, score: Math.round((r.score + mixAdj) * 1000) / 1000, reason: `điểm ${r.score} + cân bằng tỉ lệ ${mixAdj.toFixed(2)}` });
  }
  scored.sort((a, b) => b.score - a.score);
  const chosen: PlanDecision["chosen"] = [];
  const usedFamilies = new Set<string>();
  // diversity: prefer distinct families when several slots
  for (const s of scored) {
    if (chosen.length >= slots) break;
    if (slots > 1 && usedFamilies.has(s.candidate.family) && scored.some((x) => !usedFamilies.has(x.candidate.family) && !chosen.includes(x))) continue;
    chosen.push(s);
    usedFamilies.add(s.candidate.family);
  }
  for (const s of scored) if (!chosen.includes(s)) rejected.push({ id: s.candidate.id, reasons: ["không được chọn hôm nay (điểm thấp hơn/đa dạng)"] });
  return { chosen, rejected };
}
