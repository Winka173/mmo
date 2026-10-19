import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Platform } from "@ttm/core";
import type { Capabilities, LinkSurface, PlatformPublisher, PublishPackage, UploadResult } from "./types.js";

/** Writes an upload kit (MP4 + caption + checklist) the owner posts manually in the official app. */
export async function writeManualKit(dir: string, platform: Platform, pkg: PublishPackage, extraNotes: string[]): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const mp4 = path.join(dir, `${platform}.mp4`);
  await fs.copyFile(pkg.videoFile, mp4);
  if (pkg.thumbnailFile) await fs.copyFile(pkg.thumbnailFile, path.join(dir, `${platform}.thumbnail.png`)).catch(() => undefined); // thumbnail optional
  await fs.writeFile(path.join(dir, "caption.txt"), `${pkg.title}\n\n${pkg.description}\n`, "utf8");
  const checklist = [
    `# Gói đăng thủ công — ${platform}`,
    "",
    `- Dự án: ${pkg.projectId}`,
    `- Idempotency key: ${pkg.idempotencyKey}`,
    `- File: ${path.basename(mp4)} (sha256 ${pkg.videoSha256.slice(0, 16)}…)`,
    `- Lịch đăng đề xuất: ${pkg.publishAt ?? "khi bạn duyệt"}`,
    `- Nội dung tổng hợp/AI: ${pkg.containsSyntheticMedia ? "CÓ — bật nhãn nội dung AI/tổng hợp nếu nền tảng yêu cầu" : "không"}`,
    "",
    "## Việc cần làm",
    "1. Mở ứng dụng chính thức của nền tảng, đăng file MP4 trên.",
    "2. Dán caption từ caption.txt; kiểm tra công bố quảng cáo/affiliate nếu có.",
    "3. Sau khi đăng, gửi URL bài viết cho bot: `/posted <jobId> <url>` để hệ thống ghi nhận (không tự đánh dấu đã đăng).",
    ...extraNotes.map((n) => `- ${n}`),
    "",
  ].join("\n");
  await fs.writeFile(path.join(dir, "CHECKLIST.md"), checklist, "utf8");
  return dir;
}

/**
 * Publisher used when the official API is unavailable/unauthorised for this account.
 * TikTok: Direct Post requires an audited app; unaudited clients are restricted to private posts —
 * a personal tool may not qualify for audit. We never automate the TikTok web UI/cookies.
 */
export class ManualHandoffPublisher implements PlatformPublisher {
  constructor(
    readonly platform: Platform,
    private readonly kitRoot: string,
    private readonly reason: string,
    private readonly notes: string[] = [],
  ) {}
  async validateCapabilities(): Promise<Capabilities> {
    return {
      platform: this.platform,
      configured: false,
      canPublish: false,
      canSchedule: false,
      canOwnComment: false,
      canPin: false,
      accountId: null,
      accountName: null,
      scopes: [],
      tokenExpiresAt: null,
      blockers: [this.reason],
      fallback: "MANUAL_ACTION_REQUIRED",
    };
  }
  async authenticate() {
    return { ok: false, detail: this.reason };
  }
  async upload(pkg: PublishPackage): Promise<UploadResult> {
    const dir = await writeManualKit(path.join(this.kitRoot, this.platform), this.platform, pkg, this.notes);
    return { status: "MANUAL_ACTION_REQUIRED", reason: this.reason, kitDir: dir };
  }
  async pollStatus() {
    return { state: "UNKNOWN" as const, detail: "đăng thủ công — chờ người dùng xác nhận URL" };
  }
  getUrl() {
    return "";
  }
  async tryOwnComment() {
    return { ok: false, reason: "Không có API bình luận — tạo nhiệm vụ Telegram kèm nội dung để copy" };
  }
  async fetchMetrics() {
    return null;
  }
  getSupportedLinkSurfaces(): LinkSurface[] {
    const map: Partial<Record<Platform, LinkSurface[]>> = {
      tiktok: [{ surface: "bio", clickable: "unknown", note: "Link bio chỉ khi tài khoản đủ điều kiện" }],
      instagram: [
        { surface: "caption", clickable: false, note: "Link trong caption Reels không click được" },
        { surface: "bio", clickable: true, note: "Link bio" },
        { surface: "story_link_sticker", clickable: true, note: "Story link sticker (thủ công)" },
      ],
      facebook: [
        { surface: "caption", clickable: true, note: "Caption bài Page" },
        { surface: "own_comment", clickable: true, note: "Bình luận đầu tiên của chính Page (nếu API cho phép)" },
      ],
    };
    return map[this.platform] ?? [];
  }
  async reconcile() {
    return null;
  }
}

/** Deterministic in-memory publisher for integration tests (crash/duplicate/ambiguous scenarios). */
export class MockPublisher implements PlatformPublisher {
  readonly remote = new Map<string, { id: string; key: string }>();
  uploads = 0;
  failNext: null | "ambiguous" | "429" | "crash_after_remote" = null;
  constructor(readonly platform: Platform, public accountId = "acct-ok") {}
  async validateCapabilities(): Promise<Capabilities> {
    return {
      platform: this.platform,
      configured: true,
      canPublish: true,
      canSchedule: true,
      canOwnComment: true,
      canPin: false,
      accountId: this.accountId,
      accountName: "Mock",
      scopes: ["mock"],
      tokenExpiresAt: null,
      blockers: [],
      fallback: null,
    };
  }
  async authenticate() {
    return { ok: true, detail: "mock" };
  }
  async upload(pkg: PublishPackage, persist: (s: { sessionUri?: string; remoteId?: string }) => Promise<void>, prior?: { sessionUri?: string; remoteId?: string }): Promise<UploadResult> {
    if (prior) {
      const r = await this.reconcile(prior, pkg);
      if (r) return r;
    }
    const sessionUri = `mock://session/${pkg.idempotencyKey}`;
    await persist({ sessionUri });
    if (this.failNext === "429") {
      this.failNext = null;
      const { FactoryError } = await import("@ttm/core");
      throw new FactoryError("RATE_LIMIT", "RETRYABLE", "429 mock");
    }
    this.uploads++;
    const id = `mock_${this.uploads}`;
    this.remote.set(sessionUri, { id, key: pkg.idempotencyKey });
    if (this.failNext === "crash_after_remote" || this.failNext === "ambiguous") {
      this.failNext = null;
      throw new Error("mạng mất sau khi gửi — kết quả không rõ");
    }
    await persist({ sessionUri, remoteId: id });
    return { status: "PUBLISHED", remoteId: id, url: this.getUrl(id), confirmedAt: new Date().toISOString() };
  }
  async reconcile(prior: { sessionUri?: string; remoteId?: string }, _pkg?: PublishPackage): Promise<UploadResult | null> {
    const hit = prior.sessionUri ? this.remote.get(prior.sessionUri) : undefined;
    if (hit) return { status: "PUBLISHED", remoteId: hit.id, url: this.getUrl(hit.id), confirmedAt: new Date().toISOString() };
    return null;
  }
  async pollStatus() {
    return { state: "PUBLISHED" as const, detail: "mock" };
  }
  getUrl(id: string) {
    return `https://example.invalid/${this.platform}/${id}`;
  }
  async tryOwnComment() {
    return { ok: true, commentId: "c1" };
  }
  async fetchMetrics() {
    return { views: null };
  }
  getSupportedLinkSurfaces(): LinkSurface[] {
    return [];
  }
}
