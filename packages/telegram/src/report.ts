export type DailyReport = {
  date: string;
  generatedAt: string;
  ideasConsidered: number;
  ideasRejected: { id: string; reason: string }[];
  videosCompleted: { short: number; long: number };
  postsByPlatform: Record<string, { published: number; manual: number; blocked: number; failed: number }>;
  postUrls: { platform: string; url: string; projectId: string }[];
  pendingApprovals: { jobId: string; title: string }[];
  manualActions: { jobId: string; platform: string; reason: string }[];
  /** null = not available (never 0 by assumption) */
  metrics: { views: number | null; engagement: number | null; lastUpdated: string | null } | null;
  shopee: { clicks: number | null; orders: number | null; commissionVnd: number | null; source: string } | null;
  cost: { totalUsd: number; byProvider: Record<string, number>; monthUsd: number; monthCapUsd: number };
  errors: { code: string; count: number; sample: string }[];
  retries: number;
  suggestion: string;
  mode: "demo" | "live";
};

const unk = (v: number | null | undefined, suffix = "") => (v === null || v === undefined ? "chưa có dữ liệu" : `${v.toLocaleString("vi-VN")}${suffix}`);

export function formatDailyReport(r: DailyReport): string {
  const lines: string[] = [];
  lines.push(`📊 Báo cáo Tủ Tò Mò — Ngày ${r.date}${r.mode === "demo" ? " (CHẾ ĐỘ DEMO — không có bài đăng thật)" : ""}`);
  lines.push("");
  lines.push(`💡 Ý tưởng đã xét: ${r.ideasConsidered} (loại ${r.ideasRejected.length})`);
  for (const x of r.ideasRejected.slice(0, 5)) lines.push(`   • ${x.id}: ${x.reason}`);
  lines.push(`🎬 Video hoàn thành: ${r.videosCompleted.short} short, ${r.videosCompleted.long} dài`);
  lines.push("📤 Bài theo nền tảng:");
  const plats = Object.entries(r.postsByPlatform);
  if (!plats.length) lines.push("   • chưa có");
  for (const [p, s] of plats) lines.push(`   • ${p}: đăng ${s.published}, thủ công ${s.manual}, chặn ${s.blocked}, lỗi ${s.failed}`);
  if (r.postUrls.length) {
    lines.push("🔗 Link bài đăng (đã được API xác nhận):");
    for (const u of r.postUrls) lines.push(`   • ${u.platform}: ${u.url}`);
  }
  lines.push(`⏳ Chờ duyệt: ${r.pendingApprovals.length}`);
  for (const a of r.pendingApprovals.slice(0, 5)) lines.push(`   • ${a.jobId} — ${a.title}`);
  lines.push(`✋ Việc thủ công: ${r.manualActions.length}`);
  for (const a of r.manualActions.slice(0, 5)) lines.push(`   • ${a.platform} ${a.jobId}: ${a.reason}`);
  lines.push(`👀 Lượt xem: ${unk(r.metrics?.views)} · tương tác: ${unk(r.metrics?.engagement)}${r.metrics?.lastUpdated ? ` (cập nhật ${r.metrics.lastUpdated})` : ""}`);
  lines.push(
    r.shopee
      ? `🛒 Shopee (${r.shopee.source}): click ${unk(r.shopee.clicks)}, đơn ${unk(r.shopee.orders)}, hoa hồng ${unk(r.shopee.commissionVnd, "đ")}`
      : "🛒 Shopee: chưa nhập báo cáo affiliate",
  );
  lines.push(`💵 Chi phí hôm nay: $${r.cost.totalUsd.toFixed(2)} · tháng: $${r.cost.monthUsd.toFixed(2)} / trần $${r.cost.monthCapUsd.toFixed(2)}`);
  for (const [p, v] of Object.entries(r.cost.byProvider)) lines.push(`   • ${p}: $${v.toFixed(2)}`);
  lines.push(`⚠️ Lỗi: ${r.errors.reduce((a, e) => a + e.count, 0)} · thử lại: ${r.retries}`);
  for (const e of r.errors.slice(0, 5)) lines.push(`   • ${e.code} ×${e.count}: ${e.sample}`);
  lines.push("");
  lines.push(`🧭 Gợi ý ngày mai: ${r.suggestion}`);
  return lines.join("\n");
}
