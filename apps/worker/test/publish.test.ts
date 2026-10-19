import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Claim, idempotencyKey, nowIso } from "@ttm/core";
import { ffmpeg, type TtsProvider } from "@ttm/media";
import { ManualHandoffPublisher, MockPublisher } from "@ttm/platforms";
import { sha256File, writeJsonAtomic } from "@ttm/storage";
import { describe, expect, it } from "vitest";
import { buildContext, type Ctx } from "../src/context.js";
import { processUntilIdle } from "../src/handlers.js";
import { tmpDir } from "../../../packages/storage/test/helpers.js";

const now = nowIso();
const verifiedClaim = Claim.parse({ id: "claim-ok", text: "x", riskTier: "MEDIUM", status: "VERIFIED", checkedAt: now, sources: [
  { url: "https://a.test", title: "A", publisher: "Pub A", tier: "primary", fetchedAt: now, excerpt: "e" },
  { url: "https://b.test", title: "B", publisher: "Pub B", tier: "secondary", fetchedAt: now, excerpt: "e" }] });

async function liveProject(ctx: Ctx, id: string, targets: string[], assetOverrides: Record<string, unknown> = {}) {
  await ctx.store.saveProject({ schemaVersion: 1, id, brand: "tutomo", contentType: "FACT_SHORT", title: `T ${id}`, mode: "live", status: "READY_FOR_REVIEW", revision: 1, topicId: null, productId: null, formats: ["short_9x16"], categories: [], originalityChecklist: null, createdAt: now, updatedAt: now });
  await writeJsonAtomic(ctx.store.p("projects", id, "brief.json"), { projectId: id, title: "T", hook: "H", hookNarration: "h", cta: "C", ctaNarration: "c", points: [{ title: "P", narration: "p", claimIds: ["claim-ok"], kind: "evidence" }] });
  await writeJsonAtomic(ctx.store.p("projects", id, "plan.json"), { family: "FACT", targets, summary: "s" });
  await ctx.store.saveClaims(id, [verifiedClaim]);
  await ctx.store.saveRights({ schemaVersion: 1, projectId: id, music: [], voice: { engine: "e", voice: "v", license: "l", commercialUseOk: true }, assets: [{ assetId: "gfx-1", originUrl: null, author: null, ownershipType: "GENERATED_LOCAL", licenseId: null, licenseEvidencePath: null, commercialUse: true, adaptationAllowed: true, redistributionAllowed: true, platformScope: null, attribution: null, expiresAt: null, acquiredHow: "generated", hash: null, status: "VERIFIED", notes: "", ...assetOverrides }] });
  await ctx.store.saveStoryboard({ schemaVersion: 1, projectId: id, revision: 1, format: "short_9x16", template: "CuriosityFact", title: "T", generatedBy: "human", scenes: [{ id: "sc-1", kind: "evidence", title: "P", narration: "p", bullets: [], assetId: null, claimIds: ["claim-ok"], minSeconds: 3, transition: "cut", sourceCaption: null, chapterTitle: null }] });
  const dir = ctx.store.p("projects", id, "renders", "short_9x16");
  await fs.mkdir(dir, { recursive: true });
  const video = path.join(dir, "short_9x16.mp4");
  await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=1080x1920:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
  await writeJsonAtomic(ctx.store.p("projects", id, "metadata.json"), { youtube_shorts: { title: "T", description: "d" }, tiktok: { caption: "c" }, facebook: { caption: "c" } });
  await ctx.store.saveQa({ schemaVersion: 1, projectId: id, format: "short_9x16", file: video, sha256: await sha256File(video), ffprobe: { width: 1080, height: 1920, durationSec: 1, videoCodec: "h264", audioCodec: "aac", fps: 30 }, checks: [], passed: true, createdAt: now });
  const jobs = [];
  for (const platform of targets)
    jobs.push((await ctx.queue.enqueue({ kind: "PUBLISH", idempotencyKey: idempotencyKey({ brand: "tutomo", contentId: id, revision: 1, destination: platform }), payload: { projectId: id, platform, format: "short_9x16", approvedBy: "test" } })).job);
  return jobs;
}

async function setup() {
  const ctx = await buildContext({ dataDir: await tmpDir(), log: () => undefined });
  await ctx.store.updateSettings((s) => ({ ...s, externalPostingEnabled: true, dailyCaps: { ...s.dailyCaps, shorts: 5 } }), "test");
  const yt = new MockPublisher("youtube_shorts");
  ctx.publishers = { youtube_shorts: yt, tiktok: new ManualHandoffPublisher("tiktok", ctx.store.p("state", "kits"), "TikTok chưa audit") };
  return { ctx, yt };
}

describe("publishing (integration with mock platforms)", () => {
  it("Q2.6: crash after the remote accepted the upload -> restart reconciles, no duplicate public post", async () => {
    const { ctx, yt } = await setup();
    const [job] = await liveProject(ctx, "proj-crash", ["youtube_shorts"]);
    yt.failNext = "crash_after_remote";
    await processUntilIdle(ctx);
    expect((await ctx.queue.get(job.id))?.state).toBe("queued"); // ambiguous result -> retry later
    expect((await ctx.store.getPublications("proj-crash"))[0].state).not.toBe("PUBLISHED"); // never claimed early
    // worker restarts; backoff elapsed
    await ctx.queue.recover();
    await ctx.queue.transition(job.id, "queued", "test: clear backoff", (j) => ({ ...j, notBefore: null })).catch(() => undefined);
    const raw = JSON.parse(await fs.readFile(ctx.store.p("jobs", "queued", `${job.id}.json`), "utf8"));
    await writeJsonAtomic(ctx.store.p("jobs", "queued", `${job.id}.json`), { ...raw, notBefore: null });
    await processUntilIdle(ctx);
    expect(yt.uploads).toBe(1);
    const pub = (await ctx.store.getPublications("proj-crash"))[0];
    expect(pub).toMatchObject({ state: "PUBLISHED", remoteId: "mock_1" });
    expect(pub.confirmedAt).not.toBeNull();
    // re-enqueue with the same key (duplicate schedule) is a no-op
    expect((await ctx.queue.enqueue({ kind: "PUBLISH", idempotencyKey: job.idempotencyKey, payload: {} })).created).toBe(false);
  });

  it("Q2.7: licence revoked before publish -> stopped, nothing uploaded, publication BLOCKED_RIGHTS", async () => {
    const { ctx, yt } = await setup();
    const [job] = await liveProject(ctx, "proj-revoked", ["youtube_shorts"], { status: "REVOKED" });
    await processUntilIdle(ctx);
    expect(yt.uploads).toBe(0);
    expect((await ctx.queue.get(job.id))?.state).toBe("needs_review");
    expect((await ctx.store.getPublications("proj-revoked"))[0].state).toBe("BLOCKED_RIGHTS");
  });

  it("Q2.9: wrong account connected -> halt and request destination confirmation", async () => {
    const { ctx } = await setup();
    const wrong = new MockPublisher("youtube_shorts");
    wrong.validateCapabilities = async () => ({ ...(await new MockPublisher("youtube_shorts").validateCapabilities()), canPublish: false, blockers: ["SAI TÀI KHOẢN: kênh X, cần kênh Y"], fallback: "MANUAL_ACTION_REQUIRED" });
    ctx.publishers.youtube_shorts = wrong;
    const [job] = await liveProject(ctx, "proj-wrong", ["youtube_shorts"]);
    await processUntilIdle(ctx);
    const j = await ctx.queue.get(job.id);
    expect(j?.state).toBe("manual_action");
    expect(j?.lastError?.errorCode).toBe("WRONG_ACCOUNT");
    expect(wrong.uploads).toBe(0);
  });

  it("TikTok without audited API -> manual handoff kit + Telegram task, never PUBLISHED", async () => {
    const { ctx } = await setup();
    await ctx.store.updateSettings((s) => ({ ...s, telegram: { ...s.telegram, allowedChatIds: ["42"] } }), "t");
    const [job] = await liveProject(ctx, "proj-tiktok", ["tiktok"]);
    await processUntilIdle(ctx);
    expect((await ctx.queue.get(job.id))?.state).toBe("manual_action");
    expect((await ctx.store.getPublications("proj-tiktok"))[0].state).toBe("MANUAL_ACTION_REQUIRED");
    const kit = ctx.store.p("projects", "proj-tiktok", "manual-kits", "tiktok");
    expect((await fs.readdir(kit)).sort()).toEqual(expect.arrayContaining(["CHECKLIST.md", "caption.txt", "tiktok.mp4"]));
    expect((await ctx.outbox.pending()).some((m) => m.text.includes("thủ công"))).toBe(true);
  });

  it("kill switch and disabled external posting block publishing; approval alone cannot bypass", async () => {
    const { ctx, yt } = await setup();
    await ctx.store.updateSettings((s) => ({ ...s, killSwitch: true }), "t");
    const [a] = await liveProject(ctx, "proj-kill", ["youtube_shorts"]);
    await processUntilIdle(ctx);
    expect((await ctx.queue.get(a.id))?.lastError?.errorCode).toBe("KILL_SWITCH");
    await ctx.store.updateSettings((s) => ({ ...s, killSwitch: false, externalPostingEnabled: false }), "t");
    const [b] = await liveProject(ctx, "proj-off", ["youtube_shorts"]);
    await processUntilIdle(ctx);
    expect((await ctx.queue.get(b.id))?.lastError?.errorCode).toBe("POSTING_DISABLED");
    expect(yt.uploads).toBe(0);
  });

  it("Q2.8: every TTS provider fails -> human intervention ticket, no video produced", async () => {
    const { ctx } = await setup();
    const dead: TtsProvider = { id: "dead", costPerCharUsd: 0, available: async () => false, license: () => ({ engine: "d", voice: "d", license: "d", commercialUseOk: false, notes: "" }), synthesize: async () => 0 };
    ctx.tts = [dead];
    await ctx.store.updateSettings((s) => ({ ...s, telegram: { ...s.telegram, allowedChatIds: ["42"] } }), "t");
    await liveProject(ctx, "proj-notts", []);
    const { job } = await ctx.queue.enqueue({ kind: "PRODUCE", idempotencyKey: "produce:proj-notts", payload: { projectId: "proj-notts" } });
    await fs.rm(ctx.store.p("projects", "proj-notts", "renders"), { recursive: true });
    await processUntilIdle(ctx);
    const j = await ctx.queue.get(job.id);
    expect(j?.state).toBe("manual_action");
    expect(j?.lastError?.errorCode).toBe("NEEDS_PROVIDER");
    expect(await fs.stat(ctx.store.p("projects", "proj-notts", "renders")).catch(() => null)).toBeNull();
  });
});
