import * as path from "node:path";
import { FactoryError, autoSafeEligibility, canApprove, nowIso, type Format, type Job, type Platform, type Publication } from "@ttm/core";
import { writeManualKit, type PublishPackage, type UploadState } from "@ttm/platforms";
import * as fs from "node:fs/promises";
import { gameReadiness, isApprovalValid, GameRegistry } from "@ttm/games";
import { MultiAccountManager, assertDestination } from "@ttm/governance";
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
    accountId: null,
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
  // Multi-game / multi-account: revalidate game truth + destination BEFORE any side effect.
  let gameApprovedBy: string | undefined;
  if (b.project.gameId) {
    const g = await gamePublishGate(ctx, { projectId, gameId: b.project.gameId, platform, connectedRemoteId: caps?.accountId ?? null, base });
    base.accountId = g.accountId;
    gameApprovedBy = g.approvedBy;
  } else base.accountId = await brandDestinationGate(ctx, { project: b.project, platform, connectedRemoteId: caps?.accountId ?? null, base });
  // a still-valid game approval fingerprint counts as editorial approval for every destination
  const approvedBy = ((job.payload as any).approvedBy as string | undefined) ?? gameApprovedBy;
  const auto = autoSafeEligibility({ project: b.project, settings, platform, gates: Object.values(gates), qaPassed: true, publisherAuthorized: !!caps?.canPublish });
  if (!approvedBy && !auto.ok) {
    await upsertPublication(ctx, projectId, { ...base, state: "NEEDS_REVIEW", lastError: "chờ duyệt" });
    const thumb = (await firstExisting([ctx.store.p("projects", projectId, "renders", format, `${format}.thumbnail.jpg`), ctx.store.p("projects", projectId, "renders", format, `${format}.thumbnail.png`)])) ?? undefined;
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
    thumbnailFile: await firstExisting([ctx.store.p("projects", projectId, "renders", format, `${format}.thumbnail.jpg`), ctx.store.p("projects", projectId, "renders", format, `${format}.thumbnail.png`)]),
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

async function firstExisting(files: string[]): Promise<string | null> {
  for (const f of files) if (await fs.stat(f).catch(() => null)) return f;
  return null;
}

/**
 * Game publish gate (spec Y1/Y3/Z4/AC): re-runs readiness (embargo, links, music licence, build
 * truth), requires a still-valid approval fingerprint, and resolves the destination strictly to an
 * account owned by THIS game. Any failure throws before upload — zero external side effects.
 */
async function gamePublishGate(ctx: Ctx, x: { projectId: string; gameId: string; platform: Platform; connectedRemoteId: string | null; base: Publication }): Promise<{ accountId: string; approvedBy: string }> {
  const r = await gameReadiness(ctx.store, x.gameId, x.projectId);
  const blockers = [...r.readiness.publishBlockers, ...r.readiness.missing, ...r.readiness.renderBlockers];
  if (blockers.length) {
    await upsertPublication(ctx, x.projectId, { ...x.base, state: blockers.some((b) => b.code === "MUSIC_LICENSE") ? "BLOCKED_RIGHTS" : "NEEDS_REVIEW", lastError: blockers.map((b) => b.message).join("; ") });
    throw new FactoryError(blockers[0].code, "BLOCKED", `Không đăng ${x.platform}: ${blockers.slice(0, 4).map((b) => b.message).join("; ")}`);
  }
  const approval = await isApprovalValid(ctx.store, x.gameId, x.projectId);
  if (!approval.ok) {
    await upsertPublication(ctx, x.projectId, { ...x.base, state: "NEEDS_REVIEW", lastError: approval.reason });
    throw new FactoryError("GAME_APPROVAL_REQUIRED", "BLOCKED", `Video game cần duyệt: ${approval.reason}${r.readiness.requiresApproval.length ? ` (${r.readiness.requiresApproval.map((i) => i.message).join("; ")})` : ""}`);
  }
  const game = (await new GameRegistry(ctx.store).get(x.gameId))!;
  const check = await new MultiAccountManager(ctx.store).checkDestination({ project: { brand: x.gameId, gameId: x.gameId }, platform: x.platform, accountId: r.input.accounts[x.platform] ?? null, gameAllowlist: game.destinationAllowlist, connectedRemoteId: x.connectedRemoteId, approvedAt: r.review.approvedAt });
  if (!check.ok) await upsertPublication(ctx, x.projectId, { ...x.base, state: "NEEDS_REVIEW", lastError: check.reason });
  return { accountId: assertDestination(check).id, approvedBy: r.review.approvedBy ?? "editor" };
}

/** Brand projects: enforced only once accounts are configured for that brand+platform (V3 compatible). */
async function brandDestinationGate(ctx: Ctx, x: { project: { brand: string; gameId: string | null }; platform: Platform; connectedRemoteId: string | null; base: Publication & { idempotencyKey: string } }): Promise<string | null> {
  const mam = new MultiAccountManager(ctx.store);
  if (!(await mam.candidates(x.project, x.platform, null)).length) return null;
  const check = await mam.checkDestination({ project: x.project, platform: x.platform, accountId: null, gameAllowlist: null, connectedRemoteId: x.connectedRemoteId });
  return assertDestination(check).id;
}
