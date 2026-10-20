import * as fs from "node:fs/promises";
import { nowIso, type Job } from "@ttm/core";
import { GameRegistry, buildFeatureMap, schedulePreview as gamesSchedulePreview } from "@ttm/games";
export const schedulePreview = (ctx: Ctx) => gamesSchedulePreview(ctx.store);
import { CommentAssistant, LifecycleManager, applyRecheck, recheckProduct, type FaqEntry, type IncomingComment } from "@ttm/governance";
import { AnalyticsStore, SelfLearningEngine, hookCategory, rankOpportunities, type Observation, type RadarCandidate } from "@ttm/insights";
import { readJson, readJsonl, writeJsonAtomic } from "@ttm/storage";
import { z } from "zod";
import { notify, type Ctx } from "./context.js";

/** LIFECYCLE_AUDIT: flags on already-published posts (rights, links, stale facts/prices, game drift). */
export async function handleLifecycle(ctx: Ctx): Promise<Record<string, unknown>> {
  const games = new GameRegistry(ctx.store);
  const flags = await new LifecycleManager(ctx.store, { fetchImpl: undefined, editCapable: () => false }).audit(new Date(), {
    gameFeatures: async (gameId) => {
      const v = await games.getFeatures(gameId);
      return buildFeatureMap({ verified: v.features, changelogs: [] }).map((f) => ({ name: f.name, keywords: f.keywords, status: f.status }));
    },
    latestBuild: async (gameId) => (await games.latestBuild(gameId))?.buildId ?? null,
  });
  if (flags.length) await notify(ctx, `🔁 Vòng đời nội dung: ${flags.length} vấn đề trên bài đã đăng\n${flags.slice(0, 8).map((f) => `• ${f.projectId} ${f.type}: ${f.detail} → ${f.action}`).join("\n")}`, { dedupeKey: `lifecycle:${ctx.store.today()}` });
  return { flags: flags.length, types: [...new Set(flags.map((f) => f.type))] };
}

/** METRICS_SNAPSHOT: pull what each authorised publisher exposes; unavailable => null, never 0. */
export async function handleMetrics(ctx: Ctx): Promise<Record<string, unknown>> {
  const a = new AnalyticsStore(ctx.store);
  let captured = 0;
  let unavailable = 0;
  for (const p of await ctx.store.listProjects()) {
    if (p.mode === "demo") continue;
    for (const pub of await ctx.store.getPublications(p.id)) {
      if (pub.state !== "PUBLISHED" || !pub.remoteId) continue;
      const publisher = ctx.publishers[pub.platform];
      const m = publisher ? await publisher.fetchMetrics(pub.remoteId).catch(() => null) : null;
      if (!m) {
        unavailable++;
        continue;
      }
      const ageH = pub.confirmedAt ? (Date.now() - new Date(pub.confirmedAt).getTime()) / 3600_000 : 0;
      const window = ageH < 2 ? "1h" : ageH < 30 ? "24h" : ageH < 8 * 24 ? "7d" : "28d";
      await a.record({ id: `api-${p.id}-${pub.platform}-${Date.now()}`, projectId: p.id, platform: pub.platform, remoteId: pub.remoteId, window, capturedAt: nowIso(), source: "platform_api", views: m.views ?? null, impressions: m.impressions ?? null, likes: m.likes ?? null, comments: m.comments ?? null, shares: m.shares ?? null, saves: m.saves ?? null, reach: m.reach ?? null });
      captured++;
    }
  }
  await a.rebuildAggregates();
  return { captured, unavailable };
}

/** LEARNING_UPDATE: build observations from real snapshots + project features, analyse, save. */
export async function handleLearning(ctx: Ctx): Promise<Record<string, unknown>> {
  const s = await ctx.settings();
  const a = new AnalyticsStore(ctx.store);
  const latest = await a.latest();
  const obs: Observation[] = [];
  for (const snap of latest.filter((x) => x.window === "7d")) {
    const p = await ctx.store.getProject(snap.projectId);
    if (!p) continue;
    const sb = await ctx.store.getStoryboard(p.id, p.formats[0], p.revision);
    const proof = await readJson(ctx.store.p("projects", p.id, "renders", p.formats[0], "render-proof.json"), z.object({ durationSec: z.number(), sceneTimings: z.array(z.any()) }).passthrough()).catch(() => null);
    const judge = await readJson(ctx.store.p("projects", p.id, "renders", p.formats[0], "judge-report.json"), z.object({ editorialScore: z.number() }).passthrough()).catch(() => null);
    const thumbs = await readJson(ctx.store.p("projects", p.id, "renders", p.formats[0], "thumbnails.json"), z.object({ selected: z.string().optional() }).passthrough()).catch(() => null);
    const pubs = await ctx.store.getPublications(p.id);
    const pub = pubs.find((x) => x.platform === snap.platform);
    const words = sb?.scenes.reduce((n, sc) => n + sc.narration.split(/\s+/).length, 0) ?? 0;
    const dur = proof?.durationSec ?? 30;
    obs.push({
      projectId: p.id,
      platform: snap.platform,
      family: p.gameId ? "game" : p.contentType,
      hookCategory: hookCategory(sb?.scenes[0]?.title ?? p.title),
      lengthSec: dur,
      secPerShot: dur / Math.max(1, proof?.sceneTimings.length ?? sb?.scenes.length ?? 1),
      wordsPerSec: words / Math.max(1, dur),
      publishHour: pub?.confirmedAt ? new Date(new Date(pub.confirmedAt).getTime() + 7 * 3600_000).getUTCHours() : 19,
      thumbnailLayout: thumbs?.selected?.match(/\.(left-text|bottom-band|clean-logo)\./)?.[1] ?? null,
      ctaType: p.productId ? "affiliate" : p.gameId ? "game" : "follow",
      editorialScore: judge?.editorialScore ?? null,
      accuracyOk: !["HOLD_FACTS", "HOLD_RIGHTS"].includes(p.status),
      metric: snap.views,
      window: "7d",
      isFixture: snap.isFixture,
    });
  }
  const eng = new SelfLearningEngine(ctx.store);
  const r = eng.analyze(obs, s.learning);
  await eng.saveRun(r);
  if (r.proposals.length) await notify(ctx, `🧠 Bài học mới (quan sát, không phải nhân quả): ${r.proposals.map((p) => `${p.change} — ${p.uncertainty}${p.requiresEditorialReview ? " [cần duyệt]" : ""}`).join("\n")}`, { dedupeKey: `learn:${ctx.store.today()}` });
  return { observations: obs.length, lessons: r.lessons.length, proposals: r.proposals.length, skipped: r.skipped };
}

/** TREND_SCAN: rank discovery candidates as opportunities (ideas for ORIGINAL remakes). */
export async function handleTrends(ctx: Ctx): Promise<Record<string, unknown>> {
  const dir = ctx.store.p("discovery", "candidates");
  const cands: RadarCandidate[] = [];
  const { records: signals } = await readJsonl<{ itemId: string; at: string; views: number | null; likes: number | null; followers: number | null; source: string }>(ctx.store.p("discovery", "signals.jsonl"));
  for (const n of await fs.readdir(dir).catch(() => [] as string[])) {
    const c = JSON.parse(await fs.readFile(`${dir}/${n}`, "utf8"));
    cands.push({ id: c.id, title: c.item.title, conceptVi: c.conceptVi, source: c.item.source, sourceUrl: c.canonicalUrl, creator: c.item.creatorDisplayName, observedAt: c.item.observedAt, novelty: c.dup.novelty, vnDuplicateFound: c.dup.matches.some((m: any) => m.kind === "market"), mediaRightsOk: ["LOCAL_IMPORT", "OFFICIAL_DOWNLOAD"].includes(c.acquisition.action), value: Math.min(1, c.score / 100), signals: signals.filter((s) => s.itemId === c.item.originId) });
  }
  const ranked = rankOpportunities(cands, new Date());
  await writeJsonAtomic(ctx.store.p("discovery", "opportunities.json"), { rankedAt: nowIso(), items: ranked });
  return { candidates: cands.length, top: ranked.slice(0, 3).map((r) => `${r.title} (${r.score}, ${r.action})`) };
}

/** AFFILIATE_RECHECK: on schedule and before publish; never scrapes price. */
export async function handleAffiliate(ctx: Ctx): Promise<Record<string, unknown>> {
  const out: Record<string, string> = {};
  for (const id of await fs.readdir(ctx.store.p("products")).catch(() => [] as string[])) {
    const p = await ctx.store.getProduct(id).catch(() => null);
    if (!p) continue;
    const c = await recheckProduct(p);
    await applyRecheck(ctx.store, p, c);
    out[id] = c.status;
    if (c.status !== "OK") await notify(ctx, `🛒 ${p.title}: ${c.status}\n${c.actions.join("\n")}`, { dedupeKey: `aff:${id}:${ctx.store.today()}` });
  }
  return out;
}

/** COMMENT_POLL: owned-media comments from authorised APIs or an import inbox (comments/inbox.jsonl). */
export async function handleComments(ctx: Ctx): Promise<Record<string, unknown>> {
  const s = await ctx.settings();
  const assistant = new CommentAssistant(ctx.store, { autoReplyEnabled: s.features.commentAutoReply, maxRepliesPerDay: s.comments.maxRepliesPerDay, cooldownMinutes: s.comments.cooldownMinutes });
  const faq = (await readJson(ctx.store.p("comments", "faq.json"), z.object({ entries: z.array(z.any()) }))) ?? { entries: [] };
  const { records } = await readJsonl<IncomingComment>(ctx.store.p("comments", "inbox.jsonl"));
  const done = new Set((await assistant.history()).map((d) => d.commentId));
  const counts: Record<string, number> = {};
  for (const c of records.filter((x) => !done.has(x.id))) {
    const d = await assistant.decide(c, faq.entries as FaqEntry[]);
    counts[d.mode] = (counts[d.mode] ?? 0) + 1;
    if (d.mode === "AUTO_REPLY") {
      const pub = ctx.publishers[c.platform as keyof typeof ctx.publishers];
      const r = pub ? await pub.tryOwnComment(c.remotePostId, d.draft!).catch((e) => ({ ok: false, reason: e.message })) : { ok: false, reason: "no publisher" };
      if (!r.ok) await notify(ctx, `💬 Trả lời thủ công (API không cho phép): ${d.draft}`, { dedupeKey: `cmt:${c.id}` });
    }
    if (d.mode === "ESCALATE") await notify(ctx, `🚩 Bình luận cần bạn xử lý (${d.class}): “${d.sanitized.slice(0, 200)}”`, { dedupeKey: `esc:${c.id}` });
  }
  return counts;
}

export type IntelKind = "LIFECYCLE_AUDIT" | "METRICS_SNAPSHOT" | "LEARNING_UPDATE" | "TREND_SCAN" | "AFFILIATE_RECHECK" | "COMMENT_POLL";
export async function runIntelJob(ctx: Ctx, job: Job): Promise<Record<string, unknown>> {
  switch (job.kind as IntelKind) {
    case "LIFECYCLE_AUDIT":
      return handleLifecycle(ctx);
    case "METRICS_SNAPSHOT":
      return handleMetrics(ctx);
    case "LEARNING_UPDATE":
      return handleLearning(ctx);
    case "TREND_SCAN":
      return handleTrends(ctx);
    case "AFFILIATE_RECHECK":
      return handleAffiliate(ctx);
    case "COMMENT_POLL":
      return handleComments(ctx);
  }
  throw new Error(`không phải job intel: ${job.kind}`);
}
