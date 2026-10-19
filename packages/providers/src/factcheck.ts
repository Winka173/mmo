import { createHash } from "node:crypto";
import type { Claim } from "@ttm/core";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Strip tags/scripts; collapse whitespace; lowercase for matching. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Re-fetch every source of a claim and check the recorded evidence phrases actually appear.
 * A claim becomes VERIFIED only when enough independent publishers confirm it; otherwise it stays
 * held. Nothing is "verified" without a real fetch.
 */
export async function verifyClaim(
  claim: Claim,
  evidence: Record<string, string[]>,
  opts: { fetchImpl?: FetchLike; now?: Date; timeoutMs?: number; userAgent?: string } = {},
): Promise<{ claim: Claim; log: { url: string; ok: boolean; detail: string }[] }> {
  const f = opts.fetchImpl ?? fetch;
  const now = (opts.now ?? new Date()).toISOString();
  const log: { url: string; ok: boolean; detail: string }[] = [];
  const confirmed = new Set<string>();
  const sources = [];
  for (const s of claim.sources) {
    const phrases = evidence[s.url] ?? [];
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
      const res = await f(s.url, { signal: ctrl.signal, headers: { "user-agent": opts.userAgent ?? "TuToMoFactory-FactCheck/0.1 (+local; respectful)" }, redirect: "follow" });
      clearTimeout(timer);
      if (!res.ok) {
        log.push({ url: s.url, ok: false, detail: `HTTP ${res.status}` });
        sources.push(s);
        continue;
      }
      const html = await res.text();
      const text = htmlToText(html).toLowerCase();
      const missing = phrases.filter((p) => !text.includes(p.toLowerCase()));
      const ok = phrases.length > 0 && missing.length === 0;
      const idx = phrases.length ? text.indexOf(phrases[0].toLowerCase()) : -1;
      const excerpt = idx >= 0 ? htmlToText(html).slice(Math.max(0, idx - 60), idx + 200) : null;
      sources.push({ ...s, fetchedAt: now, excerpt: excerpt?.slice(0, 300) ?? null, contentSha256: createHash("sha256").update(html).digest("hex") });
      log.push({ url: s.url, ok, detail: ok ? "tìm thấy đủ cụm bằng chứng" : `thiếu: ${missing.join(" | ") || "(chưa khai báo cụm bằng chứng)"}` });
      if (ok) confirmed.add(s.publisher.toLowerCase());
    } catch (e: any) {
      log.push({ url: s.url, ok: false, detail: `lỗi mạng: ${e?.name === "AbortError" ? "timeout" : e?.message}` });
      sources.push(s);
    }
  }
  const need = claim.riskTier === "LOW" ? 1 : 2;
  const status = confirmed.size >= need ? "VERIFIED" : claim.status === "VERIFIED" ? "STALE" : claim.status;
  return { claim: { ...claim, sources, status, checkedAt: now }, log };
}
