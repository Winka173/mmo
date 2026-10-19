import * as fs from "node:fs/promises";
import { nowIso } from "@ttm/core";
import { readJsonl, writeJsonAtomic } from "@ttm/storage";
import { formatDailyReport, type DailyReport } from "@ttm/telegram";
import { notify, type Ctx } from "./context.js";

/** Build the end-of-day report purely from files (audit/jobs/publications/costs). Unknown stays unknown. */
export async function buildDailyReport(ctx: Ctx, date?: string): Promise<{ report: DailyReport; text: string; files: string[] }> {
  const settings = await ctx.settings();
  const day = date ?? ctx.store.today(settings.timezone);
  const { records: audit } = await ctx.store.readAudit(day);
  const projects = await ctx.store.listProjects();
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: settings.timezone }).format(new Date(iso));

  let short = 0;
  let long = 0;
  for (const p of projects) {
    for (const f of p.formats) {
      const qa = await ctx.store.getQa(p.id, f);
      if (qa?.passed && dayOf(qa.createdAt) === day) f === "short_9x16" ? short++ : long++;
    }
  }
  const postsByPlatform: DailyReport["postsByPlatform"] = {};
  const postUrls: DailyReport["postUrls"] = [];
  let anyLive = false;
  for (const p of projects) {
    if (p.mode === "live") anyLive = true;
    for (const pub of await ctx.store.getPublications(p.id)) {
      if (dayOf(pub.updatedAt) !== day) continue;
      const s = (postsByPlatform[pub.platform] ??= { published: 0, manual: 0, blocked: 0, failed: 0 });
      if (pub.state === "PUBLISHED" && pub.confirmedAt) {
        s.published++;
        if (pub.url) postUrls.push({ platform: pub.platform, url: pub.url, projectId: p.id });
      } else if (pub.state === "MANUAL_ACTION_REQUIRED") s.manual++;
      else if (["BLOCKED_RIGHTS", "NEEDS_REVIEW", "SKIPPED"].includes(pub.state)) s.blocked++;
      else if (pub.state === "FAILED") s.failed++;
    }
  }
  const review = await ctx.queue.list("needs_review");
  const manual = await ctx.queue.list("manual_action");
  const failed = (await ctx.queue.list("failed")).filter((j) => dayOf(j.updatedAt) === day);
  const errMap = new Map<string, { count: number; sample: string }>();
  for (const j of [...review, ...manual, ...failed]) {
    if (!j.lastError || dayOf(j.lastError.at) !== day) continue;
    const e = errMap.get(j.lastError.errorCode) ?? { count: 0, sample: j.lastError.message.slice(0, 140) };
    e.count++;
    errMap.set(j.lastError.errorCode, e);
  }
  const titleOf = async (j: { payload: Record<string, unknown> }) => (await ctx.store.getProject(String(j.payload.projectId ?? "")))?.title ?? String(j.payload.projectId ?? "?");

  const { records: costRecs } = await readJsonl<{ at: string; provider: string; usd: number }>(ctx.store.p("costs", `${day.slice(0, 7)}.jsonl`));
  const todayCosts = costRecs.filter((c) => dayOf(c.at) === day);
  const byProvider: Record<string, number> = {};
  for (const c of todayCosts) byProvider[c.provider] = (byProvider[c.provider] ?? 0) + c.usd;
  const candidatesDir = ctx.store.p("discovery", "candidates");
  let considered = 0;
  const rejected: DailyReport["ideasRejected"] = [];
  for (const n of await fs.readdir(candidatesDir).catch(() => [] as string[])) {
    const c = JSON.parse(await fs.readFile(ctx.store.p("discovery", "candidates", n), "utf8"));
    if (dayOf(c.createdAt) !== day) continue;
    considered++;
    if (c.decision !== "ACCEPT") rejected.push({ id: c.id, reason: c.decisionReason });
  }
  considered += audit.filter((a) => a.action === "plan.considered").length;
  const retries = audit.filter((a) => a.action === "job.queued" && String(a.detail?.from) === "running").length;

  const report: DailyReport = {
    date: day,
    generatedAt: nowIso(),
    ideasConsidered: considered,
    ideasRejected: rejected,
    videosCompleted: { short, long },
    postsByPlatform,
    postUrls,
    pendingApprovals: await Promise.all(review.map(async (j) => ({ jobId: j.id, title: `${await titleOf(j)} → ${j.payload.platform ?? j.kind}` }))),
    manualActions: manual.map((j) => ({ jobId: j.id, platform: String(j.payload.platform ?? j.kind), reason: j.lastError?.message.slice(0, 160) ?? "" })),
    metrics: null,
    shopee: null,
    cost: { totalUsd: todayCosts.reduce((a, c) => a + c.usd, 0), byProvider, monthUsd: await ctx.store.monthCostUsd(day.slice(0, 7)), monthCapUsd: settings.budgets.monthlyUsdCap },
    errors: [...errMap.entries()].map(([code, e]) => ({ code, ...e })),
    retries,
    suggestion: suggestion(review.length, manual.length, short + long),
    mode: anyLive ? "live" : "demo",
  };
  const text = formatDailyReport(report);
  const jsonFile = ctx.store.p("reports", "daily", `${day}.json`);
  const mdFile = ctx.store.p("reports", "daily", `${day}.md`);
  await writeJsonAtomic(jsonFile, report);
  await fs.writeFile(mdFile, text + "\n", "utf8");
  return { report, text, files: [jsonFile, mdFile] };
}

function suggestion(review: number, manual: number, made: number): string {
  if (review > 0) return `Duyệt ${review} mục đang chờ trước khi lên lịch nội dung mới.`;
  if (manual > 0) return `Hoàn tất ${manual} việc đăng thủ công và gửi lại URL bằng /posted.`;
  if (made === 0) return "Chưa có video mới — kiểm tra Topic Inbox và nguồn ý tưởng.";
  return "Giữ nhịp 1 short/ngày; ưu tiên chủ đề kiến thức chưa trùng trong 90 ngày.";
}

export async function sendDailyReport(ctx: Ctx, date?: string) {
  const r = await buildDailyReport(ctx, date);
  await notify(ctx, r.text, { dedupeKey: `daily-report:${r.report.date}` });
  return r;
}
