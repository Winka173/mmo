import { nowIso } from "@ttm/core";
import { DataStore, readJson, writeJsonAtomic } from "@ttm/storage";
import { z } from "zod";
import { normCdf } from "./learning.js";

export const Experiment = z.object({
  id: z.string().regex(/^[a-z0-9-]{3,60}$/),
  hypothesis: z.string().min(10),
  variable: z.enum(["title", "thumbnail", "hook", "cta", "length", "narration", "posting_slot"]),
  /** platform_native = e.g. YouTube "Test & compare" run by the owner in Studio (no public API assumed) */
  design: z.enum(["platform_native", "temporal_matched", "sequential_series"]),
  owner: z.string(),
  platform: z.string(),
  primaryMetric: z.enum(["ctr", "views_7d", "avg_view_duration", "completion_rate", "clicks"]),
  guardrailMetric: z.enum(["completion_rate", "avg_view_duration", "none"]).default("completion_rate"),
  /** max relative drop allowed on guardrail before stopping (0.2 = −20%) */
  guardrailMaxDrop: z.number().min(0).max(1).default(0.2),
  minSamplePerArm: z.number().int().positive().default(8),
  maxDays: z.number().int().positive().default(28),
  arms: z.array(z.object({ id: z.string(), description: z.string(), projectIds: z.array(z.string()).default([]) })).min(2).max(4),
  status: z.enum(["draft", "running", "stopped", "concluded"]).default("draft"),
  startedAt: z.string().nullable().default(null),
  result: z
    .object({ verdict: z.enum(["WINNER", "NO_DIFFERENCE", "INCONCLUSIVE", "INSUFFICIENT_METRICS", "GUARDRAIL_STOP"]), winner: z.string().nullable(), detail: z.string(), p: z.number().nullable(), causalClaim: z.boolean(), at: z.string() })
    .nullable()
    .default(null),
});
export type Experiment = z.infer<typeof Experiment>;

export type ArmData = { armId: string; n: number; successes?: number | null; trials?: number | null; values?: (number | null)[]; guardrail?: (number | null)[] };

/** Two-proportion z-test (CTR-like metrics). */
export function twoProportion(s1: number, n1: number, s2: number, n2: number): number {
  const p = (s1 + s2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2)) || 1e-9;
  const z = (s1 / n1 - s2 / n2) / se;
  return 2 * (1 - normCdf(Math.abs(z)));
}

/**
 * ABTestingEngine: fail-closed. Winner only with minimum samples per arm, p < 0.05 and no guardrail
 * breach. Non-randomised designs (temporal/sequential) never claim causation. Experiments may not
 * publish near-identical variants to the same feed (the spam guard is checked on creation).
 */
export class ABTestingEngine {
  constructor(private readonly store: DataStore) {}
  private file(id: string) {
    return this.store.p("experiments", `${id}.json`);
  }

  /** Same-feed duplicate guard: variants must differ only in the tested variable and not be posted twice to one feed at once. */
  static validate(e: Experiment, opts: { sameFeedSimultaneous: boolean; affiliate: boolean }): string[] {
    const issues: string[] = [];
    if (opts.sameFeedSimultaneous && e.design !== "platform_native") issues.push("Không đăng hai video gần như giống nhau cùng lúc trên cùng một kênh — dùng thử nghiệm gốc của nền tảng hoặc thiết kế theo thời gian (temporal)");
    if (opts.affiliate && e.arms.some((a) => a.projectIds.length > 1)) issues.push("Không nhân bản bài affiliate để thử nghiệm (spam)");
    if (e.variable === "thumbnail" && e.design === "platform_native" && !/youtube/.test(e.platform)) issues.push("Thử nghiệm thumbnail gốc chỉ có trên YouTube (Studio) — chọn temporal_matched");
    return issues;
  }

  async create(input: z.input<typeof Experiment>, opts: { sameFeedSimultaneous?: boolean; affiliate?: boolean } = {}): Promise<{ experiment: Experiment | null; issues: string[] }> {
    const e = Experiment.parse(input);
    const issues = ABTestingEngine.validate(e, { sameFeedSimultaneous: !!opts.sameFeedSimultaneous, affiliate: !!opts.affiliate });
    if (issues.length) return { experiment: null, issues };
    await writeJsonAtomic(this.file(e.id), e);
    return { experiment: e, issues };
  }

  async get(id: string) {
    return readJson(this.file(id), Experiment);
  }

  async list(): Promise<Experiment[]> {
    const fs = await import("node:fs/promises");
    const out: Experiment[] = [];
    for (const n of await fs.readdir(this.store.p("experiments")).catch(() => [] as string[])) if (n.endsWith(".json")) {
      const e = await readJson(this.store.p("experiments", n), Experiment).catch(() => null);
      if (e) out.push(e);
    }
    return out;
  }

  evaluate(e: Experiment, data: ArmData[], now = new Date()): NonNullable<Experiment["result"]> {
    const at = nowIso(now);
    const randomised = e.design === "platform_native";
    const missing = data.filter((d) => (e.primaryMetric === "ctr" ? d.successes == null || d.trials == null : !d.values || d.values.some((v) => v === null)));
    if (missing.length) return { verdict: "INSUFFICIENT_METRICS", winner: null, detail: `Thiếu số liệu cho ${missing.map((m) => m.armId).join(", ")} — không kết luận (không coi thiếu là 0)`, p: null, causalClaim: false, at };
    const small = data.filter((d) => d.n < e.minSamplePerArm);
    if (small.length) return { verdict: "INCONCLUSIVE", winner: null, detail: `Chưa đủ mẫu: ${small.map((s) => `${s.armId}=${s.n}`).join(", ")} (cần ≥${e.minSamplePerArm}/nhánh)`, p: null, causalClaim: false, at };
    // guardrail
    if (e.guardrailMetric !== "none") {
      const g = data.map((d) => ({ id: d.armId, m: avg((d.guardrail ?? []).filter((x): x is number => x !== null)) }));
      const base = g[0].m;
      const breach = g.slice(1).find((x) => base !== null && x.m !== null && x.m < base * (1 - e.guardrailMaxDrop));
      if (breach) return { verdict: "GUARDRAIL_STOP", winner: null, detail: `Nhánh ${breach.id} làm ${e.guardrailMetric} giảm hơn ${e.guardrailMaxDrop * 100}% — dừng để bảo vệ chất lượng`, p: null, causalClaim: false, at };
    }
    let p: number;
    let best: string;
    if (e.primaryMetric === "ctr") {
      const [a, b] = data;
      p = twoProportion(a.successes!, a.trials!, b.successes!, b.trials!);
      best = a.successes! / a.trials! >= b.successes! / b.trials! ? a.armId : b.armId;
    } else {
      const [a, b] = data.map((d) => d.values!.map((v) => Math.log1p(v!)));
      const m = (x: number[]) => avg(x)!;
      const v = (x: number[]) => x.reduce((s, y) => s + (y - m(x)) ** 2, 0) / Math.max(1, x.length - 1);
      const z = (m(a) - m(b)) / (Math.sqrt(v(a) / a.length + v(b) / b.length) || 1e-9);
      p = 2 * (1 - normCdf(Math.abs(z)));
      best = m(a) >= m(b) ? data[0].armId : data[1].armId;
    }
    const pr = Math.round(p * 10000) / 10000;
    if (p < 0.05)
      return { verdict: "WINNER", winner: best, detail: `${best} tốt hơn (p=${pr})${randomised ? "" : " — thiết kế không ngẫu nhiên: chỉ là tương quan, không khẳng định nhân quả"}`, p: pr, causalClaim: randomised, at };
    return { verdict: "NO_DIFFERENCE", winner: null, detail: `Không có khác biệt có ý nghĩa (p=${pr})`, p: pr, causalClaim: false, at };
  }

  async conclude(id: string, data: ArmData[]): Promise<Experiment> {
    const e = await this.get(id);
    if (!e) throw new Error(`Không có thử nghiệm ${id}`);
    const started = e.startedAt ? new Date(e.startedAt).getTime() : Date.now();
    const result = this.evaluate(e, data);
    const timedOut = Date.now() - started > e.maxDays * 86400_000;
    const next = { ...e, result, status: (result.verdict === "WINNER" || result.verdict === "NO_DIFFERENCE" || result.verdict === "GUARDRAIL_STOP" || timedOut ? "concluded" : "running") as Experiment["status"] };
    await writeJsonAtomic(this.file(id), next);
    return next;
  }
}

const avg = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : null);
