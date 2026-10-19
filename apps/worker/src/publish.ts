import * as path from "node:path";
import { FactoryError, autoSafeEligibility, canApprove, nowIso, type Format, type Job, type Platform, type Publication } from "@ttm/core";
import { writeManualKit, type PublishPackage, type UploadState } from "@ttm/platforms";
import { readJson } from "@ttm/storage";
import { z } from "zod";
import { notify, type Ctx } from "./context.js";
import { evaluateGates, loadProjectBundle } from "./produce.js";

async function upsertPublication(ctx: Ctx, projectId: string, pub: Publication): Promise<void> {
  const pubs = await ctx.store.getPublications(projectId);
  const i = pubs.findIndex((p) => p.platform === pub.platform && p.idempotencyKey === pub.idempotencyKey);
  if (i >= 0) pubs[i] = pub;
  else pubs.push(pub);
  await ctx.store.savePublications(projectId, pubs);
}

async function publishedTodayCount(ctx: Ctx, platform: Platform, tz: string): Promise<number> {
  const today = ctx.store.today(tz);
  let n = 0;
  for (const p of await ctx.store.listProjects())
    for (const pub of await ctx.store.getPublications(p.id))
      if (pub.platform === platform && pub.state === "PUBLISHED" && pub.confirmedAt && new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(pub.confirmedAt)) === today) n++;
  return n;
}

/**
 * PUBLISH stage. Re-validates every gate at publish time (sources may expire, licences may be
 * revoked after approval). Order of precedence:
 * kill switch > demo > rights/fact/affiliate gates > approval/AUTO_SAFE > external posting flag >
 * account check > daily cap > (reconcile) upload. Only an API-confirmed result is PUBLISHED.
 */
export async function handlePublish(ctx: Ctx, job: Job): Promise<Record<string, unknown>> {
  const { projectId, platform, format } = job.payload as { projectId: string; platform: Platform; format: Format };
  const settings = await ctx.settings();
  const b = await loadProjectBundle(ctx, projectId);
  const base: Publication = {
    platform,
    state: "QUEUED",
    idempotencyKey: job.idempotencyKey,
    remoteId: null,
    url: null,
    confirmedAt: null,
    attempts: job.attempts,
    lastError: null,
    isDemo: b.project.mode === "demo",
    updatedAt: nowIso(),
  };
  const existing = (await ctx.store.getPublications(projectId)).find((p) => p.idempotencyKey === job.idempotencyKey);
  if (existing?.state === "PUBLISHED") return { skipped: "đã đăng trước đó (idempotent)", url: existing.url };

  if (settings.killSwitch) throw new FactoryError("KILL_SWITCH", "BLOCKED", "Kill switch đang bật — không đăng");
  if (b.project.mode === "demo") {
    await upsertPublication(ctx, projectId, { ...base, state: "SKIPPED", lastError: "Dự án DEMO — không bao giờ đăng thật" });
    return { skipped: "demo" };
  }

  const storyboards = (await Promise.all(b.project.formats.map((f) => ctx.store.getStoryboard(projectId, f, b.project.revision)))).filter((x): x is NonNullable<typeof x> => !!x);
  const gates = evaluateGates({ ...b, storyboards });
  const qa = await ctx.store.getQa(projectId, format);
  const blocking = Object.values(gates).filter((g) => !g.ok);
  if (blocking.length) {
    const rightsBlocked = !gates.rights.ok;
    await upsertPublication(ctx, projectId, { ...base, state: rightsBlocked ? "BLOCKED_RIGHTS" : "NEEDS_REVIEW", lastError: blocking.flatMap((g) => g.reasons).join("; ") });
    throw new FactoryError(rightsBlocked ? "BLOCKED_RIGHTS" : "GATE_HOLD", "BLOCKED", `Không đăng ${platform}: ${blocking.flatMap((g) => g.reasons).slice(0, 4).join("; ")}`, {
      nextAction: "Bổ sung bằng chứng/quyền rồi duyệt lại. Phê duyệt thủ công KHÔNG vượt qua cổng quyền/fact.",
    });
  }
  if (!qa?.passed) throw new FactoryError("QA_NOT_PASSED", "BLOCKED", `Render ${format} chưa qua QA`);

  const publisher = ctx.publishers[platform];
  const caps = publisher ? await publisher.validateCapabilities() : null;
  const approvedBy = (job.payload as any).approvedBy as string | undefined;
  const auto = autoSafeEligibility({ project: b.project, settings, platform, gates: Object.values(gates), qaPassed: true, publisherAuthorized: !!caps?.canPublish });
  if (!approvedBy && !auto.ok) {
    await upsertPublication(ctx, projectId, { ...base, state: "NEEDS_REVIEW", lastError: "chờ duyệt" });
    const thumb = ctx.store.p("projects", projectId, "renders", format, `${format}.thumbnail.png`);
    await notify(ctx, `📝 Cần duyệt: ${b.project.title} → ${platform}\nJob: ${job.id}\nQuyền: ${gates.rights.ok ? "✅" : "⛔"} · Fact: ${gates.facts.ok ? "✅" : "⛔"}\nDuyệt: /approve ${job.id}  ·  Từ chối: /reject ${job.id}`, {
      dedupeKey: `review:${job.id}`,
      photo: thumb,
    });
    throw new FactoryError("NEEDS_REVIEW", "BLOCKED", "Chờ biên tập viên duyệt", { nextAction: `/approve ${job.id}` });
  }
  if (approvedBy && !canApprove(Object.values(gates)).ok) throw new FactoryError("APPROVAL_INSUFFICIENT", "BLOCKED", "Phê duyệt không thay thế được bằng chứng quyền/fact");
  if (!settings.externalPostingEnabled) {
    await upsertPublication(ctx, projectId, { ...base, state: "NEEDS_REVIEW", lastError: "externalPostingEnabled=false" });
    throw new FactoryError("POSTING_DISABLED", "BLOCKED", "Đăng ra ngoài đang TẮT trong Cài đặt (mặc định an toàn)");
  }

  const meta = (await readJson(ctx.store.p("projects", projectId, "metadata.json"), z.record(z.any()))) as any;
  const m = platform === "youtube_shorts" ? meta.youtube_shorts : platform === "youtube_long" ? meta.youtube_long : meta[platform];
  const pkg: PublishPackage = {
    projectId,
    idempotencyKey: job.idempotencyKey,
    videoFile: ctx.store.p("projects", projectId, "renders", format, `${format}.mp4`),
    videoSha256: qa.sha256,
    thumbnailFile: ctx.store.p("projects", projectId, "renders", format, `${format}.thumbnail.png`),
    title: m.title ?? b.brief.title,
    description: m.description ?? m.caption ?? "",
    tags: b.plan.hashtags,
    privacy: "private",
    publishAt: (job.payload as any).publishAt ?? null,
    containsSyntheticMedia: true,
    madeForKids: false,
  };

  if (!publisher || caps?.fallback === "MANUAL_ACTION_REQUIRED" || caps?.fallback === "NOT_CONFIGURED") {
    if (caps?.blockers.some((x) => x.startsWith("SAI TÀI KHOẢN")))
      throw new FactoryError("WRONG_ACCOUNT", "HUMAN_REQUIRED", caps.blockers.join("; "), { nextAction: "Xác nhận lại tài khoản đích trong Kênh trước khi đăng" });
    const kitDir = await writeManualKit(ctx.store.p("projects", projectId, "manual-kits", platform), platform, pkg, [...(caps?.blockers ?? []), m.linkNote ?? ""].filter(Boolean));
    await upsertPublication(ctx, projectId, { ...base, state: "MANUAL_ACTION_REQUIRED", lastError: caps?.blockers.join("; ") ?? "chưa cấu hình" });
    await notify(ctx, `✋ Cần đăng thủ công ${platform}: ${b.project.title}\nGói: ${kitDir}\nSau khi đăng: /posted ${job.id} <url>`, { dedupeKey: `manual:${job.id}` });
    throw new FactoryError("MANUAL_ACTION_REQUIRED", "HUMAN_REQUIRED", `${platform}: ${caps?.blockers.join("; ") ?? "không có publisher"}`, { manualFallback: path.relative(ctx.store.root, kitDir) });
  }

  const cap = platform === "youtube_long" ? Infinity : settings.dailyCaps.shorts;
  if ((await publishedTodayCount(ctx, platform, settings.timezone)) >= cap) {
    const tomorrow = new Date(Date.now() + 12 * 3600_000).toISOString();
    throw new FactoryError("DAILY_CAP", "RETRYABLE", `Đã đạt giới hạn ${cap} bài/ngày trên ${platform}`, { retryAfter: tomorrow });
  }

  const prior = (job.payload as any).uploadState as UploadState | undefined;
  await upsertPublication(ctx, projectId, { ...base, state: "UPLOADING" });
  const persist = async (s: UploadState) => {
    await ctx.queue.patchRunning(job.id, (j) => ({ ...j, payload: { ...j.payload, uploadState: s } }));
  };
  const result = await publisher.upload(pkg, persist, prior);
  if (result.status === "PUBLISHED" || result.status === "PROCESSING") {
    await upsertPublication(ctx, projectId, { ...base, state: result.status, remoteId: result.remoteId, url: result.url, confirmedAt: result.confirmedAt });
    await notify(ctx, `✅ ${result.status === "PUBLISHED" ? "Đã đăng" : "Đã tải lên, đang xử lý"} ${platform}: ${b.project.title}\n${result.url}`, { dedupeKey: `pub:${job.idempotencyKey}` });
    if (result.status === "PROCESSING")
      await ctx.queue.enqueue({ kind: "VERIFY_PUBLICATION", idempotencyKey: `verify:${job.idempotencyKey}`, payload: { projectId, platform, remoteId: result.remoteId }, notBefore: new Date(Date.now() + 10 * 60_000) });
    return { status: result.status, remoteId: result.remoteId, url: result.url };
  }
  const blocked = result as Extract<typeof result, { reason: string }>;
  await upsertPublication(ctx, projectId, { ...base, state: blocked.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "MANUAL_ACTION_REQUIRED", lastError: blocked.reason });
  throw new FactoryError(blocked.status, "HUMAN_REQUIRED", blocked.reason);
}
