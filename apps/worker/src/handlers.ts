import { FactoryError, idempotencyKey, nowIso, type Job } from "@ttm/core";
import { GameRegistry, produceGameVideo } from "@ttm/games";
import { SourceLicenseRegistry } from "@ttm/governance";
import { runIntelJob } from "./intel.js";
import { planDay, type TopicCandidate } from "@ttm/automation";
import { createBackup, freeDiskGb, pruneBackups, readJson } from "@ttm/storage";
import { notify, type Ctx } from "./context.js";
import { ProjectPlan, produceProject } from "./produce.js";
import { handlePublish } from "./publish.js";
import { sendDailyReport } from "./report.js";

const STAGE: Record<string, string> = { PRODUCE: "RENDER", PUBLISH: "PUBLISHING", DAILY_PLAN: "PLAN", DAILY_REPORT: "REPORT", BACKUP: "BACKUP", VERIFY_PUBLICATION: "VERIFYING" };

/** DAILY_PLAN: choose which ready briefs to produce today (caps + ratio balance). */
async function handleDailyPlan(ctx: Ctx): Promise<Record<string, unknown>> {
  const settings = await ctx.settings();
  const projects = await ctx.store.listProjects();
  const candidates: TopicCandidate[] = [];
  const recentFamilies: string[] = [];
  const horizon = Date.now() - 14 * 86400_000;
  for (const p of projects) {
    const plan = await readJson(ctx.store.p("projects", p.id, "plan.json"), ProjectPlan);
    if (!plan) continue;
    const family = p.gameId || plan.family === "GAME" ? "game" : plan.family === "FACT" ? (p.formats.includes("long_16x9") ? "longForm" : "knowledgeFact") : plan.family === "PRODUCT" ? "affiliate" : plan.family === "ADAPT" ? "adaptation" : "game";
    if (p.status !== "CANDIDATE") {
      if (new Date(p.updatedAt).getTime() > horizon) recentFamilies.push(family);
      continue;
    }
    const rights = await ctx.store.getRights(p.id);
    const sig = plan.signals;
    candidates.push({
      id: p.id,
      title: p.title,
      contentType: p.contentType,
      family,
      rightsOk: !!rights && rights.assets.every((a) => a.status === "VERIFIED"),
      qualityOk: true,
      source: "projects",
      signals: {
        uniqueness: sig.uniqueness ?? 0.6,
        factualConfidence: sig.factualConfidence ?? 0.5,
        mediaRightsConfidence: sig.mediaRightsConfidence ?? 1,
        audienceInterest: sig.audienceInterest ?? 0.5,
        visualFeasibility: sig.visualFeasibility ?? 0.8,
        affiliatePotential: sig.affiliatePotential ?? 0,
        costEstimateUsd: 0,
        recentRepeatPenalty: sig.recentRepeatPenalty ?? 0,
      },
    });
  }
  const decision = planDay({ candidates, settings, recentFamilies });
  for (const c of candidates) await ctx.store.audit({ actor: "planner", action: "plan.considered", subject: c.id });
  const enqueued: string[] = [];
  for (const ch of decision.chosen) {
    const p = await ctx.store.getProject(ch.candidate.id);
    if (!p) continue;
    const { job } = await ctx.queue.enqueue({ kind: "PRODUCE", idempotencyKey: `produce:${p.id}:r${p.revision}`, payload: { projectId: p.id }, usesGpu: true, priority: 3 });
    enqueued.push(job.id);
  }
  await notify(ctx, `🗓️ Kế hoạch hôm nay: ${decision.chosen.map((c) => c.candidate.title).join("; ") || "không có đề tài sẵn sàng"}\nLoại: ${decision.rejected.length}`, { dedupeKey: `plan:${ctx.store.today()}` });
  return { chosen: decision.chosen.map((c) => ({ id: c.candidate.id, score: c.score, reason: c.reason })), rejected: decision.rejected, enqueued };
}

/** GAME_PRODUCE: render a game video project, then one PUBLISH job per target (gameId-scoped key). */
export async function handleGameProduce(ctx: Ctx, job: Job): Promise<Record<string, unknown>> {
  const { gameId, projectId, mode } = job.payload as { gameId: string; projectId: string; mode?: "demo" | "live" };
  const r = await produceGameVideo({ store: ctx.store, log: ctx.log }, gameId, projectId, { mode });
  const project = (await ctx.store.getProject(projectId))!;
  const input = (await new GameRegistry(ctx.store).getVideo(gameId, projectId))!;
  const jobs: string[] = [];
  for (const platform of input.targets) {
    const format = platform === "youtube_long" ? "long_16x9" : "short_9x16";
    if (!input.formats.includes(format)) continue;
    const key = idempotencyKey({ brand: gameId, contentId: projectId, revision: project.revision, destination: platform });
    jobs.push((await ctx.queue.enqueue({ kind: "PUBLISH", idempotencyKey: key, payload: { projectId, platform, format, gameId }, priority: 4 })).job.id);
  }
  const lines = Object.entries(r.outputs).map(([f, o]: [string, any]) => `• ${f}: ${o.durationSec}s, QA ${o.qaPassed ? "đạt" : "LỖI"}, thumbnail ${o.thumbnail}`);
  const hold = [...r.readiness.publishBlockers, ...r.readiness.requiresApproval].slice(0, 4).map((i) => `  ⛔ ${i.message}`);
  await notify(ctx, [`🎮 Render game xong: ${input.title} (${gameId})`, ...lines, ...hold, mode === "demo" ? "FIXTURE/DEMO — không đăng thật." : "Duyệt trong Review Queue hoặc /review " + projectId].join("\n"), { dedupeKey: `game-render:${projectId}:r${project.revision}` });
  return { ...r, publishJobs: jobs };
}

export async function runJob(ctx: Ctx, job: Job): Promise<void> {
  const settings = await ctx.settings();
  const hb = setInterval(() => void ctx.queue.heartbeat(job.id).catch(() => undefined), 15_000);
  try {
    if (settings.paused && job.kind !== "DAILY_REPORT" && job.kind !== "BACKUP") throw new FactoryError("PAUSED", "RETRYABLE", "Hệ thống đang tạm dừng (/pause)", { retryAfter: new Date(Date.now() + 15 * 60_000).toISOString() });
    if (job.usesGpu) {
      const free = await freeDiskGb(ctx.store.root);
      if (free !== null && free < settings.minFreeDiskGb) {
        await notify(ctx, `💾 Ổ đĩa sắp đầy: còn ${free.toFixed(1)} GB (ngưỡng ${settings.minFreeDiskGb} GB). Tạm hoãn job dựng video.`, { dedupeKey: "low-disk" });
        throw new FactoryError("DISK_LOW", "RETRYABLE", `Ổ đĩa còn ${free.toFixed(1)} GB`, { retryAfter: new Date(Date.now() + 60 * 60_000).toISOString() });
      }
    }
    let result: Record<string, unknown>;
    switch (job.kind) {
      case "PRODUCE":
        result = await produceProject(ctx, String(job.payload.projectId));
        break;
      case "PUBLISH":
        result = await handlePublish(ctx, job);
        break;
      case "DAILY_PLAN":
        result = await handleDailyPlan(ctx);
        break;
      case "GAME_PRODUCE":
        result = await handleGameProduce(ctx, job);
        break;
      case "RIGHTS_AUDIT": {
        const reg = new SourceLicenseRegistry(ctx.store, ctx.queue);
        for (const p of await ctx.store.listProjects()) await reg.syncProject(p.id);
        const a = await reg.audit(new Date(), Number(job.payload.warnDays ?? 14));
        for (const x of a.expired) await notify(ctx, `⛔ Giấy phép hết hạn: ${x.assetKey}\nDự án bị giữ: ${x.projects.join(", ")}\nĐã hủy ${x.cancelledJobs.length} job đăng${x.publishedNeedingReview.length ? `\nBài đã đăng cần xem xét gỡ/sửa: ${x.publishedNeedingReview.map((p) => p.url ?? p.platform).join(", ")}` : ""}`, { dedupeKey: `rights-exp:${x.assetKey}` });
        if (a.expiringSoon.length) await notify(ctx, `⚠️ ${a.expiringSoon.length} giấy phép sắp hết hạn: ${a.expiringSoon.map((r) => `${r.assetKey} (${r.expiresAt?.slice(0, 10)})`).join(", ")}`, { dedupeKey: `rights-soon:${ctx.store.today()}` });
        result = { expired: a.expired.length, expiringSoon: a.expiringSoon.map((r) => r.assetKey) };
        break;
      }
      case "DAILY_REPORT": {
        const slot = job.payload.slot ? new Intl.DateTimeFormat("en-CA", { timeZone: settings.timezone }).format(new Date(String(job.payload.slot))) : undefined;
        const r = await sendDailyReport(ctx, (job.payload.date as string | undefined) ?? slot);
        result = { files: r.files };
        break;
      }
      case "BACKUP": {
        const b = await createBackup(ctx.store);
        result = { ...b, pruned: await pruneBackups(ctx.store) };
        break;
      }
      case "VERIFY_PUBLICATION": {
        const { projectId, platform, remoteId } = job.payload as any;
        const pub = ctx.publishers[platform as keyof typeof ctx.publishers];
        const st = pub ? await pub.pollStatus(remoteId) : { state: "UNKNOWN", detail: "no publisher" };
        if (st.state === "PROCESSING") throw new FactoryError("STILL_PROCESSING", "RETRYABLE", "Nền tảng vẫn đang xử lý video");
        const pubs = await ctx.store.getPublications(projectId);
        for (const p of pubs) if (p.remoteId === remoteId) Object.assign(p, { state: st.state === "PUBLISHED" ? "PUBLISHED" : "FAILED", lastError: st.state === "PUBLISHED" ? null : st.detail, updatedAt: nowIso() });
        await ctx.store.savePublications(projectId, pubs);
        result = st;
        break;
      }
      case "LIFECYCLE_AUDIT":
      case "METRICS_SNAPSHOT":
      case "LEARNING_UPDATE":
      case "TREND_SCAN":
      case "AFFILIATE_RECHECK":
      case "COMMENT_POLL":
        result = await runIntelJob(ctx, job);
        break;
      default:
        throw new FactoryError("UNSUPPORTED_JOB", "PERMANENT", `Loại job ${job.kind} chưa được hỗ trợ`);
    }
    await ctx.queue.complete(job.id, result);
    ctx.log(`✔ ${job.kind} ${job.id}`);
  } catch (e) {
    const failed = await ctx.queue.fail(job.id, e, STAGE[job.kind] ?? job.kind);
    ctx.log(`✖ ${job.kind} ${job.id} -> ${failed.state}: ${failed.lastError?.errorCode} ${failed.lastError?.message}`);
    if (failed.state === "failed") await notify(ctx, `⚠️ Job thất bại vĩnh viễn: ${job.kind} ${job.id}\n${failed.lastError?.message}`, { dedupeKey: `fail:${job.id}` });
  } finally {
    clearInterval(hb);
  }
}

/** Drain runnable jobs (used by `once`, e2e and tests). */
export async function processUntilIdle(ctx: Ctx, opts: { maxJobs?: number } = {}): Promise<number> {
  const settings = await ctx.settings();
  let n = 0;
  while (n < (opts.maxJobs ?? 200)) {
    const job = await ctx.queue.claim({ maxConcurrent: settings.concurrency.jobs, gpuSlots: Math.max(1, settings.concurrency.gpu) });
    if (!job) break;
    await runJob(ctx, job);
    n++;
  }
  return n;
}
