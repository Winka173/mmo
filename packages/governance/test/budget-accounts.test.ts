import { describe, expect, it } from "vitest";
import { DataStore } from "@ttm/storage";
import { BudgetRouter, MultiAccountManager, assertDestination, costPerPublishedPost, estimateElectricityUsd, type ProviderSpec } from "../src/index.js";
import { tmpDir } from "../../storage/test/helpers.js";

async function store() {
  const s = new DataStore(await tmpDir());
  await s.init();
  return s;
}

const local: ProviderSpec = { id: "espeak-ng", kind: "tts", local: true, quality: 0.3, category: "tts_chars", unit: "char", usdPerUnit: 0, available: () => true };
const cloud: ProviderSpec = { id: "cloud-tts", kind: "tts", local: false, quality: 0.9, category: "tts_chars", unit: "char", usdPerUnit: 0.00002, available: () => true };
const cloudLlm: ProviderSpec = { id: "paid-llm", kind: "llm", local: false, quality: 0.9, category: "llm_tokens", unit: "token", usdPerUnit: 0.00001, available: () => true };

describe("BudgetRouter (AA)", () => {
  it("prefers the local tool and never bills it", async () => {
    const s = await store();
    const r = new BudgetRouter(s, [cloud, local], () => s.getSettings());
    const d = await r.route({ kind: "tts", units: 1000, cloudEligible: true });
    expect(d).toMatchObject({ decision: "LOCAL", estimateUsd: 0 });
    expect(d.provider?.id).toBe("espeak-ng");
  });

  it("blocks cloud when not configured/allowlisted/above cap (default caps are $0)", async () => {
    const s = await store();
    const r = new BudgetRouter(s, [cloudLlm], () => s.getSettings());
    const notEligible = await r.route({ kind: "llm", units: 5000, cloudEligible: false });
    expect(notEligible.decision).toBe("BLOCKED");
    const notAllow = await r.route({ kind: "llm", units: 5000, cloudEligible: true });
    expect(notAllow.reasons.join()).toMatch(/allowlist/);
    await s.updateSettings((x) => ({ ...x, spend: { ...x.spend, paidProviderAllowlist: ["paid-llm"] } }), "t");
    const capZero = await r.route({ kind: "llm", units: 5000, cloudEligible: true });
    expect(capZero.decision).toBe("BLOCKED");
    expect(capZero.reasons.join()).toMatch(/vượt trần/);
    const none = await new BudgetRouter(s, [], () => s.getSettings()).route({ kind: "videogen", units: 5, cloudEligible: true });
    expect(none.reasons.join()).toMatch(/không có provider/);
  });

  it("reserves estimate before the call, settles receipt after, and hard-stops at the cap (budget exhausted mid-project)", async () => {
    const s = await store();
    await s.updateSettings((x) => ({ ...x, budgets: { ...x.budgets, monthlyUsdCap: 1, perVideoUsdCap: 0.12 }, spend: { ...x.spend, dailyUsdCap: 1, weeklyUsdCap: 1, paidProviderAllowlist: ["paid-llm"] } }), "t");
    const r = new BudgetRouter(s, [cloudLlm], () => s.getSettings());
    const d1 = await r.route({ kind: "llm", units: 5000, cloudEligible: true, projectId: "p1" });
    expect(d1).toMatchObject({ decision: "PAID", estimateUsd: 0.05 });
    if (d1.decision !== "PAID") throw new Error();
    await r.guard(d1, "p1");
    await r.settle(d1, { usd: 0.06, providerReported: true }, "p1");
    expect((await r.spend("p1")).project).toBeCloseTo(0.06);
    const d2 = await r.route({ kind: "llm", units: 5000, cloudEligible: true, projectId: "p1" });
    expect(d2.decision).toBe("PAID");
    const d3 = await r.route({ kind: "llm", units: 5000, cloudEligible: true, projectId: "p1" });
    expect(d3.decision).toBe("BLOCKED"); // 0.06 + 0.05 reserved + 0.05 > 0.12 per-video cap
    expect(d3.reasons.join()).toMatch(/trần video/);
    // kill switch flips mid-flight -> guard aborts before the network call
    await s.updateSettings((x) => ({ ...x, killSwitch: true }), "t");
    if (d2.decision !== "PAID") throw new Error();
    await expect(r.guard(d2, "p1")).rejects.toMatchObject({ code: "BUDGET_EXHAUSTED" });
  });

  it("cost per published post is unknown (null) without posts; electricity is null without a price", async () => {
    const s = await store();
    expect((await costPerPublishedPost(s, "2026-10")).perPostUsd).toBeNull();
    expect(estimateElectricityUsd(300, 3600, null)).toBeNull();
    expect(estimateElectricityUsd(300, 3600, 0.1)).toBeCloseTo(0.03);
  });
});

describe("MultiAccountManager (Z4)", () => {
  const gameA = { brand: "game-a", gameId: "game-a" };
  it("never posts game A to game B / Tủ Tò Mò accounts; requires allowlist + confirmation + correct remote identity", async () => {
    const s = await store();
    const m = new MultiAccountManager(s);
    await m.upsert({ id: "yt-game-a", platform: "youtube_shorts", owner: { kind: "game", id: "game-a" }, displayName: "Game A YT", expectedRemoteId: "UC_A", addedAt: "2026-10-01T00:00:00Z" }, "t");
    await m.upsert({ id: "yt-game-b", platform: "youtube_shorts", owner: { kind: "game", id: "game-b" }, displayName: "Game B YT", expectedRemoteId: "UC_B", addedAt: "2026-10-01T00:00:00Z" }, "t");
    await m.upsert({ id: "yt-tutomo", platform: "youtube_shorts", owner: { kind: "brand", id: "tutomo" }, displayName: "Tủ Tò Mò", expectedRemoteId: "UC_T", addedAt: "2026-10-01T00:00:00Z" }, "t");
    const wrong = await m.checkDestination({ project: gameA, platform: "youtube_shorts", accountId: "yt-game-b", gameAllowlist: ["yt-game-a"], connectedRemoteId: "UC_B" });
    expect(wrong).toMatchObject({ ok: false, code: "WRONG_ACCOUNT" });
    const brand = await m.checkDestination({ project: gameA, platform: "youtube_shorts", accountId: "yt-tutomo", gameAllowlist: ["yt-game-a"], connectedRemoteId: "UC_T" });
    expect(brand).toMatchObject({ ok: false, code: "WRONG_ACCOUNT" });
    const notAllow = await m.checkDestination({ project: gameA, platform: "youtube_shorts", accountId: "yt-game-a", gameAllowlist: [], connectedRemoteId: "UC_A" });
    expect(notAllow).toMatchObject({ ok: false, code: "NOT_ALLOWLISTED" });
    const unconfirmed = await m.checkDestination({ project: gameA, platform: "youtube_shorts", accountId: "yt-game-a", gameAllowlist: ["yt-game-a"], connectedRemoteId: "UC_A" });
    expect(unconfirmed).toMatchObject({ ok: false, code: "DESTINATION_CONFIRM_REQUIRED" });
    await m.confirm("yt-game-a", "owner");
    const swapped = await m.checkDestination({ project: gameA, platform: "youtube_shorts", accountId: "yt-game-a", gameAllowlist: ["yt-game-a"], connectedRemoteId: "UC_B" });
    expect(swapped).toMatchObject({ ok: false, code: "WRONG_ACCOUNT" }); // account swapped behind the credential
    const ok = await m.checkDestination({ project: gameA, platform: "youtube_shorts", accountId: null, gameAllowlist: ["yt-game-a"], connectedRemoteId: "UC_A" });
    expect(assertDestination(ok).id).toBe("yt-game-a");
    expect(() => assertDestination(wrong)).toThrow(/thuộc game:game-b/);
  });

  it("changing an account's owner or remote id invalidates its confirmation", async () => {
    const s = await store();
    const m = new MultiAccountManager(s);
    await m.upsert({ id: "fb-a", platform: "facebook", owner: { kind: "game", id: "game-a" }, displayName: "A", expectedRemoteId: "1", addedAt: "2026-10-01T00:00:00Z" }, "t");
    await m.confirm("fb-a", "owner");
    const changed = await m.upsert({ id: "fb-a", platform: "facebook", owner: { kind: "game", id: "game-a" }, displayName: "A", expectedRemoteId: "2", addedAt: "2026-10-01T00:00:00Z" }, "t");
    expect(changed.confirmedAt).toBeNull();
    expect(changed.credentialRef).toBe("acct.fb-a");
  });
});
