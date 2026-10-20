import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Claim, idempotencyKey, nowIso, type Job } from "@ttm/core";
import { ffmpeg } from "@ttm/media";
import { ManualHandoffPublisher, MockPublisher } from "@ttm/platforms";
import { sha256File, writeJsonAtomic } from "@ttm/storage";
import { buildContext, type Ctx } from "./context.js";
import { runJob } from "./handlers.js";
import { ProjectPlan } from "./produce.js";

/** Accelerated clock: shifts `Date.now()` / `new Date()` by an offset (soak only). */
function installClock() {
  const Real = Date;
  let offset = 0;
  class Fake extends Real {
    constructor(...a: any[]) {
      if (a.length === 0) super(Real.now() + offset);
      else super(...(a as [any]));
    }
    static now() {
      return Real.now() + offset;
    }
  }
  (globalThis as any).Date = Fake;
  return { set: (iso: string) => (offset = new Real(iso).getTime() - Real.now()), advance: (ms: number) => (offset += ms), restore: () => ((globalThis as any).Date = Real) };
}

export type SoakDay = { day: number; date: string; planned: string[]; published: number; uploadsTotal: number; manualKits: number; faults: string[]; recovered: Record<string, number> | null; reportFile: string | null; queue: Record<string, number> };

async function seed(ctx: Ctx, n: number) {
  const t = nowIso();
  const vid = ctx.store.p("state", "soak-sample.mp4");
  if (!(await fs.stat(vid).catch(() => null))) await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=30:d=2", "-f", "lavfi", "-i", "sine=f=440:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", vid]);
  const sha = await sha256File(vid);
  const claim = Claim.parse({ id: "soak-claim", text: "x", riskTier: "LOW", status: "VERIFIED", checkedAt: "2099-01-01T00:00:00.000Z", topic: "science", sources: [{ url: "https://a.example/x", title: "A", publisher: "Pub A", tier: "primary", fetchedAt: t, excerpt: "e" }] });
  for (let i = 0; i < n; i++) {
    const id = `soak-${String(i).padStart(2, "0")}`;
    await ctx.store.saveProject({ schemaVersion: 1, id, contentType: "FACT_SHORT", title: `Soak ${i}`, mode: "live", status: "CANDIDATE", revision: 1, formats: ["short_9x16"], createdAt: t, updatedAt: t });
    await writeJsonAtomic(ctx.store.p("projects", id, "brief.json"), { projectId: id, title: `Soak ${i}`, hook: "H", hookNarration: "h", cta: "C", ctaNarration: "c", points: [{ title: "P", narration: "p", claimIds: ["soak-claim"], kind: "evidence" }] });
    await writeJsonAtomic(ctx.store.p("projects", id, "plan.json"), ProjectPlan.parse({ family: "FACT", targets: ["youtube_shorts", "tiktok"], summary: "s", signals: { uniqueness: 0.5 + i / 40 } }));
    await ctx.store.saveClaims(id, [claim]);
    await ctx.store.saveRights({ schemaVersion: 1, projectId: id, music: [], voice: { engine: "e", voice: "v", license: "l", commercialUseOk: true }, assets: [{ assetId: "gfx-1", originUrl: null, author: null, ownershipType: "GENERATED_LOCAL", licenseId: null, licenseEvidencePath: null, commercialUse: true, adaptationAllowed: true, redistributionAllowed: true, platformScope: null, attribution: null, expiresAt: null, acquiredHow: "generated", hash: null, status: "VERIFIED", notes: "" }] });
    await ctx.store.saveStoryboard({ schemaVersion: 1, projectId: id, revision: 1, format: "short_9x16", template: "CuriosityFact", title: "T", generatedBy: "human", scenes: [{ id: "sc-1", kind: "evidence", title: "P", narration: "p", bullets: [], assetId: null, claimIds: ["soak-claim"], minSeconds: 3, transition: "cut", sourceCaption: "Pub A", chapterTitle: null }] });
    const dir = ctx.store.p("projects", id, "renders", "short_9x16");
    await fs.mkdir(dir, { recursive: true });
    await fs.copyFile(vid, path.join(dir, "short_9x16.mp4"));
    await writeJsonAtomic(ctx.store.p("projects", id, "metadata.json"), { youtube_shorts: { title: `Soak ${i}`, description: "d" }, tiktok: { caption: "c" } });
    await ctx.store.saveQa({ schemaVersion: 1, projectId: id, format: "short_9x16", file: path.join(dir, "short_9x16.mp4"), sha256: sha, ffprobe: { width: 1080, height: 1920, durationSec: 2, videoCodec: "h264", audioCodec: "aac", fps: 30 }, checks: [], passed: true, createdAt: t });
  }
}

/** Dry-run PRODUCE: reuse the pre-rendered fixture (no FFmpeg), then queue publish jobs like produce does. */
async function dryProduce(ctx: Ctx, job: Job) {
  const projectId = String(job.payload.projectId);
  const p = (await ctx.store.getProject(projectId))!;
  p.status = "READY_FOR_REVIEW";
  await ctx.store.saveProject(p);
  for (const platform of ["youtube_shorts", "tiktok"] as const)
    await ctx.queue.enqueue({ kind: "PUBLISH", idempotencyKey: idempotencyKey({ brand: p.brand, contentId: p.id, revision: p.revision, destination: platform }), payload: { projectId, platform, format: "short_9x16" } });
  await ctx.queue.complete(job.id, { dryRun: true });
}

async function drain(ctx: Ctx, max = 60) {
  for (let i = 0; i < max; i++) {
    const job = await ctx.queue.claim({ maxConcurrent: 1, gpuSlots: 1 });
    if (!job) return;
    if (job.kind === "PRODUCE") await dryProduce(ctx, job);
    else await runJob(ctx, job);
  }
}

/**
 * Wave 7 soak: N accelerated days (default 7) of plan → (dry) produce → AUTO_SAFE publish on a mock
 * YouTube + manual TikTok, end-of-day report, with injected faults (ambiguous upload, 429, worker
 * crash, duplicate schedule, corrupt queue file, kill switch). Asserts caps and no duplicate posts.
 */
export async function runSoak(opts: { dataDir: string; days?: number; startDate?: string; log?: (m: string) => void }) {
  const clock = installClock();
  const log = opts.log ?? (() => undefined);
  const days: SoakDay[] = [];
  try {
    clock.set(`${opts.startDate ?? "2026-11-02"}T00:00:00+07:00`);
    const ctx = await buildContext({ dataDir: opts.dataDir, log });
    await ctx.store.updateSettings((s) => ({ ...s, externalPostingEnabled: true, autoSafeOptIns: ["youtube_shorts:FACT_SHORT"], dailyCaps: { ...s.dailyCaps, shorts: 1 }, telegram: { ...s.telegram, allowedChatIds: ["1000001"] }, features: { ...s.features, originalityGate: false } }), "soak");
    const yt = new MockPublisher("youtube_shorts", "UC_SOAK");
    ctx.publishers = { youtube_shorts: yt, tiktok: new ManualHandoffPublisher("tiktok", ctx.store.p("state", "kits"), "TikTok chưa audit") };
    await seed(ctx, (opts.days ?? 7) + 3);
    for (let d = 1; d <= (opts.days ?? 7); d++) {
      const date = new Date(new Date(`${opts.startDate ?? "2026-11-02"}T07:00:00+07:00`).getTime() + (d - 1) * 86400_000);
      clock.set(date.toISOString());
      const faults: string[] = [];
      let recovered: SoakDay["recovered"] = null;
      if (d === 2) (yt.failNext = "crash_after_remote"), faults.push("upload mơ hồ (mất mạng sau khi YouTube đã nhận)");
      if (d === 3) (yt.failNext = "429"), faults.push("YouTube 429");
      const slotKey = `schedule:daily-plan:${date.toISOString()}`;
      await ctx.queue.enqueue({ kind: "DAILY_PLAN", idempotencyKey: slotKey, payload: { slot: date.toISOString() } });
      if (d === 5) {
        const dup = await ctx.queue.enqueue({ kind: "DAILY_PLAN", idempotencyKey: slotKey, payload: { slot: date.toISOString() } });
        faults.push(`lịch chạy trùng (tạo job mới: ${dup.created})`);
      }
      if (d === 6) {
        await fs.writeFile(ctx.store.p("jobs", "queued", "job_CORRUPTED0000000000000000.json"), '{"schemaVersion":1,"id":"job_CORRUP');
        faults.push("file job JSON hỏng trong hàng đợi");
      }
      if (d === 7) {
        await ctx.store.updateSettings((s) => ({ ...s, killSwitch: true }), "soak");
        faults.push("kill switch bật lúc 07:00");
      }
      if (d === 4) {
        // worker dies while holding a job: claim it and never finish, then a restarted worker recovers
        const victim = await ctx.queue.claim({ maxConcurrent: 1, gpuSlots: 1 });
        faults.push(`worker chết khi đang giữ ${victim?.kind ?? "?"}`);
        clock.advance(10 * 60_000);
        recovered = await ctx.queue.recover();
      }
      await drain(ctx);
      // midday: retry window for anything backed off (no midnight burst — same day only)
      clock.advance(6 * 3600_000);
      if (d === 7) await ctx.store.updateSettings((s) => ({ ...s, killSwitch: false }), "soak");
      await ctx.queue.recover();
      await drain(ctx);
      clock.set(new Date(date.getTime() + 12 * 3600_000).toISOString()); // 19:00
      await ctx.queue.enqueue({ kind: "DAILY_REPORT", idempotencyKey: `schedule:daily-report:${d}`, payload: { slot: new Date().toISOString() } });
      await drain(ctx);
      const day = ctx.store.today();
      let published = 0;
      let manual = 0;
      for (const p of await ctx.store.listProjects())
        for (const pub of await ctx.store.getPublications(p.id)) {
          if (pub.state === "PUBLISHED" && pub.confirmedAt && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(pub.confirmedAt)) === day) published++;
          if (pub.state === "MANUAL_ACTION_REQUIRED") manual++;
        }
      const rf = ctx.store.p("reports", "daily", `${day}.md`);
      days.push({ day: d, date: day, planned: [], published, uploadsTotal: yt.uploads, manualKits: manual, faults, recovered, reportFile: (await fs.stat(rf).catch(() => null)) ? rf : null, queue: await ctx.queue.counts() });
      log(`Ngày ${d} (${day}): đăng ${published}, tổng upload ${yt.uploads}, thủ công ${manual}, sự cố: ${faults.join("; ") || "không"}`);
    }
    // invariants
    const remote = [...yt.remote.values()];
    const dupKeys = remote.map((r) => r.key).filter((k, i, a) => a.indexOf(k) !== i);
    const pubs = (await Promise.all((await ctx.store.listProjects()).map((p) => ctx.store.getPublications(p.id)))).flat();
    const invariants = {
      noDuplicateRemotePosts: dupKeys.length === 0,
      dailyCapRespected: days.every((x) => x.published <= 1),
      everyDayReported: days.every((x) => !!x.reportFile),
      noPaidSpend: (await ctx.store.monthCostUsd()) === 0,
      tiktokNeverMarkedPublished: pubs.filter((p) => p.platform === "tiktok").every((p) => p.state !== "PUBLISHED"),
      corruptJobQuarantined: (await fs.readdir(ctx.store.p("quarantine")).catch(() => [] as string[])).some((n) => n.includes("job_CORRUPTED")) && !(await fs.readdir(ctx.store.p("jobs", "queued"))).some((n) => n.includes("job_CORRUPTED")),
      telegramOutboxQueued: (await fs.readdir(ctx.store.p("telegram", "outbox")).catch(() => [] as string[])).length > 0,
    };
    return { days, invariants, uploads: yt.uploads, dataDir: opts.dataDir };
  } finally {
    clock.restore();
  }
}

export function soakMarkdown(r: Awaited<ReturnType<typeof runSoak>>): string {
  return [
    "# Soak test — 7 ngày tăng tốc (dry-run render, nền tảng giả lập)",
    "",
    `Chạy lúc ${new Date().toISOString()} · DATA_DIR tạm: \`${r.dataDir}\` · tổng upload lên YouTube giả lập: ${r.uploads}`,
    "",
    "| Ngày | Ngày (VN) | Đăng (xác nhận) | Tổng upload | Gói thủ công | Sự cố bơm vào | Khôi phục | Báo cáo | Hàng đợi cuối ngày |",
    "|---|---|---|---|---|---|---|---|---|",
    ...r.days.map((d) => `| ${d.day} | ${d.date} | ${d.published} | ${d.uploadsTotal} | ${d.manualKits} | ${d.faults.join("; ") || "—"} | ${d.recovered ? JSON.stringify(d.recovered) : "—"} | ${d.reportFile ? "có" : "THIẾU"} | ${Object.entries(d.queue).map(([k, v]) => `${k}=${v}`).join(" ")} |`),
    "",
    "## Bất biến",
    "",
    ...Object.entries(r.invariants).map(([k, v]) => `- ${v ? "✅" : "❌"} ${k}`),
    "",
    "Ghi chú: render được thay bằng MP4 mẫu đã dựng sẵn để tăng tốc (dry-run). Một vòng E2E thật có dựng video xem `docs/TEST_RESULTS.md`.",
    "",
  ].join("\n");
}
