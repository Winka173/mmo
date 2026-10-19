import { randomInt } from "node:crypto";

export type CommandContext = { chatId: string; userId: string; text: string };

export type CommandHandlers = {
  status(): Promise<string>;
  today(): Promise<string>;
  queue(): Promise<string>;
  report(): Promise<string>;
  cost(): Promise<string>;
  channels(): Promise<string>;
  pause(actor: string): Promise<string>;
  resume(actor: string): Promise<string>;
  approve(jobId: string, actor: string): Promise<string>;
  reject(jobId: string, actor: string): Promise<string>;
  retry(jobId: string, actor: string): Promise<string>;
  posted(jobId: string, url: string, actor: string): Promise<string>;
};

export const HELP = [
  "Lệnh Tủ Tò Mò:",
  "/status — trạng thái worker",
  "/today — việc hôm nay",
  "/queue — hàng đợi",
  "/report — báo cáo ngày",
  "/cost — chi phí tháng",
  "/channels — kết nối nền tảng",
  "/pause, /resume — tạm dừng/tiếp tục (không bỏ qua kiểm tra an toàn)",
  "/approve JOB_ID, /reject JOB_ID, /retry JOB_ID — cần xác nhận 2 bước",
  "/posted JOB_ID URL — ghi nhận bài đã đăng thủ công",
].join("\n");

/** Actions with external consequences need a second confirmation message. */
const CONFIRM_REQUIRED = new Set(["approve", "resume", "retry"]);

/**
 * Authorisation: both chat id AND sender user id must be allowlisted (`/start` grants nothing).
 * Every accepted/rejected command is reported to the audit callback.
 */
export class CommandRouter {
  private pendingConfirm = new Map<string, { cmd: string; arg: string; exp: number; userId: string }>();
  constructor(
    private readonly allowed: { chatIds: string[]; userIds?: string[] },
    private readonly h: CommandHandlers,
    private readonly audit: (e: { action: string; subject: string; detail: Record<string, unknown> }) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  isAuthorized(ctx: CommandContext) {
    const chatOk = this.allowed.chatIds.includes(ctx.chatId);
    const userOk = !this.allowed.userIds?.length || this.allowed.userIds.includes(ctx.userId);
    return chatOk && userOk;
  }

  async handle(ctx: CommandContext): Promise<string | null> {
    const [rawCmd, ...args] = ctx.text.trim().split(/\s+/);
    const cmd = rawCmd?.replace(/^\//, "").replace(/@.*$/, "").toLowerCase();
    if (!rawCmd?.startsWith("/")) return null;
    if (!this.isAuthorized(ctx)) {
      await this.audit({ action: "telegram.unauthorized", subject: ctx.chatId, detail: { userId: ctx.userId, cmd } });
      return "Chat này chưa được cấp quyền. Chủ hệ thống cần thêm chat ID vào allowlist trong Cài đặt.";
    }
    await this.audit({ action: "telegram.command", subject: cmd, detail: { chatId: ctx.chatId, userId: ctx.userId, args } });
    const actor = `telegram:${ctx.userId}`;
    const jobArg = args[0] ?? "";
    switch (cmd) {
      case "start":
      case "help":
        return HELP;
      case "status":
        return this.h.status();
      case "today":
        return this.h.today();
      case "queue":
        return this.h.queue();
      case "report":
        return this.h.report();
      case "cost":
        return this.h.cost();
      case "channels":
        return this.h.channels();
      case "pause":
        return this.h.pause(actor);
      case "reject":
        return jobArg ? this.h.reject(jobArg, actor) : "Cú pháp: /reject JOB_ID";
      case "posted":
        return jobArg && args[1] ? this.h.posted(jobArg, args[1], actor) : "Cú pháp: /posted JOB_ID URL";
      case "confirm": {
        const p = this.pendingConfirm.get(`${ctx.chatId}:${jobArg}`);
        if (!p || p.exp < this.now() || p.userId !== ctx.userId) return "Mã xác nhận không đúng hoặc đã hết hạn.";
        this.pendingConfirm.delete(`${ctx.chatId}:${jobArg}`);
        if (p.cmd === "approve") return this.h.approve(p.arg, actor);
        if (p.cmd === "retry") return this.h.retry(p.arg, actor);
        return this.h.resume(actor);
      }
      default:
        if (CONFIRM_REQUIRED.has(cmd)) {
          if (cmd !== "resume" && !jobArg) return `Cú pháp: /${cmd} JOB_ID`;
          const code = String(randomInt(100000, 999999));
          this.pendingConfirm.set(`${ctx.chatId}:${code}`, { cmd, arg: jobArg, exp: this.now() + 2 * 60_000, userId: ctx.userId });
          return `Xác nhận /${cmd} ${jobArg}: gửi "/confirm ${code}" trong 2 phút.`;
        }
        return `Không hiểu lệnh /${cmd}.\n\n${HELP}`;
    }
  }
}
