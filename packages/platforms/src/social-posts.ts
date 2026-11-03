import * as fs from "node:fs/promises";
import path from "node:path";
import { FactoryError } from "@ttm/core";

/**
 * Non-video posts and Page community through the official APIs, written from public documentation and tested only
 * against local fakes (needs account). Every function persists the remote id before returning; nothing retries blindly.
 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type PostKind = "text" | "link" | "image" | "carousel";
export type PostPayload = { kind: PostKind; text: string; link?: string | null; images: { file: string; sha256: string }[] };
export type PostResult = { remoteId: string; url: string | null; raw?: unknown };
export type Persist = (state: { remoteId?: string; step?: string; children?: string[] }) => Promise<void>;
export const POST_SUPPORT: Record<string, { kinds: PostKind[]; api: boolean; vi: string; en: string }> = {
  facebook_reels: { kinds: ["text", "link", "image", "carousel"], api: true, vi: "Facebook Page: chữ, link, một ảnh, nhiều ảnh (Graph API /feed, /photos)", en: "Facebook Page: text, link, single image, multiple images (Graph API /feed, /photos)" },
  instagram_reels: { kinds: ["image", "carousel"], api: true, vi: "Instagram: một ảnh hoặc carousel (Content Publishing API). Ảnh phải có URL công khai: ACS đưa ảnh lên Facebook Page liên kết ở chế độ không đăng để lấy URL.", en: "Instagram: single image or carousel (Content Publishing API). Images need public URLs: ACS uploads them unpublished to the linked Facebook Page to get one." },
  tiktok: { kinds: ["image", "carousel"], api: true, vi: "TikTok: bài ảnh/carousel (Content Posting API, chế độ ảnh). TikTok chỉ kéo ảnh từ tên miền bạn đã xác minh; cần app đã audit.", en: "TikTok: photo/carousel posts (Content Posting API photo mode). TikTok pulls images only from your verified domain; needs an audited app." },
  youtube_long: { kinds: [], api: false, vi: "YouTube: bài cộng đồng KHÔNG có API chính thức. Dùng gói xuất thủ công và đăng trong YouTube Studio.", en: "YouTube: community posts have NO official API. Use the manual export package and post in YouTube Studio." },
  youtube_shorts: { kinds: [], api: false, vi: "YouTube: bài cộng đồng KHÔNG có API chính thức. Dùng gói xuất thủ công và đăng trong YouTube Studio.", en: "YouTube: community posts have NO official API. Use the manual export package and post in YouTube Studio." },
};
async function json(res: Response, platform: string) {
  const body: any = await res.json().catch(() => ({}));
  const err = body?.error && body.error.code !== "ok" ? body.error : null;
  if (res.ok && !err) return body;
  const code = Number(err?.code), msg = String(err?.message ?? err?.code ?? res.status);
  if (res.status === 429 || [4, 17, 32, 613].includes(code) || err?.code === "rate_limit_exceeded") throw new FactoryError(`${platform}_RATE_LIMIT`, "RETRYABLE", `${platform} rate limit`);
  if (code === 190 || res.status === 401 || err?.code === "access_token_invalid") throw new FactoryError("OAUTH_REVOKED", "HUMAN_REQUIRED", `${platform} token expired or revoked; reconnect in Accounts & Keys`);
  if (res.status >= 500) throw new FactoryError(`${platform}_5XX`, "RETRYABLE", `${platform} server error: ${msg}`);
  throw new FactoryError(`${platform}_REQUEST`, "HUMAN_REQUIRED", `${platform} refused the request: ${msg}`);
}
const mime = (file: string) => (/\.png$/i.test(file) ? "image/png" : /\.webp$/i.test(file) ? "image/webp" : "image/jpeg");
async function form(file: string, fields: Record<string, string>) {
  const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v);
  f.append("source", new Blob([await fs.readFile(file)], { type: mime(file) }), path.basename(file)); return f;
}

export type MetaPostConfig = { pageId: string; accessToken: string; fetchImpl?: FetchLike; graphVersion?: string };
const graph = (cfg: MetaPostConfig, p: string) => `https://graph.facebook.com/${cfg.graphVersion ?? "v21.0"}/${p}`;
const auth = (cfg: MetaPostConfig) => ({ authorization: `Bearer ${cfg.accessToken}` });
/** Uploads a photo to the Page without publishing it; returns its id. */
async function unpublishedPhoto(cfg: MetaPostConfig, file: string) {
  const f = cfg.fetchImpl ?? fetch;
  return String((await json(await f(graph(cfg, `${cfg.pageId}/photos`), { method: "POST", headers: auth(cfg), body: await form(file, { published: "false" }) }), "META")).id);
}
export async function publishFacebookPost(cfg: MetaPostConfig, p: PostPayload, persist: Persist, prior?: { remoteId?: string; children?: string[] }): Promise<PostResult> {
  const f = cfg.fetchImpl ?? fetch;
  if (prior?.remoteId) return { remoteId: prior.remoteId, url: `https://www.facebook.com/${prior.remoteId}` };
  if (p.kind === "image") {
    const r = await json(await f(graph(cfg, `${cfg.pageId}/photos`), { method: "POST", headers: auth(cfg), body: await form(p.images[0].file, { caption: p.text, published: "true" }) }), "META");
    const id = String(r.post_id ?? r.id); await persist({ remoteId: id, step: "published" }); return { remoteId: id, url: `https://www.facebook.com/${id}`, raw: r };
  }
  const children = prior?.children ?? [];
  if (p.kind === "carousel") for (const img of p.images.slice(children.length)) { children.push(await unpublishedPhoto(cfg, img.file)); await persist({ children: [...children], step: "photos" }); }
  const body = new URLSearchParams({ message: p.text, ...(p.kind === "link" && p.link ? { link: p.link } : {}) });
  children.forEach((id, i) => body.append(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })));
  const r = await json(await f(graph(cfg, `${cfg.pageId}/feed`), { method: "POST", headers: { ...auth(cfg), "content-type": "application/x-www-form-urlencoded" }, body }), "META");
  const id = String(r.id); await persist({ remoteId: id, step: "published" }); return { remoteId: id, url: `https://www.facebook.com/${id}`, raw: r };
}

export type InstagramPostConfig = { igUserId: string; accessToken: string; host: MetaPostConfig | null; fetchImpl?: FetchLike; pollMs?: number; maxPolls?: number; graphVersion?: string };
/** Instagram reads images only from public URLs. The photo is uploaded unpublished to the linked Page and its CDN URL is used. */
export async function publishInstagramPost(cfg: InstagramPostConfig, p: PostPayload, persist: Persist, prior?: { remoteId?: string }): Promise<PostResult> {
  const f = cfg.fetchImpl ?? fetch, g = (x: string) => `https://graph.facebook.com/${cfg.graphVersion ?? "v21.0"}/${x}`, h = { authorization: `Bearer ${cfg.accessToken}` };
  if (prior?.remoteId) { const info = await json(await f(g(`${prior.remoteId}?fields=id,permalink`), { headers: h }), "META"); return { remoteId: prior.remoteId, url: info.permalink ?? null }; }
  if (!cfg.host) throw new FactoryError("IG_NEEDS_IMAGE_HOST", "HUMAN_REQUIRED", "Instagram needs public image URLs: link a Facebook Page channel to this Instagram channel, or use the manual export package");
  const urls: string[] = [];
  for (const img of p.images) { const id = await unpublishedPhoto({ ...cfg.host, fetchImpl: f }, img.file); const info = await json(await f(graph(cfg.host, `${id}?fields=images`), { headers: auth(cfg.host) }), "META"); const url = info.images?.[0]?.source; if (!url) throw new FactoryError("IG_IMAGE_URL", "HUMAN_REQUIRED", "The host Page did not return an image URL"); urls.push(url); }
  const create = async (q: Record<string, string>) => String((await json(await f(g(`${cfg.igUserId}/media`), { method: "POST", headers: { ...h, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(q) }), "META")).id);
  const container = p.kind === "image" ? await create({ image_url: urls[0], caption: p.text }) : await create({ media_type: "CAROUSEL", caption: p.text, children: (await Promise.all(urls.map((u) => create({ image_url: u, is_carousel_item: "true" })))).join(",") });
  await persist({ step: `container:${container}` });
  for (let i = 0; ; i++) {
    const st = await json(await f(g(`${container}?fields=status_code`), { headers: h }), "META");
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new FactoryError("IG_CONTAINER", "HUMAN_REQUIRED", `Instagram container ${st.status_code}`);
    if (i >= (cfg.maxPolls ?? 20)) throw new FactoryError("IG_PROCESSING", "RETRYABLE", "Instagram is still processing the container");
    await new Promise((r) => setTimeout(r, cfg.pollMs ?? 3000));
  }
  const pub = await json(await f(g(`${cfg.igUserId}/media_publish`), { method: "POST", headers: { ...h, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ creation_id: container }) }), "META");
  await persist({ remoteId: String(pub.id), step: "published" });
  const info = await json(await f(g(`${pub.id}?fields=id,permalink`), { headers: h }), "META");
  return { remoteId: String(pub.id), url: info.permalink ?? null, raw: info };
}

export type TikTokPhotoConfig = { accessToken: string; audited: boolean; verifiedUrlPrefix: string | null; fetchImpl?: FetchLike };
/** TikTok photo mode pulls images from a domain verified in the TikTok developer portal; ACS cannot upload bytes for photos. */
export async function publishTikTokPhotos(cfg: TikTokPhotoConfig, p: PostPayload, persist: Persist, prior?: { remoteId?: string }, privacy: "private" | "public" = "private"): Promise<PostResult> {
  const f = cfg.fetchImpl ?? fetch, h = { authorization: `Bearer ${cfg.accessToken}`, "content-type": "application/json; charset=UTF-8" };
  if (!cfg.audited) throw new FactoryError("TIKTOK_UNAUDITED", "HUMAN_REQUIRED", "TikTok app not audited for Direct Post; use the manual export package");
  if (!cfg.verifiedUrlPrefix || !/^https:\/\//.test(cfg.verifiedUrlPrefix)) throw new FactoryError("TIKTOK_NEEDS_DOMAIN", "HUMAN_REQUIRED", "TikTok photo posts need images on your verified HTTPS domain; set the URL prefix on the channel or use the manual export package");
  let id = prior?.remoteId;
  if (!id) {
    const r = await json(await f("https://open.tiktokapis.com/v2/post/publish/content/init/", { method: "POST", headers: h, body: JSON.stringify({ post_mode: "DIRECT_POST", media_type: "PHOTO", post_info: { title: p.text.slice(0, 90), description: p.text.slice(0, 4000), privacy_level: privacy === "public" ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY", disable_comment: false, auto_add_music: true }, source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: p.images.map((i) => `${cfg.verifiedUrlPrefix!.replace(/\/$/, "")}/${path.basename(i.file)}`) } }) }), "TIKTOK");
    id = String(r.data?.publish_id); await persist({ remoteId: id, step: "init" });
  }
  const st = await json(await f("https://open.tiktokapis.com/v2/post/publish/status/fetch/", { method: "POST", headers: h, body: JSON.stringify({ publish_id: id }) }), "TIKTOK");
  if (st.data?.status === "FAILED") throw new FactoryError("TIKTOK_FAILED", "HUMAN_REQUIRED", `TikTok reported: ${st.data?.fail_reason ?? "failed"}`);
  if (st.data?.status !== "PUBLISH_COMPLETE") throw new FactoryError("TIKTOK_PROCESSING", "RETRYABLE", "TikTok is still processing the photo post");
  return { remoteId: id!, url: null, raw: st.data };
}

/** Read-only metrics where the API offers them. Unknown stays null. */
export async function fetchPostMetrics(platform: string, cfg: { accessToken: string; fetchImpl?: FetchLike }, remoteId: string): Promise<Record<string, number | null> | null> {
  const f = cfg.fetchImpl ?? fetch, h = { authorization: `Bearer ${cfg.accessToken}` };
  try {
    if (platform === "facebook_reels") { const r = await json(await f(`https://graph.facebook.com/v21.0/${remoteId}?fields=reactions.summary(total_count),comments.summary(total_count),shares`, { headers: h }), "META"); return { likes: r.reactions?.summary?.total_count ?? null, comments: r.comments?.summary?.total_count ?? null, shares: r.shares?.count ?? null, views: null }; }
    if (platform === "instagram_reels") { const r = await json(await f(`https://graph.facebook.com/v21.0/${remoteId}?fields=like_count,comments_count`, { headers: h }), "META"); return { likes: r.like_count ?? null, comments: r.comments_count ?? null, views: null }; }
  } catch { return null; }
  return null;
}

/** Facebook Page community: read conversations/comments, send an owner-approved reply. */
export async function listPageInbox(cfg: MetaPostConfig) {
  const f = cfg.fetchImpl ?? fetch;
  const conv = await json(await f(graph(cfg, `${cfg.pageId}/conversations?fields=id,updated_time,participants,messages.limit(5){id,message,from,created_time}&limit=25`), { headers: auth(cfg) }), "META");
  const feed = await json(await f(graph(cfg, `${cfg.pageId}/feed?fields=id,message,created_time,comments.limit(25){id,message,from,created_time}&limit=10`), { headers: auth(cfg) }), "META");
  const messages = (conv.data ?? []).flatMap((c: any) => (c.messages?.data ?? []).filter((m: any) => m.from?.id !== cfg.pageId).map((m: any) => ({ kind: "message" as const, id: String(m.id), threadId: String(c.id), authorId: String(m.from?.id ?? ""), author: String(m.from?.name ?? ""), text: String(m.message ?? ""), at: String(m.created_time ?? ""), postId: null as string | null })));
  const comments = (feed.data ?? []).flatMap((p: any) => (p.comments?.data ?? []).filter((m: any) => m.from?.id !== cfg.pageId).map((m: any) => ({ kind: "comment" as const, id: String(m.id), threadId: String(p.id), authorId: String(m.from?.id ?? ""), author: String(m.from?.name ?? ""), text: String(m.message ?? ""), at: String(m.created_time ?? ""), postId: String(p.id) })));
  return [...messages, ...comments];
}
export async function sendPageReply(cfg: MetaPostConfig, item: { kind: "message" | "comment"; id: string; authorId: string }, text: string) {
  const f = cfg.fetchImpl ?? fetch;
  if (item.kind === "comment") return String((await json(await f(graph(cfg, `${item.id}/comments`), { method: "POST", headers: { ...auth(cfg), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ message: text }) }), "META")).id);
  // Page messages are only allowed as a RESPONSE inside Meta's standard messaging window.
  return String((await json(await f(graph(cfg, `${cfg.pageId}/messages`), { method: "POST", headers: { ...auth(cfg), "content-type": "application/json" }, body: JSON.stringify({ recipient: { id: item.authorId }, messaging_type: "RESPONSE", message: { text } }) }), "META")).message_id);
}
