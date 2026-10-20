import * as fs from "node:fs/promises";
import { FactoryError } from "@ttm/core";
import type { Capabilities, LinkSurface, PlatformPublisher, PublishPackage, UploadResult, UploadState } from "./types.js";

type FetchLike = typeof fetch;

export type MetaConfig = {
  /** re-verify the current Graph API version at integration time */
  graphVersion?: string;
  pageId?: string | null;
  igUserId?: string | null;
  /** Page access token (DPAPI-stored); never logged */
  accessToken: string | null;
  /** expected identity (wrong-account guard) */
  expectedId?: string | null;
  publishState?: "PUBLISHED" | "DRAFT";
  fetchImpl?: FetchLike;
  pollIntervalMs?: number;
  maxPolls?: number;
};

const NOT_VERIFIED = "Adapter Meta viết theo tài liệu Graph API nhưng CHƯA kiểm chứng với tài khoản thật — thử với Page/IG test trước khi bật";

/**
 * Meta Graph publishing (spec F): Facebook Page Reels (video_reels start → rupload → finish) and
 * Instagram Reels (resumable container → rupload → status FINISHED → media_publish). Persists the
 * remote id BEFORE uploading bytes so a crash reconciles instead of re-posting. Never marks a post
 * PUBLISHED until the API confirms it.
 */
export class MetaPublisher implements PlatformPublisher {
  constructor(readonly platform: "facebook" | "instagram", private readonly cfg: MetaConfig) {}

  private get f() {
    return this.cfg.fetchImpl ?? fetch;
  }
  private get v() {
    return this.cfg.graphVersion ?? "v21.0";
  }
  private get target() {
    return this.platform === "facebook" ? this.cfg.pageId : this.cfg.igUserId;
  }

  private async graph(path: string, init: RequestInit & { query?: Record<string, string> } = {}): Promise<any> {
    if (!this.cfg.accessToken) throw new FactoryError("META_NOT_CONFIGURED", "HUMAN_REQUIRED", "Chưa có token Meta");
    const q = new URLSearchParams({ ...(init.query ?? {}), access_token: this.cfg.accessToken });
    const res = await this.f(`https://graph.facebook.com/${this.v}/${path}?${q}`, { method: init.method ?? "GET", body: init.body, headers: init.headers });
    return this.handle(res);
  }

  private async handle(res: Response): Promise<any> {
    const body: any = await res.json().catch(() => ({}));
    if (res.ok && !body?.error) return body;
    const e = body?.error ?? {};
    const code = Number(e.code);
    if (res.status === 429 || [4, 17, 32, 613].includes(code)) throw new FactoryError("META_RATE_LIMIT", "RETRYABLE", "Meta giới hạn tốc độ");
    if (code === 190) throw new FactoryError("OAUTH_REVOKED", "HUMAN_REQUIRED", "Token Meta hết hạn/bị thu hồi — kết nối lại");
    if ([10, 200, 3, 100].includes(code) && /permission|not authorized|scope/i.test(e.message ?? "")) throw new FactoryError("META_PERMISSION", "HUMAN_REQUIRED", `Thiếu quyền Meta: ${e.message}`);
    if (res.status >= 500 || e.is_transient) throw new FactoryError("META_5XX", "RETRYABLE", `Meta lỗi máy chủ: ${e.message ?? res.status}`);
    throw new FactoryError("META_REQUEST", "PERMANENT", `Meta lỗi ${res.status}: ${e.message ?? "?"}`);
  }

  async validateCapabilities(): Promise<Capabilities> {
    const base: Capabilities = { platform: this.platform, configured: !!(this.cfg.accessToken && this.target), canPublish: false, canSchedule: this.platform === "facebook", canOwnComment: false, canPin: false, accountId: null, accountName: null, scopes: [], tokenExpiresAt: null, blockers: [], fallback: null };
    if (!this.cfg.accessToken || !this.target) return { ...base, blockers: [`Chưa cấu hình ${this.platform === "facebook" ? "Page ID + Page token" : "IG user id + token"} (Meta)`], fallback: "MANUAL_ACTION_REQUIRED" };
    try {
      const me = await this.graph(this.target, { query: { fields: this.platform === "facebook" ? "id,name" : "id,username" } });
      const id = String(me.id);
      if (this.cfg.expectedId && id !== this.cfg.expectedId) return { ...base, accountId: id, accountName: me.name ?? me.username, blockers: [`SAI TÀI KHOẢN: token trỏ tới ${id}, cần ${this.cfg.expectedId}`], fallback: "MANUAL_ACTION_REQUIRED" };
      return { ...base, canPublish: true, canOwnComment: true, accountId: id, accountName: me.name ?? me.username ?? id, scopes: ["(chưa xác minh scope qua debug_token)"], blockers: [NOT_VERIFIED] };
    } catch (e: any) {
      return { ...base, blockers: [e.message], fallback: "MANUAL_ACTION_REQUIRED" };
    }
  }

  async authenticate() {
    const c = await this.validateCapabilities();
    return { ok: c.canPublish, detail: c.blockers.join("; ") };
  }

  private async rupload(url: string, file: string): Promise<void> {
    const data = await fs.readFile(file);
    const res = await this.f(url, { method: "POST", headers: { authorization: `OAuth ${this.cfg.accessToken}`, offset: "0", file_size: String(data.length), "content-type": "application/octet-stream" }, body: data });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || j.success === false) throw new FactoryError(res.status >= 500 ? "META_5XX" : "META_UPLOAD", res.status >= 500 ? "RETRYABLE" : "PERMANENT", `Tải lên Meta thất bại: ${j?.debug_info?.message ?? res.status}`);
  }

  async upload(pkg: PublishPackage, persist: (s: UploadState) => Promise<void>, prior?: UploadState): Promise<UploadResult> {
    if (prior) {
      const r = await this.reconcile(prior, pkg);
      if (r) return r;
    }
    const caption = `${pkg.title}\n\n${pkg.description}`.slice(0, 2200);
    if (this.platform === "facebook") {
      const start = await this.graph(`${this.cfg.pageId}/video_reels`, { method: "POST", query: { upload_phase: "start" } });
      await persist({ remoteId: start.video_id, sessionUri: start.upload_url });
      await this.rupload(start.upload_url ?? `https://rupload.facebook.com/video-upload/${this.v}/${start.video_id}`, pkg.videoFile);
      await this.graph(`${this.cfg.pageId}/video_reels`, { method: "POST", query: { upload_phase: "finish", video_id: start.video_id, video_state: this.cfg.publishState ?? "PUBLISHED", description: caption } });
      return this.confirm(start.video_id);
    }
    const c = await this.graph(`${this.cfg.igUserId}/media`, { method: "POST", query: { media_type: "REELS", upload_type: "resumable", caption, share_to_feed: "true" } });
    await persist({ sessionUri: `ig-container:${c.id}` });
    await this.rupload(c.uri ?? `https://rupload.facebook.com/ig-api-upload/${this.v}/${c.id}`, pkg.videoFile);
    return this.publishContainer(c.id, persist);
  }

  private async publishContainer(containerId: string, persist?: (s: UploadState) => Promise<void>): Promise<UploadResult> {
    for (let i = 0; i < (this.cfg.maxPolls ?? 30); i++) {
      const st = await this.graph(containerId, { query: { fields: "status_code,status" } });
      if (st.status_code === "FINISHED") break;
      if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new FactoryError("META_CONTAINER_" + st.status_code, st.status_code === "EXPIRED" ? "RETRYABLE" : "PERMANENT", `Container IG ${st.status_code}: ${st.status ?? ""}`);
      if (i === (this.cfg.maxPolls ?? 30) - 1) return { status: "MANUAL_ACTION_REQUIRED", reason: "Container IG chưa xử lý xong — kiểm tra lại sau (không đánh dấu đã đăng)" };
      await new Promise((r) => setTimeout(r, this.cfg.pollIntervalMs ?? 5000));
    }
    const pub = await this.graph(`${this.cfg.igUserId}/media_publish`, { method: "POST", query: { creation_id: containerId } });
    await persist?.({ sessionUri: `ig-container:${containerId}`, remoteId: pub.id });
    return this.confirm(pub.id);
  }

  private async confirm(id: string): Promise<UploadResult> {
    const fields = this.platform === "facebook" ? "status,permalink_url" : "permalink,id";
    const info = await this.graph(id, { query: { fields } }).catch(() => ({}));
    const url = this.platform === "facebook" ? (info.permalink_url ? `https://www.facebook.com${String(info.permalink_url).replace(/^https:\/\/www\.facebook\.com/, "")}` : `https://www.facebook.com/reel/${id}`) : (info.permalink ?? `https://www.instagram.com/`);
    const processing = this.platform === "facebook" && info.status && info.status.video_status && info.status.video_status !== "ready";
    return { status: processing ? "PROCESSING" : "PUBLISHED", remoteId: id, url, confirmedAt: new Date().toISOString(), raw: info };
  }

  async reconcile(prior: UploadState, _pkg: PublishPackage): Promise<UploadResult | null> {
    if (this.platform === "instagram") {
      if (prior.remoteId) return this.confirm(prior.remoteId);
      const cid = prior.sessionUri?.startsWith("ig-container:") ? prior.sessionUri.slice(13) : null;
      if (!cid) return null;
      const st = await this.graph(cid, { query: { fields: "status_code" } }).catch(() => null);
      if (st?.status_code === "PUBLISHED") return { status: "MANUAL_ACTION_REQUIRED", reason: `Container ${cid} đã đăng nhưng chưa ghi media id — kiểm tra trên Instagram rồi xác nhận /posted (không đăng lại)` };
      if (st?.status_code === "FINISHED") return this.publishContainer(cid);
      return null;
    }
    if (!prior.remoteId) return null;
    const v = await this.graph(prior.remoteId, { query: { fields: "status" } }).catch(() => null);
    if (!v) return null;
    if (v.status?.uploading_phase?.status === "complete" || v.status?.publishing_phase?.status === "complete" || v.status?.video_status === "ready") return this.confirm(prior.remoteId);
    if (v.status?.uploading_phase?.status === "not_started") return null; // safe to start over
    return { status: "MANUAL_ACTION_REQUIRED", reason: `Video ${prior.remoteId} đang ở trạng thái không rõ — kiểm tra trên Facebook, không tải lại` };
  }

  async pollStatus(remoteId: string) {
    const v = await this.graph(remoteId, { query: { fields: this.platform === "facebook" ? "status" : "id" } }).catch((e) => ({ error: e.message }));
    if ((v as any).error) return { state: "UNKNOWN" as const, detail: (v as any).error };
    if (this.platform === "instagram") return { state: "PUBLISHED" as const, detail: "media tồn tại" };
    const s = (v as any).status?.video_status;
    return s === "ready" ? { state: "PUBLISHED" as const, detail: "ready" } : s === "error" ? { state: "FAILED" as const, detail: "error" } : { state: "PROCESSING" as const, detail: s ?? "?" };
  }
  getUrl(id: string) {
    return this.platform === "facebook" ? `https://www.facebook.com/reel/${id}` : "https://www.instagram.com/";
  }
  async tryOwnComment(remoteId: string, text: string) {
    try {
      const r = await this.graph(`${remoteId}/comments`, { method: "POST", query: { message: text.slice(0, 2000) } });
      return { ok: true, commentId: String(r.id) };
    } catch (e: any) {
      return { ok: false, reason: e.message };
    }
  }
  async fetchMetrics(remoteId: string): Promise<Record<string, number | null> | null> {
    try {
      if (this.platform === "instagram") {
        const r = await this.graph(`${remoteId}/insights`, { query: { metric: "reach,likes,comments,shares,saved" } });
        const get = (n: string) => r.data?.find((x: any) => x.name === n)?.values?.[0]?.value ?? null;
        return { views: null, reach: get("reach"), likes: get("likes"), comments: get("comments"), shares: get("shares"), saves: get("saved") };
      }
      const r = await this.graph(`${remoteId}/video_insights`, { query: { metric: "total_video_views,total_video_impressions" } });
      const get = (n: string) => r.data?.find((x: any) => x.name === n)?.values?.[0]?.value ?? null;
      return { views: get("total_video_views"), impressions: get("total_video_impressions") };
    } catch {
      return null;
    }
  }
  getSupportedLinkSurfaces(): LinkSurface[] {
    return this.platform === "facebook"
      ? [{ surface: "caption", clickable: true, note: "Link trong mô tả Reels Page thường click được" }, { surface: "own_first_comment", clickable: true, note: "Bình luận đầu trên bài của chính Page" }]
      : [{ surface: "caption", clickable: false, note: "Link caption IG không click được" }, { surface: "bio", clickable: true, note: "Cập nhật link bio thủ công" }, { surface: "story_link_sticker", clickable: true, note: "Story sticker — thao tác thủ công" }];
  }
}

export type TikTokConfig = { accessToken: string | null; audited: boolean; fetchImpl?: FetchLike; expectedOpenId?: string | null; chunkSize?: number };

/**
 * TikTok Content Posting API. Unaudited clients may only post SELF_ONLY (private) and personal tools
 * may never pass audit, so the default is MANUAL_ACTION_REQUIRED. With an audited app + token we use
 * creator_info → video/init (FILE_UPLOAD) → chunk PUT → status/fetch. No web/cookie automation.
 */
export class TikTokPublisher implements PlatformPublisher {
  readonly platform = "tiktok" as const;
  constructor(private readonly cfg: TikTokConfig) {}
  private get f() {
    return this.cfg.fetchImpl ?? fetch;
  }
  private async api(path: string, body: unknown): Promise<any> {
    const res = await this.f(`https://open.tiktokapis.com/v2/${path}`, { method: "POST", headers: { authorization: `Bearer ${this.cfg.accessToken}`, "content-type": "application/json; charset=UTF-8" }, body: JSON.stringify(body) });
    const j: any = await res.json().catch(() => ({}));
    const code = j?.error?.code;
    if (res.ok && (!code || code === "ok")) return j.data;
    if (res.status === 429 || code === "rate_limit_exceeded") throw new FactoryError("TIKTOK_RATE_LIMIT", "RETRYABLE", "TikTok giới hạn tốc độ");
    if (code === "access_token_invalid" || res.status === 401) throw new FactoryError("OAUTH_REVOKED", "HUMAN_REQUIRED", "Token TikTok không hợp lệ/hết hạn");
    if (code === "unaudited_client_can_only_post_to_private_accounts" || code === "spam_risk_too_many_posts" || code === "privacy_level_option_mismatch") throw new FactoryError("TIKTOK_RESTRICTED", "HUMAN_REQUIRED", `TikTok hạn chế: ${code}`);
    throw new FactoryError("TIKTOK_REQUEST", res.status >= 500 ? "RETRYABLE" : "PERMANENT", `TikTok lỗi: ${code ?? res.status} ${j?.error?.message ?? ""}`);
  }
  async validateCapabilities(): Promise<Capabilities> {
    const base: Capabilities = { platform: "tiktok", configured: !!this.cfg.accessToken, canPublish: false, canSchedule: false, canOwnComment: false, canPin: false, accountId: null, accountName: null, scopes: [], tokenExpiresAt: null, blockers: [], fallback: "MANUAL_ACTION_REQUIRED" };
    if (!this.cfg.accessToken) return { ...base, blockers: ["Chưa có token TikTok — đăng thủ công"] };
    if (!this.cfg.audited) return { ...base, blockers: ["App TikTok chưa được audit: Direct Post chỉ cho phép riêng tư (SELF_ONLY) — dùng gói đăng thủ công"] };
    try {
      const ci = await this.api("post/publish/creator_info/query/", {});
      if (this.cfg.expectedOpenId && ci.creator_username && ci.creator_username !== this.cfg.expectedOpenId) return { ...base, accountName: ci.creator_username, blockers: [`SAI TÀI KHOẢN: ${ci.creator_username}`] };
      return { ...base, canPublish: true, fallback: null, accountId: ci.creator_username ?? null, accountName: ci.creator_nickname ?? null, scopes: ["video.publish"], blockers: [NOT_VERIFIED.replace("Meta", "TikTok")] };
    } catch (e: any) {
      return { ...base, blockers: [e.message] };
    }
  }
  async authenticate() {
    const c = await this.validateCapabilities();
    return { ok: c.canPublish, detail: c.blockers.join("; ") };
  }
  async upload(pkg: PublishPackage, persist: (s: UploadState) => Promise<void>, prior?: UploadState): Promise<UploadResult> {
    if (prior?.remoteId) {
      const r = await this.reconcile(prior);
      if (r) return r;
    }
    const data = await fs.readFile(pkg.videoFile);
    const chunk = Math.min(data.length, this.cfg.chunkSize ?? 10_000_000);
    const total = Math.max(1, Math.floor(data.length / chunk));
    const init = await this.api("post/publish/video/init/", {
      post_info: { title: `${pkg.title}`.slice(0, 2200), privacy_level: pkg.privacy === "public" ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY", disable_comment: false, brand_content_toggle: false, is_aigc: pkg.containsSyntheticMedia },
      source_info: { source: "FILE_UPLOAD", video_size: data.length, chunk_size: chunk, total_chunk_count: total },
    });
    await persist({ remoteId: init.publish_id, sessionUri: init.upload_url });
    for (let i = 0; i < total; i++) {
      const s = i * chunk;
      const e = i === total - 1 ? data.length : s + chunk;
      const res = await this.f(init.upload_url, { method: "PUT", headers: { "content-type": "video/mp4", "content-range": `bytes ${s}-${e - 1}/${data.length}` }, body: data.subarray(s, e) });
      if (!res.ok) throw new FactoryError("TIKTOK_UPLOAD", res.status >= 500 ? "RETRYABLE" : "PERMANENT", `TikTok upload lỗi ${res.status}`);
    }
    return (await this.reconcile({ remoteId: init.publish_id })) ?? { status: "MANUAL_ACTION_REQUIRED", reason: "Chưa xác nhận trạng thái đăng TikTok" };
  }
  async reconcile(prior: UploadState): Promise<UploadResult | null> {
    if (!prior.remoteId) return null;
    const st = await this.api("post/publish/status/fetch/", { publish_id: prior.remoteId });
    if (st.status === "PUBLISH_COMPLETE") {
      const id = st.publicaly_available_post_id?.[0] ?? st.publicly_available_post_id?.[0] ?? prior.remoteId;
      return { status: "PUBLISHED", remoteId: String(id), url: `https://www.tiktok.com/video/${id}`, confirmedAt: new Date().toISOString(), raw: st };
    }
    if (st.status === "FAILED") throw new FactoryError("TIKTOK_FAILED", "PERMANENT", `TikTok báo lỗi: ${st.fail_reason ?? "?"}`);
    return { status: "PROCESSING", remoteId: prior.remoteId, url: "https://www.tiktok.com/", confirmedAt: new Date().toISOString(), raw: st };
  }
  async pollStatus(remoteId: string) {
    const r = await this.reconcile({ remoteId }).catch((e) => ({ status: "ERR", reason: e.message }) as any);
    return r?.status === "PUBLISHED" ? { state: "PUBLISHED" as const, detail: "ok" } : r?.status === "PROCESSING" ? { state: "PROCESSING" as const, detail: "processing" } : { state: "UNKNOWN" as const, detail: r?.reason ?? "?" };
  }
  getUrl(id: string) {
    return `https://www.tiktok.com/video/${id}`;
  }
  async tryOwnComment() {
    return { ok: false, reason: "Content Posting API không có endpoint bình luận — làm thủ công" };
  }
  async fetchMetrics() {
    return null;
  }
  getSupportedLinkSurfaces(): LinkSurface[] {
    return [{ surface: "bio", clickable: true, note: "Link bio nếu tài khoản đủ điều kiện" }];
  }
}
