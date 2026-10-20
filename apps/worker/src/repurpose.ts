import { FactoryError, nowIso } from "@ttm/core";
import { TopicBrief, selectSegments, shortReleaseDates, standaloneShortBrief } from "@ttm/providers";
import { readJson, writeJsonAtomic } from "@ttm/storage";
import { z } from "zod";
import type { Ctx } from "./context.js";

/**
 * LongToShorts: derive 2–5 standalone Shorts from an OWNED/licensed long project. Children share
 * the lineage id (originality engine treats them as own distribution) and get spaced release dates.
 */
export async function deriveShortsFromLong(ctx: Ctx, longId: string, k = 3): Promise<{ created: string[]; rejected: string[]; releaseDates: string[] }> {
  const p = await ctx.store.getProject(longId);
  if (!p || !p.formats.includes("long_16x9")) throw new FactoryError("NOT_LONG", "PERMANENT", `${longId} không phải video dài`);
  const brief = await readJson(ctx.store.p("projects", longId, "brief.json"), TopicBrief);
  const sb = await ctx.store.getStoryboard(longId, "long_16x9", p.revision);
  const proof = await readJson(ctx.store.p("projects", longId, "renders", "long_16x9", "render-proof.json"), z.object({ sceneTimings: z.array(z.object({ sceneId: z.string(), start: z.number(), duration: z.number() })) }).passthrough());
  if (!brief || !sb || !proof) throw new FactoryError("LONG_NOT_RENDERED", "HUMAN_REQUIRED", "Video dài chưa được dựng — dựng trước rồi mới cắt Shorts");
  const rights = (await ctx.store.getRights(longId))!;
  const owned = rights.assets.every((a) => ["OWNED", "GENERATED_LOCAL"].includes(a.ownershipType));
  const rightsOk = rights.assets.every((a) => a.status === "VERIFIED" && a.adaptationAllowed !== false);
  const claims = await ctx.store.getClaims(longId);
  const { picks, rejected } = selectSegments({ long: brief, storyboard: sb, sceneTimings: proof.sceneTimings, claims, owned, rightsOk, k });
  const plan = await readJson(ctx.store.p("projects", longId, "plan.json"), z.record(z.any()));
  const created: string[] = [];
  for (const [i, pick] of picks.entries()) {
    const id = `${longId}-cut${i + 1}`.slice(0, 80);
    const t = nowIso();
    await ctx.store.saveProject({ schemaVersion: 1, id, brand: p.brand, gameId: p.gameId, lineageId: p.lineageId ?? longId, language: p.language, contentType: p.gameId ? "GAME_SHORT" : "FACT_SHORT", title: standaloneShortBrief(brief, pick, id, i + 1).title, mode: p.mode, status: "CANDIDATE", revision: 1, formats: ["short_9x16"], categories: p.categories, createdAt: t, updatedAt: t });
    await writeJsonAtomic(ctx.store.p("projects", id, "brief.json"), standaloneShortBrief(brief, pick, id, i + 1));
    await writeJsonAtomic(ctx.store.p("projects", id, "plan.json"), { ...(plan ?? {}), targets: ["youtube_shorts"], summary: `Trích từ video dài “${brief.title}” (${pick.start.toFixed(0)}–${pick.end.toFixed(0)}s)`, minSecOverride: null, signals: { recentRepeatPenalty: 0.2 } });
    await ctx.store.saveClaims(id, claims);
    await ctx.store.saveRights({ ...rights, projectId: id });
    await writeJsonAtomic(ctx.store.p("projects", id, "provenance.json"), { derivedFrom: longId, lineageId: p.lineageId ?? longId, segment: pick, at: t });
    created.push(id);
  }
  return { created, rejected, releaseDates: shortReleaseDates(new Date().toISOString().slice(0, 10), created.length, 2) };
}
