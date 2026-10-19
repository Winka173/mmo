import { Settings } from "@ttm/core";
import { DataStore } from "@ttm/storage";
import { describe, expect, it } from "vitest";
import { Cron, Scheduler, planDay } from "../src/index.js";
import { tmpDir } from "../../storage/test/helpers.js";

describe("Cron (Asia/Ho_Chi_Minh)", () => {
  it("matches wall-clock time in the configured timezone", () => {
    const c = new Cron("0 19 * * *", "Asia/Ho_Chi_Minh");
    expect(c.matches(new Date("2026-10-19T12:00:00Z"))).toBe(true); // 19:00 ICT
    expect(c.matches(new Date("2026-10-19T19:00:00Z"))).toBe(false);
    expect(c.next(new Date("2026-10-19T12:00:30Z"))?.toISOString()).toBe("2026-10-20T12:00:00.000Z");
    expect(() => new Cron("61 * * * *", "UTC")).toThrow();
  });
  it("handles DST zones by wall clock", () => {
    const c = new Cron("30 2 * * *", "America/New_York");
    expect(c.previous(new Date("2026-03-09T12:00:00Z"))?.toISOString()).toBe("2026-03-09T06:30:00.000Z");
  });
});

describe("Scheduler", () => {
  it("replays a missed slot exactly once after sleep/shutdown, and two instances don't double-run", async () => {
    const store = new DataStore(await tmpDir());
    await store.init();
    let now = new Date("2026-10-19T15:00:00Z"); // 22:00 ICT, report was due at 19:00 while PC was off
    const runs: string[] = [];
    const def = { name: "daily-report", cron: "0 19 * * *", run: async (slot: Date) => void runs.push(slot.toISOString()) };
    const a = new Scheduler(store, [def], "Asia/Ho_Chi_Minh", () => now);
    const b = new Scheduler(store, [def], "Asia/Ho_Chi_Minh", () => now);
    await Promise.all([a.tick(), b.tick()]);
    await a.tick();
    expect(runs).toEqual(["2026-10-19T12:00:00.000Z"]);
    now = new Date("2026-10-21T15:00:00Z"); // missed two days: only the latest slot runs
    await a.tick();
    expect(runs).toEqual(["2026-10-19T12:00:00.000Z", "2026-10-21T12:00:00.000Z"]);
  });
});

describe("DailyTopicPlanner", () => {
  const sig = { uniqueness: 0.7, factualConfidence: 0.7, mediaRightsConfidence: 1, audienceInterest: 0.6, visualFeasibility: 0.8, affiliatePotential: 0, costEstimateUsd: 0, recentRepeatPenalty: 0 };
  it("respects the daily cap, rejects rights failures and balances ratios", () => {
    const settings = Settings.parse({ schemaVersion: 1 });
    const d = planDay({
      settings,
      recentFamilies: ["knowledgeFact", "knowledgeFact", "knowledgeFact"],
      candidates: [
        { id: "fact", title: "f", contentType: "FACT_SHORT", family: "knowledgeFact", signals: sig, rightsOk: true, qualityOk: true, source: "t" },
        { id: "aff", title: "a", contentType: "AFFILIATE_REVIEW", family: "affiliate", signals: sig, rightsOk: true, qualityOk: true, source: "t" },
        { id: "bad", title: "b", contentType: "LICENSED_REPOST", family: "adaptation", signals: { ...sig, uniqueness: 1 }, rightsOk: false, qualityOk: true, source: "t" },
      ],
    });
    expect(d.chosen.map((c) => c.candidate.id)).toEqual(["aff"]);
    expect(d.rejected.find((r) => r.id === "bad")?.reasons[0]).toMatch(/quyền/);
  });
});
