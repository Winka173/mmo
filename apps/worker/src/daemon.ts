import * as os from "node:os";
import { Scheduler } from "@ttm/automation";
import { FileLock } from "@ttm/storage";
import { CommandRouter } from "@ttm/telegram";
import { type Ctx } from "./context.js";
import { runJob } from "./handlers.js";
import { buildTelegramHandlers } from "./telegram-handlers.js";

/**
 * Persistent worker: single instance (lock with heartbeat), crash recovery on start, persistent
 * scheduler with catch-up, bounded job concurrency + GPU semaphore, Telegram outbox + long polling.
 * Runs independently of the web UI; Windows Task Scheduler restarts it (see RUNBOOK.md).
 */
export async function runDaemon(ctx: Ctx): Promise<void> {
  const lock = new FileLock(ctx.store.p("locks", "worker.lock"), { ttlMs: 90_000, purpose: "worker" });
  if (!(await lock.tryAcquire())) {
    const info = await lock.read();
    ctx.log(`Worker khác đang chạy (pid ${info?.pid} trên ${info?.host}). Thoát để tránh chạy trùng.`);
    process.exitCode = 2;
    return;
  }
  const rec = await ctx.queue.recover();
  ctx.log(`Khởi động worker pid ${process.pid} trên ${os.hostname()} — khôi phục: ${JSON.stringify(rec)}`);
  await ctx.store.audit({ actor: "worker", action: "worker.start", subject: String(process.pid), detail: rec });
  const settings = await ctx.settings();

  const enqueueSlot = (kind: "DAILY_PLAN" | "DAILY_REPORT" | "BACKUP" | "RIGHTS_AUDIT" | "LIFECYCLE_AUDIT" | "METRICS_SNAPSHOT" | "LEARNING_UPDATE" | "TREND_SCAN" | "AFFILIATE_RECHECK" | "COMMENT_POLL", name: string) => async (slot: Date) => {
    await ctx.queue.enqueue({ kind, idempotencyKey: `schedule:${name}:${slot.toISOString()}`, payload: { slot: slot.toISOString() }, priority: kind === "DAILY_REPORT" ? 1 : 5 });
  };
  const scheduler = new Scheduler(
    ctx.store,
    [
      { name: "daily-plan", cron: settings.schedules.dailyPlanCron, run: enqueueSlot("DAILY_PLAN", "daily-plan") },
      { name: "daily-report", cron: settings.schedules.dailyReportCron, run: enqueueSlot("DAILY_REPORT", "daily-report") },
      { name: "backup", cron: "30 3 * * *", run: enqueueSlot("BACKUP", "backup") },
      { name: "rights-audit", cron: "15 6 * * *", run: enqueueSlot("RIGHTS_AUDIT", "rights-audit") },
      { name: "lifecycle-audit", cron: "25 6 * * *", run: enqueueSlot("LIFECYCLE_AUDIT", "lifecycle-audit") },
      { name: "affiliate-recheck", cron: "35 6 * * *", run: enqueueSlot("AFFILIATE_RECHECK", "affiliate-recheck") },
      { name: "metrics-snapshot", cron: "5 */6 * * *", run: enqueueSlot("METRICS_SNAPSHOT", "metrics-snapshot") },
      { name: "comment-poll", cron: "50 * * * *", run: enqueueSlot("COMMENT_POLL", "comment-poll") },
      { name: "learning-update", cron: "40 18 * * 0", run: enqueueSlot("LEARNING_UPDATE", "learning-update") },
      { name: "trend-scan", cron: "20 7 * * *", run: enqueueSlot("TREND_SCAN", "trend-scan") },
    ],
    settings.timezone,
  );
  scheduler.start(30_000);
  ctx.log(`Lịch kế tiếp: ${scheduler.nextRuns().map((r) => `${r.name}@${r.next}`).join(", ")}`);

  const running = new Set<Promise<void>>();
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    ctx.log("Đang dừng worker — chờ job đang chạy kết thúc…");
    scheduler.stop();
    await Promise.allSettled([...running]);
    await lock.release();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  let tgOffset = 0;
  const router = ctx.telegram
    ? new CommandRouter({ chatIds: settings.telegram.allowedChatIds }, buildTelegramHandlers(ctx, scheduler), (e) => ctx.store.audit({ actor: "telegram", ...e }))
    : null;
  if (!ctx.telegram) ctx.log("Telegram chưa cấu hình — thông báo được giữ trong outbox (data/telegram/outbox).");

  const pollTelegram = async () => {
    while (!stopping && ctx.telegram && router) {
      try {
        const updates = await ctx.telegram.getUpdates(tgOffset, 25);
        for (const u of updates) {
          tgOffset = u.update_id + 1;
          const msg = u.message;
          if (!msg?.text) continue;
          const reply = await router.handle({ chatId: String(msg.chat.id), userId: String(msg.from?.id ?? ""), text: msg.text });
          if (reply) await ctx.telegram.sendMessage(String(msg.chat.id), reply).catch(() => undefined);
        }
      } catch (e: any) {
        ctx.log(`Telegram polling lỗi: ${e.message}`);
        await new Promise((r) => setTimeout(r, 30_000));
      }
    }
  };
  void pollTelegram();

  let lastFlush = 0;
  while (!stopping) {
    const s = await ctx.settings();
    if (Date.now() - lastFlush > 15_000) {
      lastFlush = Date.now();
      await ctx.outbox.flush(ctx.telegram).catch((e) => ctx.log(`Outbox lỗi: ${e.message}`));
    }
    if (!s.killSwitch && running.size < s.concurrency.jobs) {
      const job = await ctx.queue.claim({ maxConcurrent: s.concurrency.jobs, gpuSlots: Math.max(1, s.concurrency.gpu) }).catch(() => null);
      if (job) {
        const p = runJob(ctx, job).finally(() => running.delete(p));
        running.add(p);
        continue;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
