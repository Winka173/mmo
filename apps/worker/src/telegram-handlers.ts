import * as os from "node:os";
import type { Scheduler } from "@ttm/automation";
import type { CommandHandlers } from "@ttm/telegram";
import { type Ctx } from "./context.js";
import { buildDailyReport } from "./report.js";
import { GameRegistry, approveGameVideo, gameReadiness } from "@ttm/games";
import { BudgetRouter } from "@ttm/governance";
import { freeDiskGb, readJson, verifyDataDir } from "@ttm/storage";
import { z } from "zod";

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
      const proj = j.payload.projectId ? await ctx.store.getProject(String(j.payload.projectId)) : null;
      // game videos: approval pins the exact input+asset fingerprint (later thumbnail swap invalidates it)
      if (proj?.gameId) await approveGameVideo(ctx.store, proj.gameId, proj.id, actor);
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
    async emergencyStop(actor) {
      await ctx.store.updateSettings((s) => ({ ...s, killSwitch: true, paused: true }), actor);
      await ctx.store.audit({ actor, action: "emergency.stop", subject: "system" });
      return "🛑 ĐÃ DỪNG KHẨN: kill switch BẬT + tạm dừng. Không đăng, không gọi dịch vụ trả phí. Mở lại: tắt kill switch trong Cài đặt rồi /resume.";
    },
    async budget() {
      const s = await ctx.settings();
      const sp = await new BudgetRouter(ctx.store, [], () => ctx.settings()).spend();
      return [`💰 Chi tiêu (đã gồm tạm giữ ước tính):`, `• Ngày: $${sp.day.toFixed(4)} / trần $${s.spend.dailyUsdCap}`, `• Tuần: $${sp.week.toFixed(4)} / trần $${s.spend.weeklyUsdCap}`, `• Tháng: $${sp.month.toFixed(4)} / trần $${s.budgets.monthlyUsdCap}`, `• Mỗi video: trần $${s.budgets.perVideoUsdCap}`, `Provider trả phí được phép: ${s.spend.paidProviderAllowlist.join(", ") || "không có (chỉ công cụ local)"}`].join("\n");
    },
    async games() {
      const reg = new GameRegistry(ctx.store);
      const list = await reg.list();
      if (!list.length) return "Chưa có game nào.";
      const lines = [];
      for (const g of list) lines.push(`🎮 ${g.gameId} — ${g.publicTitle} (${g.status ?? "?"}) · ${(await reg.listVideos(g.gameId)).length} video · kênh: ${g.destinationAllowlist.join(", ") || "chưa có"}`);
      return lines.join("\n");
    },
    async game(id) {
      const reg = new GameRegistry(ctx.store);
      const g = await reg.get(id);
      if (!g) return `Không có game ${id}`;
      const vids = await reg.listVideos(g.gameId);
      const latest = await reg.latestBuild(g.gameId);
      return [`🎮 ${g.publicTitle} (${g.gameId})`, `Trạng thái: ${g.status ?? "?"} · build mới nhất: ${latest?.version ?? "chưa có"}`, `Phát hành: ${g.releaseDate?.confirmed ? g.releaseDate.date : "chưa xác nhận"}${g.embargoUntil ? ` · embargo đến ${g.embargoUntil}` : ""}`, ...vids.slice(0, 8).map((v) => `• ${v.projectId} [${v.status}] ${v.contentType}`)].join("\n");
    },
    async campaigns() {
      const reg = new GameRegistry(ctx.store);
      const out: string[] = [];
      for (const g of await reg.list()) for (const c of await reg.listCampaigns(g.gameId)) out.push(`• ${g.gameId}/${c.campaignId}: ${c.name} · ${c.kind} · ${c.status} · ${c.startDate ?? "?"}→${c.endDate ?? "?"}`);
      return out.join("\n") || "Chưa có chiến dịch.";
    },
    async review(projectId) {
      const p = await ctx.store.getProject(projectId);
      if (!p) return `Không có dự án ${projectId}`;
      const gates = (await readJson(ctx.store.p("projects", projectId, "gates.json"), z.object({ gates: z.record(z.any()) }).passthrough()).catch(() => null))?.gates ?? {};
      const lines = [`📝 ${p.title} (${p.status}${p.gameId ? `, game ${p.gameId}` : ""})`, ...Object.entries(gates).map(([k, g]: any) => `${g.ok ? "✅" : "⛔"} ${k}${g.reasons?.length ? `: ${g.reasons.slice(0, 2).join("; ")}` : ""}`)];
      if (p.gameId) {
        const r = await gameReadiness(ctx.store, p.gameId, projectId, { analyze: false }).catch(() => null);
        if (r) lines.push(`Sẵn sàng: ${r.readiness.state}`, ...r.readiness.requiresApproval.map((i) => `⚠️ ${i.message}`));
      }
      return lines.join("\n");
    },
    async doctor() {
      const s = await ctx.settings();
      const c = await ctx.queue.counts();
      const v = await verifyDataDir(ctx.store, { hashMedia: false });
      const free = await freeDiskGb(ctx.store.root);
      return [`🩺 Dữ liệu: ${v.ok ? "OK" : "CÓ LỖI"} (${v.issues.length} vấn đề)`, `Ổ đĩa trống: ${free === null ? "?" : free.toFixed(1) + " GB"} (ngưỡng ${s.minFreeDiskGb})`, `Hàng đợi: ${Object.entries(c).map(([k, n]) => `${k}=${n}`).join(", ")}`, `Kill switch ${s.killSwitch ? "BẬT" : "tắt"} · đăng ngoài ${s.externalPostingEnabled ? "BẬT" : "tắt"}`].join("\n");
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
