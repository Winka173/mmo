import * as fs from "node:fs/promises";
import { FactoryError } from "@ttm/core";
import type { Capabilities, LinkSurface, PlatformPublisher, PublishPackage, UploadResult, UploadState } from "./types.js";

type FetchLike = typeof fetch;

export type GoogleCreds = { clientId: string; clientSecret: string; refreshToken: string };

const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const API = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.force-ssl", "https://www.googleapis.com/auth/youtube.readonly"];

/**
 * YouTube Data API v3. Shorts and long videos use the same `videos.insert` endpoint; YouTube
 * decides Shorts classification from the video itself — we never claim a Shorts classification.
 * Note: uploads from unverified API projects may be locked to private by YouTube; we report the
 * real `privacyStatus` returned, never the requested one.
 */
export class YouTubePublisher implements PlatformPublisher {
  private accessToken: { token: string; exp: number } | null = null;
  constructor(
    readonly platform: "youtube_shorts" | "youtube_long",
    private readonly creds: GoogleCreds | null,
    private readonly opts: { fetchImpl?: FetchLike; expectedChannelId?: string | null } = {},
  ) {}

  private get f() {
    return this.opts.fetchImpl ?? fetch;
  }

  private async token(): Promise<string> {
    if (!this.creds) throw new FactoryError("YT_NOT_CONFIGURED", "HUMAN_REQUIRED", "Chưa kết nối YouTube (OAuth).");
    if (this.accessToken && this.accessToken.exp > Date.now() + 60_000) return this.accessToken.token;
    const res = await this.f("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.creds.clientId, client_secret: this.creds.clientSecret, refresh_token: this.creds.refreshToken, grant_type: "refresh_token" }),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (j.error === "invalid_grant") throw new FactoryError("OAUTH_REVOKED", "HUMAN_REQUIRED", "Token YouTube đã hết hạn hoặc bị thu hồi — cần kết nối lại.");
      throw new FactoryError("OAUTH_ERROR", res.status >= 500 ? "RETRYABLE" : "HUMAN_REQUIRED", `Lỗi OAuth Google: ${j.error ?? res.status}`);
    }
    this.accessToken = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  }

  private async api(path: string, init: RequestInit = {}): Promise<any> {
    const res = await this.f(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${await this.token()}`, "content-type": "application/json", ...(init.headers ?? {}) } });
    return this.handle(res);
  }

  private async handle(res: Response): Promise<any> {
    const body: any = await res.json().catch(() => ({}));
    if (res.ok) return body;
    const reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? String(res.status);
    if (res.status === 429 || reason === "rateLimitExceeded") throw new FactoryError("YT_RATE_LIMIT", "RETRYABLE", "YouTube giới hạn tốc độ (429)");
    if (reason === "quotaExceeded" || reason === "uploadLimitExceeded")
      throw new FactoryError("YT_QUOTA", "RETRYABLE", "Hết quota YouTube Data API hôm nay", { retryAfter: null, nextAction: "Chờ quota reset (nửa đêm giờ Pacific)" });
    if (res.status === 401 || res.status === 403) throw new FactoryError("YT_FORBIDDEN", "HUMAN_REQUIRED", `YouTube từ chối quyền: ${reason}`);
    if (res.status >= 500) throw new FactoryError("YT_5XX", "RETRYABLE", `YouTube lỗi máy chủ ${res.status}`);
    throw new FactoryError("YT_REQUEST", "PERMANENT", `YouTube lỗi ${res.status}: ${reason}`);
  }

  async validateCapabilities(): Promise<Capabilities> {
    const base: Capabilities = {
      platform: this.platform,
      configured: !!this.creds,
      canPublish: false,
      canSchedule: false,
      canOwnComment: false,
      canPin: false,
      accountId: null,
      accountName: null,
      scopes: [],
      tokenExpiresAt: null,
      blockers: [],
      fallback: null,
    };
    if (!this.creds) return { ...base, blockers: ["Chưa kết nối OAuth YouTube"], fallback: "NOT_CONFIGURED" };
    try {
      const tok = await this.token();
      const info: any = await (await this.f(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(tok)}`)).json().catch(() => ({}));
      const scopes = String(info.scope ?? "").split(" ").filter(Boolean);
      const ch = await this.api("/channels?part=id,snippet&mine=true");
      const channel = ch.items?.[0];
      const blockers: string[] = [];
      if (!channel) blockers.push("Tài khoản không có kênh YouTube");
      if (!scopes.includes(YOUTUBE_SCOPES[0])) blockers.push("Thiếu scope youtube.upload");
      if (this.opts.expectedChannelId && channel && channel.id !== this.opts.expectedChannelId)
        blockers.push(`SAI TÀI KHOẢN: đang kết nối kênh ${channel.id}, cấu hình yêu cầu ${this.opts.expectedChannelId}`);
      return {
        ...base,
        canPublish: blockers.length === 0,
        canSchedule: blockers.length === 0,
        canOwnComment: scopes.includes(YOUTUBE_SCOPES[1]),
        accountId: channel?.id ?? null,
        accountName: channel?.snippet?.title ?? null,
        scopes,
        tokenExpiresAt: this.accessToken ? new Date(this.accessToken.exp).toISOString() : null,
        blockers,
        fallback: blockers.length ? "MANUAL_ACTION_REQUIRED" : null,
      };
    } catch (e: any) {
      return { ...base, blockers: [e.message], fallback: "MANUAL_ACTION_REQUIRED" };
    }
  }

  async authenticate() {
    try {
      await this.token();
      return { ok: true, detail: "Đã làm mới access token" };
    } catch (e: any) {
      return { ok: false, detail: e.message };
    }
  }

  async upload(pkg: PublishPackage, persist: (s: UploadState) => Promise<void>, prior?: UploadState): Promise<UploadResult> {
    if (!this.creds) return { status: "NOT_CONFIGURED", reason: "Chưa kết nối YouTube" };
    if (prior?.sessionUri || prior?.remoteId) {
      const r = await this.reconcile(prior, pkg);
      if (r) return r;
    }
    const stat = await fs.stat(pkg.videoFile);
    const meta = {
      snippet: { title: pkg.title, description: pkg.description, tags: pkg.tags, categoryId: pkg.categoryId ?? "27", defaultLanguage: "vi", defaultAudioLanguage: "vi" },
      status: {
        privacyStatus: pkg.publishAt ? "private" : pkg.privacy,
        ...(pkg.publishAt ? { publishAt: pkg.publishAt } : {}),
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: pkg.containsSyntheticMedia,
      },
    };
    const init = await this.f(UPLOAD_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.token()}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-length": String(stat.size),
        "x-upload-content-type": "video/mp4",
      },
      body: JSON.stringify(meta),
    });
    if (!init.ok) await this.handle(init);
    const sessionUri = init.headers.get("location");
    if (!sessionUri) throw new FactoryError("YT_NO_SESSION", "RETRYABLE", "YouTube không trả về resumable session URI");
    await persist({ sessionUri });
    return this.sendBytes(sessionUri, pkg, 0, stat.size, persist);
  }

  private async sendBytes(sessionUri: string, pkg: PublishPackage, from: number, size: number, persist: (s: UploadState) => Promise<void>): Promise<UploadResult> {
    const data = await fs.readFile(pkg.videoFile);
    const res = await this.f(sessionUri, {
      method: "PUT",
      headers: { authorization: `Bearer ${await this.token()}`, "content-type": "video/mp4", "content-range": `bytes ${from}-${size - 1}/${size}` },
      body: data.subarray(from),
    });
    if (res.status === 308) throw new FactoryError("YT_UPLOAD_INCOMPLETE", "RETRYABLE", "Upload YouTube chưa hoàn tất — sẽ tiếp tục từ byte đã nhận");
    const video = await this.handle(res);
    await persist({ sessionUri, remoteId: video.id });
    return this.confirmed(video);
  }

  private confirmed(video: any): UploadResult {
    const processing = video?.status?.uploadStatus === "uploaded" || video?.processingDetails?.processingStatus === "processing";
    return { status: processing ? "PROCESSING" : "PUBLISHED", remoteId: video.id, url: this.getUrl(video.id), confirmedAt: new Date().toISOString(), raw: { privacyStatus: video?.status?.privacyStatus, uploadStatus: video?.status?.uploadStatus } };
  }

  async reconcile(prior: UploadState, pkg: PublishPackage): Promise<UploadResult | null> {
    if (prior.remoteId) {
      const r = await this.api(`/videos?part=status,processingDetails&id=${encodeURIComponent(prior.remoteId)}`);
      if (r.items?.[0]) return this.confirmed(r.items[0]);
    }
    if (prior.sessionUri) {
      const stat = await fs.stat(pkg.videoFile);
      const res = await this.f(prior.sessionUri, { method: "PUT", headers: { authorization: `Bearer ${await this.token()}`, "content-range": `bytes */${stat.size}` } });
      if (res.status === 200 || res.status === 201) return this.confirmed(await res.json());
      if (res.status === 308) {
        const range = res.headers.get("range");
        const next = range ? Number(range.split("-")[1]) + 1 : 0;
        return this.sendBytes(prior.sessionUri, pkg, next, stat.size, async () => undefined);
      }
      // 404/410: session expired without completing -> safe to start a new upload
    }
    return null;
  }

  async pollStatus(remoteId: string) {
    const r = await this.api(`/videos?part=status,processingDetails&id=${encodeURIComponent(remoteId)}`);
    const v = r.items?.[0];
    if (!v) return { state: "UNKNOWN" as const, detail: "Không tìm thấy video" };
    if (v.status?.uploadStatus === "processed") return { state: "PUBLISHED" as const, detail: `privacy=${v.status.privacyStatus}` };
    if (["failed", "rejected", "deleted"].includes(v.status?.uploadStatus)) return { state: "FAILED" as const, detail: `${v.status.uploadStatus}: ${v.status.failureReason ?? v.status.rejectionReason ?? ""}` };
    return { state: "PROCESSING" as const, detail: v.processingDetails?.processingStatus ?? v.status?.uploadStatus };
  }

  getUrl(remoteId: string) {
    return this.platform === "youtube_shorts" ? `https://www.youtube.com/shorts/${remoteId}` : `https://www.youtube.com/watch?v=${remoteId}`;
  }

  async tryOwnComment(remoteId: string, text: string) {
    try {
      const r = await this.api("/commentThreads?part=snippet", { method: "POST", body: JSON.stringify({ snippet: { videoId: remoteId, topLevelComment: { snippet: { textOriginal: text } } } }) });
      return { ok: true, commentId: r.id };
    } catch (e: any) {
      return { ok: false, reason: e.message };
    }
  }

  async fetchMetrics(remoteId: string) {
    const r = await this.api(`/videos?part=statistics&id=${encodeURIComponent(remoteId)}`);
    const s = r.items?.[0]?.statistics;
    if (!s) return null;
    const n = (x: unknown) => (x === undefined ? null : Number(x));
    return { views: n(s.viewCount), likes: n(s.likeCount), comments: n(s.commentCount) };
  }

  getSupportedLinkSurfaces(): LinkSurface[] {
    return this.platform === "youtube_long"
      ? [
          { surface: "description", clickable: true, note: "Link trong mô tả video dài" },
          { surface: "own_comment", clickable: "unknown", note: "Bình luận của chính kênh qua commentThreads.insert; không tự ghim" },
        ]
      : [
          { surface: "description", clickable: "unknown", note: "Shorts: link trong mô tả có thể không click được — kiểm tra chính sách hiện hành" },
          { surface: "related_video", clickable: true, note: "Liên kết video liên quan đặt thủ công trong YouTube Studio" },
        ];
  }
}
