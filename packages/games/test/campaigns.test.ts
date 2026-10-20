import { describe, expect, it } from "vitest";
import { DataStore } from "@ttm/storage";
import { GameCampaignManager, GameRegistry, campaignSlots } from "../src/index.js";
import { tmpDir } from "../../storage/test/helpers.js";

async function setup() {
  const store = new DataStore(await tmpDir());
  await store.init();
  const games = new GameRegistry(store);
  await games.save({ gameId: "sky-forge", internalName: "SF", publicTitle: "Sky Forge", destinationAllowlist: ["yt-sky"], schedule: { postsPerWeek: 3, preferredHours: [18, 20] } }, "t");
  return { games, mgr: new GameCampaignManager(games) };
}

describe("GameCampaignManager", () => {
  it("refuses a launch countdown without a confirmed release date", async () => {
    const { mgr } = await setup();
    const r = await mgr.create({ campaignId: "launch-cd", gameId: "sky-forge", name: "Đếm ngược", kind: "countdown", objective: "follow", countdownTo: "2026-12-01", startDate: "2026-11-01" }, "t");
    expect(r.campaign).toBeNull();
    expect(r.issues.map((i) => i.code)).toContain("UNCONFIRMED_DATE");
  });
  it("downgrades a wishlist objective to follow when there is no store page; KPIs start unknown (null), not 0", async () => {
    const { mgr, games } = await setup();
    const r = await mgr.create({ campaignId: "devlog-s1", gameId: "sky-forge", name: "Devlog mùa 1", kind: "devlog", objective: "wishlist", startDate: "2026-11-02", endDate: "2026-11-30", targetAccounts: ["yt-sky"] }, "t");
    expect(r.campaign?.objective).toBe("follow");
    const k = await games.getKpis("sky-forge", "devlog-s1");
    expect(k!.metrics.every((m) => m.value === null)).toBe(true);
  });
  it("rejects accounts of other games; schedule never stacks two posts on one day", async () => {
    const { mgr, games } = await setup();
    const bad = await mgr.create({ campaignId: "x-acc", gameId: "sky-forge", name: "x", kind: "awareness", objective: "follow", targetAccounts: ["yt-machine-brigade"] }, "t");
    expect(bad.issues[0].code).toBe("NOT_ALLOWLISTED");
    const g = (await games.get("sky-forge"))!;
    const slots = campaignSlots(g, { campaignId: "a", gameId: "sky-forge", name: "a", kind: "awareness", objective: "follow", startDate: "2026-11-02", endDate: "2026-11-15" } as any);
    const days = slots.map((s) => new Date(new Date(s).getTime() + 7 * 3600_000).toISOString().slice(0, 10));
    expect(new Set(days).size).toBe(days.length);
    expect(slots[0]).toBe("2026-11-02T11:00:00.000Z"); // 18:00 Asia/Ho_Chi_Minh
  });
});
