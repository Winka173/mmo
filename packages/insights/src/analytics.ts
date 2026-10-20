import { Platform, nowIso } from "@ttm/core";
import { DataStore, appendJsonl, readJsonl, writeJsonAtomic } from "@ttm/storage";
import { z } from "zod";

/** Every metric is nullable: null = not available/not authorised — NEVER coerced to 0. */
const M = z.number().nonnegative().nullable().default(null);

export const MetricWindow = z.enum(["1h", "24h", "7d", "28d", "lifetime"]);
export type MetricWindow = z.infer<typeof MetricWindow>;

export const MetricSnapshot = z.object({
  id: z.string(),
  projectId: z.string(),
  platform: Platform,
  remoteId: z.string().nullable().default(null),
  window: MetricWindow,
  /** when the platform says the numbers were last updated (freshness) */
  sourceUpdatedAt: z.string().nullable().default(null),
  capturedAt: z.string(),
  source: z.enum(["platform_api", "csv_import", "manual", "fixture"]),
  /** fixture data is always labelled and excluded from "live" reporting */
  isFixture: z.boolean().default(false),
  views: M,
  reach: M,
  impressions: M,
  watchTimeHours: M,
  avgViewDurationSec: M,
  /** 0..1 */
  completionRate: z.number().min(0).max(1).nullable().default(null),
  likes: M,
  comments: M,
  shares: M,
  saves: M,
  follows: M,
  clicks: M,
  purchases: M,
  restrictions: z.array(z.string()).default([]),
});
export type MetricSnapshot = z.infer<typeof MetricSnapshot>;

export const RevenueEvent = z.object({
  id: z.string(),
  program: z.enum(["shopee_affiliate", "game_store", "other"]),
  orderId: z.string(),
  projectId: z.string().nullable(),
  /** revenue stages: pending → approved → paid; cancelled/refunded adjust */
  stage: z.enum(["pending", "approved", "paid", "cancelled", "refunded"]),
  amount: z.number(),
  currency: z.string().default("VND"),
  fx: z.object({ toUsd: z.number(), source: z.string(), at: z.string() }).nullable().default(null),
  occurredAt: z.string(),
  importedAt: z.string(),
  source: z.enum(["csv_import", "api", "fixture"]),
});
export type RevenueEvent = z.infer<typeof RevenueEvent>;

const month = (iso: string) => iso.slice(0, 7);

/**
 * Analytics store: raw snapshots are immutable JSONL (one file per month); aggregates are derived
 * and rebuildable. Denominators and windows are always reported; unknown stays unknown.
 */
export class AnalyticsStore {
  constructor(private readonly store: DataStore) {}

  async record(s: z.input<typeof MetricSnapshot>): Promise<MetricSnapshot> {
    const v = MetricSnapshot.parse(s);
    await appendJsonl(this.store.p("analytics", "snapshots", `${month(v.capturedAt)}.jsonl`), v);
    return v;
  }

  async all(): Promise<MetricSnapshot[]> {
    const out: MetricSnapshot[] = [];
    const fs = await import("node:fs/promises");
    for (const n of (await fs.readdir(this.store.p("analytics", "snapshots")).catch(() => [] as string[])).sort())
      if (n.endsWith(".jsonl")) out.push(...(await readJsonl<MetricSnapshot>(this.store.p("analytics", "snapshots", n))).records.map((r) => MetricSnapshot.parse(r)));
    return out;
  }

  /** Latest snapshot per (project, platform, window). */
  async latest(opts: { includeFixtures?: boolean } = {}): Promise<MetricSnapshot[]> {
    const m = new Map<string, MetricSnapshot>();
    for (const s of await this.all()) {
      if (s.isFixture && !opts.includeFixtures) continue;
      const k = `${s.projectId}|${s.platform}|${s.window}`;
      const prev = m.get(k);
      if (!prev || prev.capturedAt < s.capturedAt) m.set(k, s);
    }
    return [...m.values()];
  }

  /** Derived, rebuildable aggregate file — safe to delete. */
  async rebuildAggregates(opts: { includeFixtures?: boolean } = {}) {
    const latest = await this.latest(opts);
    const sum = (xs: (number | null)[]) => {
      const known = xs.filter((x): x is number => x !== null);
      return { value: known.length ? known.reduce((a, b) => a + b, 0) : null, known: known.length, unknown: xs.length - known.length };
    };
    const byPlatform: Record<string, unknown> = {};
    for (const p of Platform.options) {
      const rows = latest.filter((s) => s.platform === p && s.window === "7d");
      byPlatform[p] = { posts: rows.length, views7d: sum(rows.map((r) => r.views)), clicks7d: sum(rows.map((r) => r.clicks)), follows7d: sum(rows.map((r) => r.follows)) };
    }
    const agg = { rebuiltAt: nowIso(), includesFixtures: !!opts.includeFixtures, window: "7d", byPlatform, note: "value=null nghĩa là không có dữ liệu (không phải 0); known/unknown là mẫu số" };
    await writeJsonAtomic(this.store.p("analytics", "aggregates.json"), agg, { keepBackup: false });
    return agg;
  }

  // ------------------------------------------------------------------ revenue
  async recordRevenue(e: z.input<typeof RevenueEvent>) {
    const v = RevenueEvent.parse(e);
    await appendJsonl(this.store.p("analytics", "revenue.jsonl"), v);
    return v;
  }

  /** Latest stage per order wins; cancelled/refunded => 0. Gross vs approved vs paid kept separate. */
  async revenueSummary(opts: { program?: RevenueEvent["program"]; includeFixtures?: boolean } = {}) {
    const { records } = await readJsonl<RevenueEvent>(this.store.p("analytics", "revenue.jsonl"));
    const last = new Map<string, RevenueEvent>();
    for (const r of records.map((x) => RevenueEvent.parse(x))) {
      if (opts.program && r.program !== opts.program) continue;
      if (r.source === "fixture" && !opts.includeFixtures) continue;
      const prev = last.get(`${r.program}:${r.orderId}`);
      if (!prev || prev.occurredAt <= r.occurredAt) last.set(`${r.program}:${r.orderId}`, r);
    }
    const out = { orders: last.size, pending: 0, approved: 0, paid: 0, cancelled: 0, refunded: 0, gross: 0, net: 0, currency: "VND", byProject: {} as Record<string, number> };
    for (const r of last.values()) {
      out[r.stage] += r.stage === "cancelled" || r.stage === "refunded" ? 1 : r.amount;
      if (!["cancelled", "refunded"].includes(r.stage)) out.gross += r.amount;
      if (r.stage === "approved" || r.stage === "paid") {
        out.net += r.amount;
        if (r.projectId) out.byProject[r.projectId] = (out.byProject[r.projectId] ?? 0) + r.amount;
      }
    }
    return { ...out, note: records.length ? "Hoa hồng có độ trễ; pending có thể bị hủy/hoàn — net chỉ tính approved+paid" : "Chưa nhập dữ liệu affiliate — doanh thu: KHÔNG RÕ (không phải 0)", known: records.length > 0 };
  }
}

const parseCsv = (csv: string): Record<string, string>[] => {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const split = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };
  const head = split(lines[0] ?? "").map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, "_"));
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
};
const num = (v: string | undefined) => (v === undefined || v === "" || /^(n\/?a|-|null|unknown)$/i.test(v) ? null : Number(v.replace(/,/g, "")));

/**
 * Import a platform analytics export (CSV). Expected columns (case-insensitive):
 * project_id, platform, remote_id, window, views, impressions, watch_time_hours, avg_view_duration_sec,
 * completion_rate, likes, comments, shares, saves, follows, clicks, updated_at. Empty cells => null.
 */
export async function importMetricsCsv(a: AnalyticsStore, csv: string, opts: { capturedAt?: string } = {}): Promise<{ imported: number; errors: string[] }> {
  const errors: string[] = [];
  let imported = 0;
  for (const [i, r] of parseCsv(csv).entries()) {
    const p = Platform.safeParse(r.platform);
    if (!r.project_id || !p.success) {
      errors.push(`dòng ${i + 2}: thiếu project_id hoặc platform không hợp lệ`);
      continue;
    }
    const cr = num(r.completion_rate);
    await a.record({
      id: `csv-${r.project_id}-${r.platform}-${r.window ?? "7d"}-${opts.capturedAt ?? nowIso()}-${i}`,
      projectId: r.project_id,
      platform: p.data,
      remoteId: r.remote_id || null,
      window: MetricWindow.safeParse(r.window).success ? (r.window as MetricWindow) : "7d",
      sourceUpdatedAt: r.updated_at || null,
      capturedAt: opts.capturedAt ?? nowIso(),
      source: "csv_import",
      views: num(r.views),
      impressions: num(r.impressions),
      watchTimeHours: num(r.watch_time_hours),
      avgViewDurationSec: num(r.avg_view_duration_sec),
      completionRate: cr === null ? null : cr > 1 ? cr / 100 : cr,
      likes: num(r.likes),
      comments: num(r.comments),
      shares: num(r.shares),
      saves: num(r.saves),
      follows: num(r.follows),
      clicks: num(r.clicks),
    });
    imported++;
  }
  return { imported, errors };
}

/** Shopee affiliate conversion report CSV (order_id, order_time, status, commission, sub_id/project_id). */
export async function importShopeeCsv(a: AnalyticsStore, csv: string, opts: { fx?: RevenueEvent["fx"] } = {}): Promise<{ imported: number; errors: string[] }> {
  const STAGE: Record<string, RevenueEvent["stage"]> = { pending: "pending", "đang chờ": "pending", completed: "approved", approved: "approved", "hoàn thành": "approved", paid: "paid", "đã thanh toán": "paid", cancelled: "cancelled", canceled: "cancelled", "đã hủy": "cancelled", refunded: "refunded", "hoàn tiền": "refunded" };
  const errors: string[] = [];
  let imported = 0;
  for (const [i, r] of parseCsv(csv).entries()) {
    const stage = STAGE[(r.status ?? "").toLowerCase()];
    const amt = num(r.commission ?? r.estimated_commission);
    if (!r.order_id || !stage || amt === null) {
      errors.push(`dòng ${i + 2}: thiếu order_id/status/commission`);
      continue;
    }
    await a.recordRevenue({ id: `shopee-${r.order_id}-${stage}`, program: "shopee_affiliate", orderId: r.order_id, projectId: r.project_id || r.sub_id || null, stage, amount: amt, currency: r.currency || "VND", fx: opts.fx ?? null, occurredAt: r.order_time || r.updated_at || nowIso(), importedAt: nowIso(), source: "csv_import" });
    imported++;
  }
  return { imported, errors };
}
