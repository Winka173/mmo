import { DataStore } from "@ttm/storage";
import { Settings } from "@ttm/core";
import { describe, expect, it } from "vitest";
import { ABTestingEngine, AnalyticsStore, SelfLearningEngine, importMetricsCsv, importShopeeCsv, planSchedule, rankOpportunities, type Observation, type ScheduleConfig, type ScheduleItem } from "../src/index.js";
import { tmpDir } from "../../storage/test/helpers.js";

const store = async () => {
  const s = new DataStore(await tmpDir());
  await s.init();
  return s;
};
const learnCfg = Settings.parse({ schemaVersion: 1 }).learning;

describe("Analytics (W1): unknown ≠ 0", () => {
  it("CSV import keeps empty cells null; aggregates report known/unknown denominators; fixtures excluded", async () => {
    const a = new AnalyticsStore(await store());
    const r = await importMetricsCsv(a, "project_id,platform,window,views,clicks,completion_rate\np1,youtube_shorts,7d,1200,,45\np2,youtube_shorts,7d,,,\nbad,nowhere,7d,1,1,1");
    expect(r).toMatchObject({ imported: 2 });
    expect(r.errors).toHaveLength(1);
    await a.record({ id: "fx", projectId: "p3", platform: "youtube_shorts", window: "7d", capturedAt: new Date().toISOString(), source: "fixture", isFixture: true, views: 999999 });
    const agg: any = await a.rebuildAggregates();
    expect(agg.byPlatform.youtube_shorts.views7d).toEqual({ value: 1200, known: 1, unknown: 1 });
    expect(agg.byPlatform.youtube_shorts.clicks7d).toEqual({ value: null, known: 0, unknown: 2 });
    expect((await a.latest()).find((s) => s.projectId === "p1")?.completionRate).toBe(0.45);
  });
  it("affiliate revenue: latest stage per order; cancelled/refunded removed; no data => unknown", async () => {
    const a = new AnalyticsStore(await store());
    expect((await a.revenueSummary()).known).toBe(false);
    await importShopeeCsv(a, "order_id,order_time,status,commission,sub_id\nA1,2026-10-01T10:00:00Z,pending,5000,p1\nA1,2026-10-05T10:00:00Z,completed,5000,p1\nB2,2026-10-02T10:00:00Z,pending,7000,p2\nB2,2026-10-06T10:00:00Z,cancelled,7000,p2\nC3,2026-10-03T10:00:00Z,pending,3000,p1");
    const s = await a.revenueSummary();
    expect(s).toMatchObject({ orders: 3, approved: 5000, pending: 3000, cancelled: 1, net: 5000, gross: 8000 });
    expect(s.byProject).toEqual({ p1: 5000 });
  });
});

describe("SelfLearningEngine (W2)", () => {
  const mk = (n: number, hook: Observation["hookCategory"], base: number, extra: Partial<Observation> = {}): Observation[] =>
    Array.from({ length: n }, (_, i) => ({ projectId: `${hook}-${i}`, platform: "youtube_shorts", family: "knowledgeFact", hookCategory: hook, lengthSec: 35, secPerShot: 4, wordsPerSec: 2.5, publishHour: 19, thumbnailLayout: "left-text", ctaType: "follow", editorialScore: 80, accuracyOk: true, metric: base * (1 + ((i * 7) % 5) / 20), window: "7d", isFixture: false, ...extra }));
  it("small samples => no lesson (exploration); missing metrics are skipped, not zero", () => {
    const eng = new SelfLearningEngine(null as any);
    const r = eng.analyze([...mk(3, "question", 1000), ...mk(2, "statement", 300), ...mk(2, "number", 0, { metric: null })], learnCfg);
    expect(r.lessons).toHaveLength(0);
    expect(r.skipped.join()).toMatch(/chưa đủ mẫu/);
    expect(r.skipped.join()).toMatch(/thiếu số liệu/);
  });
  it("enough samples => observational lesson with CI + p; brand-level changes need editorial review", () => {
    const eng = new SelfLearningEngine(null as any);
    const r = eng.analyze([...mk(8, "question", 3000), ...mk(8, "statement", 800)], learnCfg);
    const l = r.lessons.find((x) => x.dimension === "hookCategory" && x.bucket === "question")!;
    expect(l.status).toBe("supported");
    expect(l.causality).toMatch(/không chứng minh nhân quả/);
    expect(l.nBucket).toBe(8);
    const p = r.proposals.find((x) => x.kind === "hook_style")!;
    expect(p.requiresEditorialReview).toBe(true);
    expect(p.status).toBe("pending_review");
  });
  it("quality guard: a bucket that wins on views but loses accuracy is rejected (clickbait overfit)", () => {
    const eng = new SelfLearningEngine(null as any);
    const r = eng.analyze([...mk(8, "challenge", 5000, { accuracyOk: false, editorialScore: 40 }), ...mk(8, "statement", 800)], learnCfg);
    expect(r.lessons.find((x) => x.bucket === "challenge")?.status).toBe("rejected_quality_guard");
    expect(r.proposals.find((x) => x.change.includes("challenge"))).toBeUndefined();
  });
  it("bounded cadence change (≤20%/week), freeze and undo", async () => {
    const s = await store();
    const eng = new SelfLearningEngine(s);
    expect((await eng.applyCadence("tutomo:youtube_shorts", 3, learnCfg, "test")).applied).toBe(1.2);
    expect((await eng.applyCadence("tutomo:youtube_shorts", 3, { ...learnCfg, frozen: true }, "test")).applied).toBeNull();
    await eng.applyCadence("tutomo:youtube_shorts", 1.1, learnCfg, "test");
    const u = await eng.undo("test");
    expect(u?.cadence["tutomo:youtube_shorts"]).toBe(1.2);
    expect(eng.chooseVariant(["a", "b"], { a: { n: 1, meanLog: 5 }, b: { n: 9, meanLog: 6 } }, learnCfg, () => 0.9).mode).toBe("explore");
  });
});

describe("ABTestingEngine (W3)", () => {
  it("refuses near-identical simultaneous posts on the same feed; fail-closed on missing metrics; winner needs samples + significance", async () => {
    const eng = new ABTestingEngine(await store());
    const base = { id: "thumb-test-1", hypothesis: "Thumbnail có chữ lớn tăng CTR", variable: "thumbnail" as const, owner: "tutomo", platform: "youtube_long", primaryMetric: "ctr" as const, arms: [{ id: "A", description: "chữ trái" }, { id: "B", description: "dải dưới" }] };
    const bad = await eng.create({ ...base, design: "temporal_matched" }, { sameFeedSimultaneous: true });
    expect(bad.issues[0]).toMatch(/Không đăng hai video gần như giống nhau/);
    const { experiment } = await eng.create({ ...base, design: "platform_native" });
    const e = experiment!;
    expect(eng.evaluate(e, [{ armId: "A", n: 20, successes: null, trials: null }, { armId: "B", n: 20, successes: 10, trials: 100 }]).verdict).toBe("INSUFFICIENT_METRICS");
    expect(eng.evaluate(e, [{ armId: "A", n: 3, successes: 9, trials: 100, guardrail: [] }, { armId: "B", n: 3, successes: 2, trials: 100, guardrail: [] }]).verdict).toBe("INCONCLUSIVE");
    const win = eng.evaluate(e, [{ armId: "A", n: 20, successes: 120, trials: 2000, guardrail: [0.5, 0.5] }, { armId: "B", n: 20, successes: 60, trials: 2000, guardrail: [0.48, 0.5] }]);
    expect(win).toMatchObject({ verdict: "WINNER", winner: "A", causalClaim: true });
    const temporal = { ...e, design: "temporal_matched" as const };
    expect(eng.evaluate(temporal, [{ armId: "A", n: 20, successes: 120, trials: 2000, guardrail: [0.5] }, { armId: "B", n: 20, successes: 60, trials: 2000, guardrail: [0.5] }]).causalClaim).toBe(false);
    expect(eng.evaluate(e, [{ armId: "A", n: 20, successes: 60, trials: 2000, guardrail: [0.6] }, { armId: "B", n: 20, successes: 120, trials: 2000, guardrail: [0.3] }]).verdict).toBe("GUARDRAIL_STOP");
  });
});

describe("SmartScheduleEngine (W4)", () => {
  const cfg: ScheduleConfig = {
    tzOffsetHours: 7,
    rules: { "lantern-hollow": { postsPerDay: 1, preferredHours: [19], minGapHours: 20 } },
    defaultRule: { postsPerDay: 1, preferredHours: [7, 19], minGapHours: 6 },
    quietHours: [0, 6],
    calendar: [{ date: "2026-10-22", label: "ngày nghỉ (ví dụ)", source: "config/calendar.json (người dùng xác nhận)", avoid: true }, { date: "2026-10-23", label: "không nguồn", source: "", avoid: true }],
    platformDailyQuota: { youtube_shorts: 6 },
    lineageSpacingDays: 2,
    booked: [{ owner: "tutomo", platform: "youtube_long", at: "2026-10-21T12:00:00Z", lineageId: "venus", isLongForm: true }],
  };
  it("after an outage spreads the backlog over future preferred slots (no midnight burst); honours holidays, embargo, lineage spacing", () => {
    const now = new Date("2026-10-21T00:30:00Z");
    const items: ScheduleItem[] = [1, 2, 3].map((i) => ({ id: `lh-${i}`, projectId: `lh-${i}`, owner: "lantern-hollow", platform: "youtube_shorts", priority: 5, lineageId: null, isLongForm: false, notBefore: null, freshUntil: null }));
    items.push({ id: "cut-1", projectId: "cut-1", owner: "tutomo", platform: "youtube_shorts", priority: 5, lineageId: "venus", isLongForm: false, notBefore: null, freshUntil: null });
    items.push({ id: "stale", projectId: "stale", owner: "tutomo", platform: "youtube_shorts", priority: 5, lineageId: null, isLongForm: false, notBefore: null, freshUntil: "2026-10-20T00:00:00Z" });
    items.push({ id: "embargo", projectId: "e", owner: "tutomo", platform: "facebook", priority: 1, lineageId: null, isLongForm: false, notBefore: "2026-10-25T00:00:00Z", freshUntil: null });
    const plan = planSchedule(items, cfg, now);
    const at = Object.fromEntries(plan.assigned.map((a) => [a.itemId, a.at]));
    const local = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString();
    expect(local(at["lh-1"]).slice(0, 13)).toBe("2026-10-21T19");
    expect(local(at["lh-2"]).slice(0, 10)).toBe("2026-10-23"); // 22nd is a verified holiday; 23rd entry has no source => ignored
    expect(local(at["lh-3"]).slice(0, 10)).toBe("2026-10-24");
    expect(plan.assigned.every((a) => { const h = new Date(local(a.at)).getUTCHours(); return h >= 6; })).toBe(true);
    expect(local(at["cut-1"]).slice(0, 10) >= "2026-10-23").toBe(true); // ≥2 days after own long video
    expect(at["embargo"] >= "2026-10-25").toBe(true);
    expect(plan.deferred.find((d) => d.itemId === "stale")?.reason).toMatch(/kiểm tra lại/);
  });
});

describe("OpportunityRadar (X1)", () => {
  it("penalises Vietnamese duplicates, labels sparse growth approximate, never invents followers, suggests original angles with attribution", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    const r = rankOpportunities(
      [
        { id: "a", title: "Đèn ngủ tự xoay", conceptVi: "đèn ngủ chiếu sao tự xoay", source: "douyin", sourceUrl: "https://douyin.example/a", creator: "nhà sáng tạo nhỏ", observedAt: "2026-10-19T12:00:00Z", novelty: 0.8, vnDuplicateFound: false, mediaRightsOk: false, value: 0.6, signals: [{ at: "2026-10-19T12:00:00Z", views: 100, likes: null, followers: null, source: "metadata" }, { at: "2026-10-20T12:00:00Z", views: 2500, likes: null, followers: null, source: "metadata" }] },
        { id: "b", title: "Trứng nổi nước muối", conceptVi: "trứng nổi", source: "xhs", sourceUrl: "https://xhs.example/b", creator: null, observedAt: "2026-10-19T12:00:00Z", novelty: 0.3, vnDuplicateFound: true, mediaRightsOk: false, value: 0.5, signals: [] },
      ],
      now,
    );
    expect(r[0].id).toBe("a");
    expect(r[0].growthLabel).toBe("xấp xỉ (dữ liệu thưa)");
    expect(r[0].notes.join()).toMatch(/không thấy số follower/);
    expect(r[0].action).toBe("ORIGINAL_REMAKE");
    expect(r[0].attribution).toMatch(/nhà sáng tạo nhỏ/);
    expect(r[1].action).toBe("SKIP_DUPLICATE");
    expect(r[1].growthLabel).toBe("không có dữ liệu");
  });
});
