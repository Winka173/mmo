/** Topic candidate scoring (spec D2). All inputs normalised 0..1; cost in USD. */
export type TopicSignals = {
  uniqueness: number;
  factualConfidence: number;
  mediaRightsConfidence: number;
  audienceInterest: number;
  visualFeasibility: number;
  affiliatePotential: number;
  costEstimateUsd: number;
  recentRepeatPenalty: number;
};

export type GateFlags = { rightsOk: boolean; qualityOk: boolean };

export function scoreTopic(s: TopicSignals, gates: GateFlags, perVideoBudgetUsd: number): { eligible: boolean; score: number; reasons: string[] } {
  const reasons: string[] = [];
  if (!gates.rightsOk) reasons.push("không qua cổng quyền sử dụng");
  if (!gates.qualityOk) reasons.push("không qua cổng chất lượng");
  if (s.costEstimateUsd > perVideoBudgetUsd) reasons.push(`chi phí ước tính ${s.costEstimateUsd}$ vượt hạn mức ${perVideoBudgetUsd}$`);
  const score =
    0.25 * s.uniqueness +
    0.2 * s.factualConfidence +
    0.15 * s.mediaRightsConfidence +
    0.15 * s.audienceInterest +
    0.1 * s.visualFeasibility +
    0.1 * s.affiliatePotential -
    0.3 * s.recentRepeatPenalty;
  return { eligible: reasons.length === 0, score: Math.round(score * 1000) / 1000, reasons };
}

/** Discovery scoring with configurable weights; rights is a HARD gate (spec O4). */
export const DEFAULT_DISCOVERY_WEIGHTS = {
  novelty: 35,
  marketDuplication: 25,
  contentQuality: 15,
  evidenceConfidence: 10,
  rightsConfidence: 10,
  productionFit: 5,
};
export type DiscoveryWeights = typeof DEFAULT_DISCOVERY_WEIGHTS;

export type DiscoverySignals = {
  novelty: number;
  /** 0 = heavy duplication found in checked market sources, 1 = not found in checked sources. */
  marketDuplication: number;
  contentQuality: number;
  evidenceConfidence: number;
  rightsConfidence: number;
  productionFit: number;
};

export function scoreDiscovery(
  s: DiscoverySignals,
  opts: { rightsGatePassed: boolean; minNovelty?: number; weights?: DiscoveryWeights },
): { decision: "ACCEPT" | "DUPLICATE_REJECTED" | "RIGHTS_REJECTED" | "LOW_SCORE"; score: number; breakdown: Record<string, number> } {
  const w = opts.weights ?? DEFAULT_DISCOVERY_WEIGHTS;
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  const breakdown: Record<string, number> = {};
  let score = 0;
  for (const k of Object.keys(w) as (keyof DiscoveryWeights)[]) {
    breakdown[k] = Math.round((s[k] * w[k] * 10000) / total) / 100;
    score += breakdown[k];
  }
  score = Math.round(score * 100) / 100;
  if (!opts.rightsGatePassed) return { decision: "RIGHTS_REJECTED", score, breakdown };
  if (s.novelty < (opts.minNovelty ?? 0.35)) return { decision: "DUPLICATE_REJECTED", score, breakdown };
  return { decision: score >= 50 ? "ACCEPT" : "LOW_SCORE", score, breakdown };
}
