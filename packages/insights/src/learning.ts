import * as fs from "node:fs/promises";
import { nowIso, type Settings } from "@ttm/core";
import { DataStore, readJson, writeJsonAtomic } from "@ttm/storage";
import { z } from "zod";

export type PostFeatures = {
  projectId: string;
  platform: string;
  family: string;
  hookCategory: "question" | "number" | "statement" | "challenge";
  lengthSec: number;
  secPerShot: number;
  wordsPerSec: number;
  publishHour: number;
  thumbnailLayout: string | null;
  ctaType: string;
  /** editorial/quality context — proposals that trade quality for reach are rejected */
  editorialScore: number | null;
  accuracyOk: boolean;
};
export type Observation = PostFeatures & { metric: number | null; window: string; isFixture: boolean };

export function hookCategory(hook: string): PostFeatures["hookCategory"] {
  if (/\?|vì sao|tại sao|có biết|làm sao|bao nhiêu/i.test(hook)) return "question";
  if (/\d/.test(hook)) return "number";
  if (/thử|thách|dám|bạn có thể/i.test(hook)) return "challenge";
  return "statement";
}

const CLICKBAIT = /(sốc|không thể tin|bí mật mà|100%|chấn động|ai cũng phải)/i;

const lengthBucket = (s: number) => (s < 20 ? "<20s" : s < 40 ? "20-40s" : s < 60 ? "40-60s" : "≥60s");
const hourBucket = (h: number) => (h < 11 ? "sáng" : h < 17 ? "chiều" : "tối");

/** Welch's t on log-metric; two-sided p via normal approximation (adequate for n ≥ 5 per arm). */
export function welch(a: number[], b: number[]): { diff: number; p: number; ci95: [number, number] } {
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const v = (x: number[], m: number) => x.reduce((s, y) => s + (y - m) ** 2, 0) / Math.max(1, x.length - 1);
  const ma = mean(a);
  const mb = mean(b);
  const se = Math.sqrt(v(a, ma) / a.length + v(b, mb) / b.length) || 1e-9;
  const z = (ma - mb) / se;
  const p = 2 * (1 - normCdf(Math.abs(z)));
  return { diff: ma - mb, p, ci95: [ma - mb - 1.96 * se, ma - mb + 1.96 * se] };
}
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

export const Lesson = z.object({
  id: z.string(),
  scope: z.object({ family: z.string(), platform: z.string() }),
  dimension: z.string(),
  bucket: z.string(),
  statement: z.string(),
  effectPct: z.number(),
  ci95Pct: z.tuple([z.number(), z.number()]),
  p: z.number(),
  nBucket: z.number(),
  nOther: z.number(),
  evidence: z.string(),
  causality: z.literal("observational — không chứng minh nhân quả"),
  status: z.enum(["supported", "insufficient", "rejected_quality_guard"]),
  createdAt: z.string(),
});
export type Lesson = z.infer<typeof Lesson>;

export const Proposal = z.object({
  id: z.string(),
  change: z.string(),
  kind: z.enum(["cadence", "publish_hour", "length", "hook_style", "thumbnail_layout", "cta"]),
  evidence: z.string(),
  uncertainty: z.string(),
  expectedGainPct: z.number(),
  sampleSize: z.number(),
  rollbackPlan: z.string(),
  abEligible: z.boolean(),
  /** brand/major strategy changes always need an editor */
  requiresEditorialReview: z.boolean(),
  status: z.enum(["proposed", "applied", "rejected", "pending_review", "rolled_back"]),
  createdAt: z.string(),
});
export type Proposal = z.infer<typeof Proposal>;

export const LearnedSettings = z.object({
  version: z.number().int(),
  /** per "owner:platform" posts/day */
  cadence: z.record(z.number()).default({}),
  preferredHours: z.record(z.array(z.number())).default({}),
  updatedAt: z.string(),
  history: z.array(z.object({ version: z.number(), at: z.string(), change: z.string(), by: z.string() })).default([]),
});
export type LearnedSettings = z.infer<typeof LearnedSettings>;

/**
 * SelfLearningContentEngine: compares within family+platform against a baseline, only with enough
 * samples, reports uncertainty, never claims causation, and never trades accuracy/rights/quality
 * for reach (quality guard is applied BEFORE any proposal). Automatic changes are bounded and can
 * be frozen or undone; brand-level changes go to an editor.
 */
export class SelfLearningEngine {
  constructor(private readonly store: DataStore) {}
  private f(n: string) {
    return this.store.p("learning", n);
  }

  analyze(obs: Observation[], cfg: Settings["learning"]): { lessons: Lesson[]; proposals: Proposal[]; skipped: string[] } {
    const lessons: Lesson[] = [];
    const proposals: Proposal[] = [];
    const skipped: string[] = [];
    const live = obs.filter((o) => !o.isFixture);
    const usable = live.filter((o) => o.metric !== null && o.metric >= 0);
    if (live.length - usable.length) skipped.push(`${live.length - usable.length} bài thiếu số liệu (không coi là 0)`);
    if (obs.length - live.length) skipped.push(`${obs.length - live.length} quan sát fixture bị loại khỏi phân tích thật`);
    const groups = new Map<string, Observation[]>();
    for (const o of usable) groups.set(`${o.family}|${o.platform}`, [...(groups.get(`${o.family}|${o.platform}`) ?? []), o]);
    const dims: [string, (o: Observation) => string, Proposal["kind"]][] = [
      ["hookCategory", (o) => o.hookCategory, "hook_style"],
      ["length", (o) => lengthBucket(o.lengthSec), "length"],
      ["publishHour", (o) => hourBucket(o.publishHour), "publish_hour"],
      ["thumbnailLayout", (o) => o.thumbnailLayout ?? "không rõ", "thumbnail_layout"],
      ["ctaType", (o) => o.ctaType, "cta"],
    ];
    for (const [key, list] of groups) {
      const [family, platform] = key.split("|");
      if (list.length < cfg.minSamplePerArm * 2) {
        skipped.push(`${family}/${platform}: ${list.length} bài < ${cfg.minSamplePerArm * 2} — chưa đủ mẫu, ưu tiên khám phá`);
        continue;
      }
      for (const [dim, fn, kind] of dims) {
        const buckets = new Map<string, Observation[]>();
        for (const o of list) buckets.set(fn(o), [...(buckets.get(fn(o)) ?? []), o]);
        for (const [b, inB] of buckets) {
          const out = list.filter((o) => fn(o) !== b);
          if (inB.length < cfg.minSamplePerArm || out.length < cfg.minSamplePerArm) continue;
          const t = welch(inB.map((o) => Math.log1p(o.metric!)), out.map((o) => Math.log1p(o.metric!)));
          const effectPct = Math.round((Math.exp(t.diff) - 1) * 1000) / 10;
          const ci: [number, number] = [Math.round((Math.exp(t.ci95[0]) - 1) * 1000) / 10, Math.round((Math.exp(t.ci95[1]) - 1) * 1000) / 10];
          const qualityDrop = inB.some((o) => !o.accuracyOk) || mean(inB.map((o) => o.editorialScore ?? 70)) < mean(out.map((o) => o.editorialScore ?? 70)) - 10;
          const status: Lesson["status"] = t.p >= 0.1 ? "insufficient" : qualityDrop ? "rejected_quality_guard" : "supported";
          const lesson = Lesson.parse({
            id: `${family}-${platform}-${dim}-${b}`.replace(/[^a-zA-Z0-9-]/g, "_"),
            scope: { family, platform },
            dimension: dim,
            bucket: b,
            statement: `${dim}=${b}: ${effectPct >= 0 ? "+" : ""}${effectPct}% lượt xem so với phần còn lại`,
            effectPct,
            ci95Pct: ci,
            p: Math.round(t.p * 1000) / 1000,
            nBucket: inB.length,
            nOther: out.length,
            evidence: `${inB.length} vs ${out.length} bài, chỉ số log(views ${list[0].window})`,
            causality: "observational — không chứng minh nhân quả",
            status,
            createdAt: nowIso(),
          });
          lessons.push(lesson);
          if (status === "supported" && effectPct > 5)
            proposals.push(
              Proposal.parse({
                id: `p-${lesson.id}`,
                change: `Ưu tiên ${dim}=${b} cho ${family}/${platform}`,
                kind,
                evidence: lesson.evidence,
                uncertainty: `CI95 ${ci[0]}%..${ci[1]}%, p=${lesson.p} (quan sát, có thể nhiễu do thuật toán nền tảng)`,
                expectedGainPct: Math.max(0, ci[0]),
                sampleSize: inB.length + out.length,
                rollbackPlan: "Hoàn tác về learned-settings phiên bản trước (factory learning undo); giữ tỉ lệ khám phá",
                abEligible: ["hook_style", "thumbnail_layout", "publish_hour", "length", "cta"].includes(kind),
                requiresEditorialReview: kind === "hook_style" || kind === "cta",
                status: kind === "hook_style" || kind === "cta" ? "pending_review" : "proposed",
                createdAt: nowIso(),
              }),
            );
        }
      }
    }
    // headline-level clickbait guard on proposals that only came from sensational hooks
    return { lessons, proposals: proposals.filter((p) => !CLICKBAIT.test(p.change)), skipped };
  }

  /** ε-greedy with mandatory coverage before enough data: exploration never drops to 0. */
  chooseVariant<T extends string>(options: T[], history: Record<string, { n: number; meanLog: number }>, cfg: Settings["learning"], rand = Math.random): { choice: T; mode: "explore" | "exploit"; reason: string } {
    const under = options.filter((o) => (history[o]?.n ?? 0) < cfg.minSamplePerArm);
    if (under.length) return { choice: under[Math.floor(rand() * under.length)], mode: "explore", reason: `chưa đủ ${cfg.minSamplePerArm} mẫu cho ${under.join(", ")}` };
    if (rand() < cfg.explorationRatio) return { choice: options[Math.floor(rand() * options.length)], mode: "explore", reason: `khám phá ${Math.round(cfg.explorationRatio * 100)}%` };
    const best = [...options].sort((a, b) => history[b].meanLog - history[a].meanLog)[0];
    return { choice: best, mode: "exploit", reason: `khai thác phương án tốt nhất hiện tại (${best})` };
  }

  async getLearned(): Promise<LearnedSettings> {
    return (await readJson(this.f("learned-settings.json"), LearnedSettings)) ?? LearnedSettings.parse({ version: 0, updatedAt: nowIso() });
  }

  /**
   * Bounded cadence change: at most ±maxCadenceShiftPerWeek relative to the value a week ago.
   * Frozen => no change. Every version kept for undo.
   */
  async applyCadence(ownerPlatform: string, target: number, cfg: Settings["learning"], by: string): Promise<{ applied: number | null; reason: string }> {
    if (cfg.frozen) return { applied: null, reason: "học tự động đang bị đóng băng (frozen)" };
    const cur = await this.getLearned();
    const now = Date.now();
    const weekAgo = [...cur.history].reverse().find((h) => now - new Date(h.at).getTime() >= 7 * 86400_000);
    const baseVersion = weekAgo ? await readJson(this.f(`history/learned-settings.v${weekAgo.version}.json`), LearnedSettings) : null;
    const base = (baseVersion ?? cur).cadence[ownerPlatform] ?? cur.cadence[ownerPlatform] ?? 1;
    const lo = base * (1 - cfg.maxCadenceShiftPerWeek);
    const hi = base * (1 + cfg.maxCadenceShiftPerWeek);
    const applied = Math.round(Math.min(hi, Math.max(lo, target)) * 100) / 100;
    const next = LearnedSettings.parse({ ...cur, version: cur.version + 1, cadence: { ...cur.cadence, [ownerPlatform]: applied }, updatedAt: nowIso(), history: [...cur.history, { version: cur.version + 1, at: nowIso(), change: `${ownerPlatform}: ${cur.cadence[ownerPlatform] ?? base} → ${applied}/ngày (mục tiêu ${target}, giới hạn ±${cfg.maxCadenceShiftPerWeek * 100}%/tuần)`, by }] });
    await writeJsonAtomic(this.f(`history/learned-settings.v${next.version}.json`), next, { keepBackup: false });
    await writeJsonAtomic(this.f("learned-settings.json"), next);
    await this.store.audit({ actor: by, action: "learning.apply", subject: ownerPlatform, detail: { target, applied } });
    return { applied, reason: applied !== target ? `giới hạn thay đổi tối đa ${cfg.maxCadenceShiftPerWeek * 100}%/tuần` : "áp dụng" };
  }

  async undo(by: string): Promise<LearnedSettings | null> {
    const cur = await this.getLearned();
    if (cur.version <= 1) return null;
    const prev = await readJson(this.f(`history/learned-settings.v${cur.version - 1}.json`), LearnedSettings);
    if (!prev) return null;
    const next = { ...prev, version: cur.version + 1, updatedAt: nowIso(), history: [...cur.history, { version: cur.version + 1, at: nowIso(), change: `hoàn tác về v${cur.version - 1}`, by }] };
    await writeJsonAtomic(this.f(`history/learned-settings.v${next.version}.json`), next, { keepBackup: false });
    await writeJsonAtomic(this.f("learned-settings.json"), next);
    return next;
  }

  async saveRun(r: { lessons: Lesson[]; proposals: Proposal[]; skipped: string[] }) {
    await writeJsonAtomic(this.f("lessons.json"), { updatedAt: nowIso(), lessons: r.lessons, skipped: r.skipped });
    const prevH = (await readJson(this.f("hypotheses.json"), z.object({ proposals: z.array(Proposal) }).passthrough()))?.proposals ?? [];
    const merged = [...prevH.filter((p) => !r.proposals.some((n) => n.id === p.id)), ...r.proposals];
    await writeJsonAtomic(this.f("hypotheses.json"), { updatedAt: nowIso(), proposals: merged });
    const failed = r.lessons.filter((l) => l.status === "rejected_quality_guard");
    if (failed.length) {
      const prevF = (await fs.readFile(this.f("failed-experiments.json"), "utf8").then((s) => JSON.parse(s).items as unknown[], () => [])) ?? [];
      await writeJsonAtomic(this.f("failed-experiments.json"), { items: [...prevF, ...failed.map((l) => ({ ...l, why: "tăng lượt xem nhưng giảm chất lượng/độ chính xác — bị chặn" }))] });
    }
  }
}

const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0);
