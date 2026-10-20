import { FactoryError, newId, type Settings } from "@ttm/core";
import { DataStore, readJsonl } from "@ttm/storage";
import { z } from "zod";

export const CostCategory = z.enum(["llm_tokens", "tts_chars", "asr_minutes", "video_gen_seconds", "image_gen", "stock_license", "judge", "translate", "gpu_encode", "electricity_estimate", "storage", "other"]);
export type CostCategory = z.infer<typeof CostCategory>;

export type ProviderKind = "llm" | "tts" | "asr" | "videogen" | "imagegen" | "judge" | "translate";

export type ProviderSpec = {
  id: string;
  kind: ProviderKind;
  /** local = runs on this PC, no per-call bill */
  local: boolean;
  /** relative capability 0..1 for routing */
  quality: number;
  category: CostCategory;
  unit: string;
  usdPerUnit: number;
  available: () => Promise<boolean> | boolean;
};

export type RouteRequest = {
  kind: ProviderKind;
  units: number;
  projectId?: string;
  /** minimum provider quality; local providers below this are skipped */
  minQuality?: number;
  /** the scene/task is allowed to use paid cloud at all (spec J: per-scene opt-in) */
  cloudEligible: boolean;
  /** expected value justification (shown in reports) */
  reason?: string;
};

export type RouteDecision =
  | { decision: "LOCAL"; provider: ProviderSpec; estimateUsd: 0; reasons: string[] }
  | { decision: "PAID"; provider: ProviderSpec; estimateUsd: number; ticketId: string; reasons: string[] }
  | { decision: "BLOCKED"; provider: null; estimateUsd: number; reasons: string[] };

type CostRow = { at: string; usd: number; projectId?: string; kind?: string; ticketId?: string; provider: string; category?: string };

/**
 * BudgetRouter: cheapest capable LOCAL tool first; paid cloud only when (a) the task is eligible,
 * (b) provider is explicitly allowlisted, (c) day/week/month/per-video caps all allow the estimate.
 * An estimate reservation is written BEFORE the call; the receipt (actual cost) after. A hard stop
 * is enforced by `guard()` immediately before the network call.
 */
export class BudgetRouter {
  constructor(
    private readonly store: DataStore,
    private readonly providers: ProviderSpec[],
    private readonly settings: () => Promise<Settings>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async rows(): Promise<CostRow[]> {
    const d = this.now();
    const months = new Set([d.toISOString().slice(0, 7), new Date(d.getTime() - 8 * 86400_000).toISOString().slice(0, 7)]);
    const out: CostRow[] = [];
    for (const m of months) out.push(...(await readJsonl<CostRow>(this.store.p("costs", `${m}.jsonl`))).records);
    return out;
  }

  /** Spend = receipts + open reservations (reservations without a settled receipt). */
  async spend(projectId?: string): Promise<{ day: number; week: number; month: number; project: number }> {
    const rows = await this.rows();
    const settled = new Set(rows.filter((r) => r.kind === "receipt" && r.ticketId).map((r) => r.ticketId));
    const effective = rows.filter((r) => r.kind !== "reservation" || !settled.has(r.ticketId));
    const t = this.now().getTime();
    const month = this.now().toISOString().slice(0, 7);
    const sum = (f: (r: CostRow) => boolean) => Math.round(effective.filter(f).reduce((a, r) => a + (Number(r.usd) || 0), 0) * 1e6) / 1e6;
    return {
      day: sum((r) => t - new Date(r.at).getTime() < 86400_000),
      week: sum((r) => t - new Date(r.at).getTime() < 7 * 86400_000),
      month: sum((r) => r.at.slice(0, 7) === month),
      project: projectId ? sum((r) => r.projectId === projectId) : 0,
    };
  }

  async capCheck(estimateUsd: number, projectId?: string): Promise<string[]> {
    const s = await this.settings();
    const sp = await this.spend(projectId);
    const reasons: string[] = [];
    if (s.killSwitch) reasons.push("kill switch đang bật — dừng mọi chi phí trả phí");
    const caps: [string, number, number][] = [
      ["ngày", s.spend.dailyUsdCap, sp.day],
      ["tuần", s.spend.weeklyUsdCap, sp.week],
      ["tháng", s.budgets.monthlyUsdCap, sp.month],
    ];
    if (projectId) caps.push(["video", s.budgets.perVideoUsdCap, sp.project]);
    for (const [name, cap, used] of caps) if (used + estimateUsd > cap + 1e-9) reasons.push(`vượt trần ${name}: đã dùng $${used.toFixed(4)} + ước tính $${estimateUsd.toFixed(4)} > trần $${cap.toFixed(2)}`);
    return reasons;
  }

  async route(req: RouteRequest): Promise<RouteDecision> {
    const reasons: string[] = [];
    const cands = this.providers.filter((p) => p.kind === req.kind && p.quality >= (req.minQuality ?? 0));
    for (const p of cands.filter((x) => x.local).sort((a, b) => b.quality - a.quality)) {
      if (await p.available()) return { decision: "LOCAL", provider: p, estimateUsd: 0, reasons: [`dùng công cụ local ${p.id} (miễn phí)`] };
      reasons.push(`${p.id}: local nhưng chưa sẵn sàng`);
    }
    if (!req.cloudEligible) return { decision: "BLOCKED", provider: null, estimateUsd: 0, reasons: [...reasons, "tác vụ không được phép dùng cloud trả phí"] };
    const s = await this.settings();
    const paid = cands.filter((p) => !p.local).sort((a, b) => a.usdPerUnit - b.usdPerUnit);
    if (!paid.length) return { decision: "BLOCKED", provider: null, estimateUsd: 0, reasons: [...reasons, `không có provider ${req.kind} nào được cấu hình`] };
    for (const p of paid) {
      if (!s.spend.paidProviderAllowlist.includes(p.id)) {
        reasons.push(`${p.id}: chưa nằm trong allowlist trả phí`);
        continue;
      }
      if (!(await p.available())) {
        reasons.push(`${p.id}: chưa cấu hình credential`);
        continue;
      }
      const est = Math.round(p.usdPerUnit * req.units * 1e6) / 1e6;
      const cap = await this.capCheck(est, req.projectId);
      if (cap.length) return { decision: "BLOCKED", provider: null, estimateUsd: est, reasons: [...reasons, ...cap] };
      const ticketId = newId("cost_");
      await this.store.recordCost({ provider: p.id, usd: est, projectId: req.projectId, estimated: true, category: p.category, units: req.units, unit: p.unit, ticketId, note: req.reason, kind: "reservation" });
      return { decision: "PAID", provider: p, estimateUsd: est, ticketId, reasons: [...reasons, `ước tính $${est} (${req.units} ${p.unit})`] };
    }
    return { decision: "BLOCKED", provider: null, estimateUsd: 0, reasons };
  }

  /** Called right before the network request: aborts if caps were reached meanwhile (excluding own reservation). */
  async guard(d: Extract<RouteDecision, { decision: "PAID" }>, projectId?: string): Promise<void> {
    const reasons = await this.capCheck(0, projectId);
    if (reasons.length) throw new FactoryError("BUDGET_EXHAUSTED", "BLOCKED", `Hủy gọi ${d.provider.id}: ${reasons.join("; ")}`, { provider: d.provider.id, nextAction: "Tăng trần trong Cài đặt → Ngân sách hoặc dùng công cụ local" });
  }

  /** Record actual billed cost (receipt). Prefer provider-reported numbers; mark estimated if not. */
  async settle(d: Extract<RouteDecision, { decision: "PAID" }>, actual: { usd: number; providerReported: boolean; fx?: { currency: string; amount: number; rate: number; source: string; at: string } }, projectId?: string): Promise<void> {
    await this.store.recordCost({ provider: d.provider.id, usd: actual.usd, projectId, estimated: !actual.providerReported, category: d.provider.category, ticketId: d.ticketId, fx: actual.fx ?? null, kind: "receipt" });
  }
}

/** Cost per successfully published post (not per attempt), by month. Unknown when no posts. */
export async function costPerPublishedPost(store: DataStore, month: string): Promise<{ totalUsd: number; published: number; perPostUsd: number | null }> {
  const totalUsd = await store.monthCostUsd(month);
  let published = 0;
  for (const p of await store.listProjects())
    for (const pub of await store.getPublications(p.id)) if (pub.state === "PUBLISHED" && pub.confirmedAt?.startsWith(month)) published++;
  return { totalUsd, published, perPostUsd: published ? Math.round((totalUsd / published) * 10000) / 10000 : null };
}

/** Electricity is an ESTIMATE: GPU/CPU watts × hours × configured price; null when price unset. */
export function estimateElectricityUsd(watts: number, seconds: number, usdPerKwh: number | null): number | null {
  if (usdPerKwh === null) return null;
  return Math.round(((watts * seconds) / 3600 / 1000) * usdPerKwh * 1e6) / 1e6;
}

