import * as os from "node:os";
import type { Scheduler } from "@ttm/automation";
import type { CommandHandlers } from "@ttm/telegram";
import { type Ctx } from "./context.js";
import { buildDailyReport } from "./report.js";

export function buildTelegramHandlers(ctx: Ctx, scheduler?: Scheduler): CommandHandlers {
  return {
    async status() {
      const s = await ctx.settings();
      const c = await ctx.queue.counts();
      return [
        `🟢 Worker pid ${process.pid} @ ${os.hostname()}`,
        `Kill switch: ${s.killSwitch ? "BẬT" : "tắt"} · Tạm dừng: ${s.paused ? "có" : "không"} · Đăng ngoài: ${s.externalPostingEnabled ? "BẬT" : "tắt"}`,
        `Hàng đợi: ${Object.entries(c).map(([k, v]) => `${k}=${v}`).join(", ")}`,
        scheduler ? `Lịch: ${scheduler.nextRuns().map((r) => `${r.name} ${r.next}`).join("; ")}` : "",
      ].filter(Boolean).join("\n");
    },
    async today() {
      return (await buildDailyReport(ctx)).text;
    },
    async queue() {
      const lines: string[] = [];
      for (const st of ["running", "queued", "needs_review", "manual_action"] as const) {
        const jobs = await ctx.queue.list(st);
        lines.push(`${st} (${jobs.length})`);
        for (const j of jobs.slice(0, 8)) lines.push(`  • ${j.id} ${j.kind} ${j.payload.projectId ?? ""} ${j.payload.platform ?? ""}`);
      }
      return lines.join("\n");
    },
    async report() {
      return (await buildDailyReport(ctx)).text;
    },
    async cost() {
      const s = await ctx.settings();
      return `Chi phí tháng này: $${(await ctx.store.monthCostUsd()).toFixed(2)} / trần $${s.budgets.monthlyUsdCap.toFixed(2)} (mặc định chỉ dùng thành phần miễn phí/local).`;
    },
    async channels() {
      const out: string[] = [];
      for (const [p, pub] of Object.entries(ctx.publishers)) {
        const c = await pub!.validateCapabilities();
        out.push(`${p}: ${c.canPublish ? "✅ có thể đăng" : "⛔"} ${c.accountName ?? ""} ${c.blockers.join("; ")}`);
      }
      return out.join("\n");
    },
    async pause(actor) {
      await ctx.store.updateSettings((s) => ({ ...s, paused: true }), actor);
      return "⏸️ Đã tạm dừng. Job đang chạy sẽ hoàn tất; job mới chờ /resume.";
    },
    async resume(actor) {
      await ctx.store.updateSettings((s) => ({ ...s, paused: false }), actor);
      return "▶️ Đã tiếp tục. Lưu ý: /resume không bật đăng ngoài và không bỏ qua cổng an toàn.";
    },
    async approve(jobId, actor) {
      const j = await ctx.queue.get(jobId);
      if (!j) return `Không tìm thấy job ${jobId}`;
      if (j.state !== "needs_review") return `Job ${jobId} đang ở trạng thái ${j.state}, không thể duyệt.`;
      await ctx.queue.transition(jobId, "queued", `approve by ${actor}`, (x) => ({ ...x, attempts: 0, payload: { ...x.payload, approvedBy: actor, approvedAt: new Date().toISOString() } }));
      return `✅ Đã duyệt ${jobId}. Hệ thống sẽ kiểm tra lại toàn bộ cổng quyền/fact trước khi đăng.`;
    },
    async reject(jobId, actor) {
      const j = await ctx.queue.get(jobId);
      if (!j) return `Không tìm thấy job ${jobId}`;
      if (!["needs_review", "manual_action"].includes(j.state)) return `Job ${jobId} ở trạng thái ${j.state}.`;
      await ctx.queue.transition(jobId, "failed", `reject by ${actor}`);
      return `🗑️ Đã từ chối ${jobId}.`;
    },
    async retry(jobId, actor) {
      const j = await ctx.queue.get(jobId);
      if (!j) return `Không tìm thấy job ${jobId}`;
      if (j.state !== "failed") return `Chỉ thử lại job ở trạng thái failed (hiện tại: ${j.state}).`;
      await ctx.queue.transition(jobId, "queued", `retry by ${actor}`);
      return `🔁 Đã đưa ${jobId} vào hàng đợi lại.`;
    },
    async posted(jobId, url, actor) {
      const j = await ctx.queue.get(jobId);
      if (!j || j.state !== "manual_action") return `Job ${jobId} không phải việc đăng thủ công đang chờ.`;
      if (!/^https:\/\//.test(url)) return "URL không hợp lệ.";
      const projectId = String(j.payload.projectId);
      const pubs = await ctx.store.getPublications(projectId);
      for (const p of pubs)
        if (p.idempotencyKey === j.idempotencyKey) Object.assign(p, { state: "PUBLISHED", url, remoteId: null, confirmedAt: new Date().toISOString(), lastError: `xác nhận thủ công bởi ${actor}`, updatedAt: new Date().toISOString() });
      await ctx.store.savePublications(projectId, pubs);
      await ctx.queue.transition(jobId, "succeeded", `manual post confirmed by ${actor}`, (x) => ({ ...x, result: { url, confirmedBy: actor } }));
      return `📌 Đã ghi nhận bài đăng thủ công: ${url}`;
    },
  };
}
