import { nowIso, type Product } from "@ttm/core";
import type { DataStore } from "@ttm/storage";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type AffiliateCheck = {
  productId: string;
  at: string;
  link: { ok: boolean | null; detail: string };
  price: { usable: boolean; detail: string };
  prohibited: string[];
  evidenceFresh: boolean;
  actions: string[];
  status: "OK" | "NEEDS_INPUT" | "BLOCKED";
};

const ALLOWED_HOSTS = /(^|\.)(shopee\.vn|shp\.ee|s\.shopee\.vn|shopee\.com)$/i;
/** Categories never promoted automatically (platform/ads policies + safety). */
const PROHIBITED = [/thuốc|dược phẩm|chữa bệnh/i, /vũ khí|dao găm|súng/i, /thuốc lá|vape|thuốc lá điện tử/i, /cá cược|casino/i, /rượu/i];

/**
 * Affiliate revalidation (spec Z1). Checks the affiliate link with a lightweight HEAD/GET on the
 * official short-link domain only, never scrapes prices: an unverified/old price is removed from
 * claims or the user is asked to verify. Runs on create, before publish, and on a schedule.
 */
export async function recheckProduct(p: Product, opts: { fetchImpl?: FetchLike; now?: Date; priceMaxAgeHours?: number } = {}): Promise<AffiliateCheck> {
  const now = opts.now ?? new Date();
  const actions: string[] = [];
  let link: AffiliateCheck["link"] = { ok: null, detail: "chưa có link" };
  if (p.affiliateLink) {
    const u = new URL(p.affiliateLink.url);
    if (u.protocol !== "https:" || !ALLOWED_HOSTS.test(u.hostname)) link = { ok: false, detail: `link không thuộc domain chính thức Shopee (${u.hostname})` };
    else if (p.affiliateLink.expiresAt && new Date(p.affiliateLink.expiresAt) <= now) link = { ok: false, detail: "link affiliate đã hết hạn" };
    else
      try {
        const r = await (opts.fetchImpl ?? fetch)(p.affiliateLink.url, { method: "HEAD", redirect: "manual" });
        link = r.status < 400 ? { ok: true, detail: `HTTP ${r.status}` } : { ok: false, detail: `HTTP ${r.status} — link hỏng/hết hạn` };
      } catch (e: any) {
        link = { ok: null, detail: `không kiểm tra được (mạng): ${e.message}` };
      }
  }
  if (link.ok === false) actions.push("Tạo lại link trong Shopee Affiliate rồi cập nhật (không tự thay link)");
  const maxAge = (opts.priceMaxAgeHours ?? 24) * 3600_000;
  const price: AffiliateCheck["price"] = !p.price
    ? { usable: false, detail: "không nêu giá (an toàn)" }
    : !p.price.verifiedAt
      ? { usable: false, detail: "giá chưa xác minh — bỏ giá khỏi kịch bản" }
      : now.getTime() - new Date(p.price.verifiedAt).getTime() > maxAge
        ? { usable: false, detail: `giá xác minh lúc ${p.price.verifiedAt} đã cũ — xác minh lại hoặc bỏ giá` }
        : { usable: true, detail: `giá ${p.price.amountVnd}đ xác minh ${p.price.verifiedAt}` };
  if (p.price && !price.usable) actions.push("Xác minh giá thủ công trên Shopee (không cào giá) hoặc bỏ giá cụ thể khỏi video");
  const prohibited = PROHIBITED.filter((re) => re.test(`${p.title} ${p.features.map((f) => f.text).join(" ")}`)).map((re) => re.source);
  if (prohibited.length) actions.push("Sản phẩm thuộc nhóm hạn chế — không quảng bá tự động");
  const evidenceFresh = !!p.affiliateLink?.verifiedAt && now.getTime() - new Date(p.affiliateLink.verifiedAt).getTime() < 7 * 86400_000;
  const status: AffiliateCheck["status"] = prohibited.length || p.isDemo ? "BLOCKED" : link.ok === false || !p.affiliateLink ? "NEEDS_INPUT" : "OK";
  return { productId: p.id, at: nowIso(now), link, price, prohibited, evidenceFresh, actions, status };
}

/** Apply a recheck result: record verification time; strip an unusable price (never guess one). */
export async function applyRecheck(store: DataStore, p: Product, c: AffiliateCheck): Promise<Product> {
  const next: Product = {
    ...p,
    affiliateLink: p.affiliateLink ? { ...p.affiliateLink, verifiedAt: c.link.ok ? c.at : p.affiliateLink.verifiedAt && c.link.ok === false ? null : p.affiliateLink.verifiedAt } : null,
    price: c.price.usable ? p.price : null,
  };
  await store.saveProduct(next);
  await store.audit({ actor: "affiliate-checker", action: "product.recheck", subject: p.id, detail: { status: c.status, link: c.link.detail, price: c.price.detail } });
  return next;
}

/** Expected vs realised commission (from imported reports) — never inferred from views. */
export function commissionGap(expectedVnd: number | null, realised: { approved: number; paid: number; cancelled: number }): { expected: number | null; realised: number; gapPct: number | null } {
  const real = realised.approved + realised.paid;
  return { expected: expectedVnd, realised: real, gapPct: expectedVnd ? Math.round(((real - expectedVnd) / expectedVnd) * 1000) / 10 : null };
}
