import { planSchedule } from "@ttm/insights";
import { readJson, type DataStore } from "@ttm/storage";
import { z } from "zod";
import { GameRegistry } from "./registry.js";

/** Schedule preview for ready projects (per owner/platform cadence, holidays, lineage spacing). */
export async function schedulePreview(store: DataStore) {
  const ctx = { store, settings: () => store.getSettings() };
  const games = new GameRegistry(ctx.store);
  const rules: Record<string, { postsPerDay: number; preferredHours: number[]; minGapHours: number }> = {};
  for (const g of await games.list()) rules[g.gameId] = { postsPerDay: 1, preferredHours: g.schedule.preferredHours, minGapHours: Math.max(12, Math.floor((7 * 24) / Math.max(1, g.schedule.postsPerWeek))) };
  const cal = (await readJson(ctx.store.p("config", "calendar.json"), z.object({ days: z.array(z.object({ date: z.string(), label: z.string(), source: z.string(), avoid: z.boolean() })) })))?.days ?? [];
  const s = await ctx.settings();
  const items = [];
  const booked = [];
  for (const p of await ctx.store.listProjects()) {
    for (const pub of await ctx.store.getPublications(p.id))
      if (pub.state === "PUBLISHED" && pub.confirmedAt) booked.push({ owner: p.gameId ?? p.brand, platform: pub.platform, at: pub.confirmedAt, lineageId: p.lineageId, isLongForm: pub.platform === "youtube_long" });
    if (p.mode !== "live" || !["READY_FOR_REVIEW", "AUTO_SAFE"].includes(p.status)) continue;
    const plan = await readJson(ctx.store.p("projects", p.id, "plan.json"), z.object({ targets: z.array(z.string()) }).passthrough()).catch(() => null);
    const game = p.gameId ? await games.get(p.gameId) : null;
    for (const t of plan?.targets ?? []) items.push({ id: `${p.id}:${t}`, projectId: p.id, owner: p.gameId ?? p.brand, platform: t, priority: 5, lineageId: p.lineageId, isLongForm: t === "youtube_long", notBefore: game?.embargoUntil ?? null, freshUntil: null });
  }
  return planSchedule(items, { tzOffsetHours: 7, rules, defaultRule: { postsPerDay: s.dailyCaps.shorts, preferredHours: [7, 19], minGapHours: 6 }, quietHours: [0, 6], calendar: cal, platformDailyQuota: { youtube_shorts: 6, youtube_long: 6 }, lineageSpacingDays: 2, booked }, new Date());
}

