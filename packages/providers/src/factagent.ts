import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { CLAIM_TTL_HOURS, FactoryError, type Claim } from "@ttm/core";
import { htmlToText, type FetchLike } from "./factcheck.js";

export type EvidenceSpec = { phrases: string[]; contradicts?: string[] };
export type SourceLog = { url: string; domain: string; publisher: string; tier: string; ok: boolean; contradiction: boolean; detail: string; fetchedAt: string | null };
export type FactAgentResult = {
  claim: Claim;
  log: SourceLog[];
  independent: { publishers: string[]; domains: string[]; primary: number };
  outcome: "VERIFIED" | "CONTRADICTED" | "MISSING_EVIDENCE" | "INSUFFICIENT" | "STALE";
  reasons: string[];
};

const MULTI_TLD = /\.(com|net|org|gov|edu|ac|co)\.[a-z]{2}$/;
/** Registrable domain approximation (eTLD+1, handles .com.vn/.gov.uk style). Mirrors of one site count once. */
export function registrableDomain(url: string): string {
  const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  const parts = h.split(".");
  return MULTI_TLD.test(h) ? parts.slice(-3).join(".") : parts.slice(-2).join(".");
}

/** SSRF guard: fact sources must be public https hosts — never localhost/private ranges/file URLs. */
export function assertPublicHttps(url: string): void {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new FactoryError("SSRF_BLOCKED", "BLOCKED", `Chỉ truy xuất nguồn https: ${url}`);
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateV4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || (isIP(h) === 4 && privateV4.test(h)) || (isIP(h) === 6 && (h === "::1" || /^f[cd]|^fe80/.test(h))))
    throw new FactoryError("SSRF_BLOCKED", "BLOCKED", `Từ chối truy xuất địa chỉ nội bộ: ${h}`);
}

const UNIT: Record<string, string> = { ngày: "day", day: "day", days: "day", giờ: "hour", hour: "hour", hours: "hour", năm: "year", year: "year", years: "year", triệu: "million", million: "million", tỷ: "billion", billion: "billion", nghìn: "thousand", thousand: "thousand", "%": "%", "°c": "°c", km: "km", kg: "kg" };
const nums = (s: string) => [...s.matchAll(/(\d+(?:[.,]\d+)?)\s*(%|°c|km|kg|ngày|giờ|năm|triệu|tỷ|nghìn|days?|hours?|years?|million|billion|thousand)?/gi)].map((m) => ({ v: Number(m[1].replace(",", ".")), unit: UNIT[(m[2] ?? "").toLowerCase()] ?? "" }));

/** Numbers in the claim that the source states differently for the same unit => contradiction. */
export function numericMismatch(claimText: string, excerpt: string): string | null {
  const c = nums(claimText).filter((x) => x.unit);
  const s = nums(excerpt);
  for (const x of c) {
    const same = s.filter((y) => y.unit === x.unit);
    if (same.length && !same.some((y) => Math.abs(y.v - x.v) <= Math.max(0.01, Math.abs(x.v) * 0.02))) return `claim ghi ${x.v}${x.unit}, nguồn ghi ${same.map((y) => `${y.v}${y.unit}`).join("/")}`;
  }
  return null;
}

export function isClaimStale(c: Claim, now: Date): boolean {
  if (!c.checkedAt) return true;
  return now.getTime() - new Date(c.checkedAt).getTime() > (c.ttlHours ?? CLAIM_TTL_HOURS[c.topic ?? "general"]) * 3600_000;
}

/**
 * FactVerificationAgent: claim-level evidence from authorised sources only. Independent sources are
 * counted by registrable domain AND publisher; HIGH-risk claims need ≥1 primary source; any
 * contradicting phrase or conflicting number => CONTRADICTED (NEEDS_REVIEW, citations kept);
 * nothing reachable => MISSING_EVIDENCE (never invented).
 */
export async function verifyClaimAgent(claim: Claim, evidence: Record<string, EvidenceSpec | string[]>, opts: { fetchImpl?: FetchLike; now?: Date; timeoutMs?: number } = {}): Promise<FactAgentResult> {
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? new Date();
  const iso = now.toISOString();
  const log: SourceLog[] = [];
  const sources = [];
  const confirmedDomains = new Map<string, { publisher: string; tier: string }>();
  const contradictions: string[] = [];
  let reachable = 0;
  for (const s of claim.sources) {
    const spec: EvidenceSpec = Array.isArray(evidence[s.url]) ? { phrases: evidence[s.url] as string[] } : ((evidence[s.url] as EvidenceSpec) ?? { phrases: [] });
    const domain = (() => {
      try {
        return registrableDomain(s.url);
      } catch {
        return "invalid";
      }
    })();
    const base = { url: s.url, domain, publisher: s.publisher, tier: s.tier };
    try {
      assertPublicHttps(s.url);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
      const res = await f(s.url, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "TuToMoFactory-FactAgent/0.2 (+local; respectful)" } });
      clearTimeout(timer);
      if (!res.ok) {
        log.push({ ...base, ok: false, contradiction: false, detail: `HTTP ${res.status}`, fetchedAt: null });
        sources.push(s);
        continue;
      }
      reachable++;
      const html = await res.text();
      const text = htmlToText(html);
      const lower = text.toLowerCase();
      const missing = spec.phrases.filter((p) => !lower.includes(p.toLowerCase()));
      const contra = (spec.contradicts ?? []).filter((p) => lower.includes(p.toLowerCase()));
      const idx = spec.phrases.length ? lower.indexOf(spec.phrases[0].toLowerCase()) : -1;
      const excerpt = idx >= 0 ? text.slice(Math.max(0, idx - 80), idx + 220) : null;
      const numIssue = excerpt ? numericMismatch(claim.text, excerpt) : null;
      const ok = spec.phrases.length > 0 && missing.length === 0 && !contra.length && !numIssue;
      if (contra.length) contradictions.push(`${s.publisher}: có nội dung trái ngược (“${contra[0]}”)`);
      if (numIssue) contradictions.push(`${s.publisher}: ${numIssue}`);
      sources.push({ ...s, fetchedAt: iso, excerpt: excerpt?.slice(0, 300) ?? null, contentSha256: createHash("sha256").update(html).digest("hex") });
      log.push({ ...base, ok, contradiction: !!(contra.length || numIssue), detail: ok ? "đủ cụm bằng chứng" : contra.length ? `mâu thuẫn: ${contra.join(" | ")}` : numIssue ? `số liệu khác: ${numIssue}` : `thiếu: ${missing.join(" | ") || "(chưa khai báo cụm bằng chứng)"}`, fetchedAt: iso });
      if (ok && !confirmedDomains.has(domain)) confirmedDomains.set(domain, { publisher: s.publisher.toLowerCase(), tier: s.tier });
    } catch (e: any) {
      log.push({ ...base, ok: false, contradiction: false, detail: e?.code === "SSRF_BLOCKED" ? e.message : `lỗi mạng: ${e?.name === "AbortError" ? "timeout" : e?.message}`, fetchedAt: null });
      sources.push(s);
    }
  }
  const publishers = [...new Set([...confirmedDomains.values()].map((x) => x.publisher))];
  const domains = [...confirmedDomains.keys()];
  const primary = [...confirmedDomains.values()].filter((x) => x.tier === "primary").length;
  const independentCount = Math.min(publishers.length, domains.length);
  const need = claim.riskTier === "LOW" ? 1 : 2;
  const reasons: string[] = [];
  let outcome: FactAgentResult["outcome"];
  let status: Claim["status"];
  if (contradictions.length) {
    outcome = "CONTRADICTED";
    status = "CONTRADICTED";
    reasons.push(...contradictions);
  } else if (!claim.sources.length || reachable === 0) {
    outcome = "MISSING_EVIDENCE";
    status = claim.status === "VERIFIED" ? "STALE" : claim.status;
    reasons.push(claim.sources.length ? "không truy xuất được nguồn nào — giữ lại, không bịa bằng chứng" : "claim chưa có nguồn");
  } else if (independentCount >= need && (claim.riskTier !== "HIGH" || primary >= 1)) {
    outcome = "VERIFIED";
    status = "VERIFIED";
  } else {
    outcome = claim.status === "VERIFIED" ? "STALE" : "INSUFFICIENT";
    status = claim.status === "VERIFIED" ? "STALE" : claim.status === "UNVERIFIED" ? "UNVERIFIED" : "SOURCED_UNFETCHED";
    if (independentCount < need) reasons.push(`cần ≥${need} nguồn độc lập (khác domain & publisher), mới có ${independentCount}`);
    if (claim.riskTier === "HIGH" && primary < 1) reasons.push("claim rủi ro cao cần ≥1 nguồn gốc (primary)");
  }
  return { claim: { ...claim, sources, status, checkedAt: iso, contradictionNotes: contradictions }, log, independent: { publishers, domains, primary }, outcome, reasons };
}

export type ClaimsDiff = { added: string[]; removed: string[]; changed: string[]; claims: Claim[] };

/** After a script edit: changed claim text resets verification (diff shown in Evidence inspector). */
export function diffClaims(prev: Claim[], next: Claim[]): ClaimsDiff {
  const p = new Map(prev.map((c) => [c.id, c]));
  const n = new Map(next.map((c) => [c.id, c]));
  const added = next.filter((c) => !p.has(c.id)).map((c) => c.id);
  const removed = prev.filter((c) => !n.has(c.id)).map((c) => c.id);
  const changed = next.filter((c) => p.has(c.id) && (p.get(c.id)!.text !== c.text || JSON.stringify(p.get(c.id)!.sources.map((s) => s.url)) !== JSON.stringify(c.sources.map((s) => s.url)))).map((c) => c.id);
  const claims = next.map((c) => (changed.includes(c.id) || added.includes(c.id) ? { ...c, status: c.sources.length ? ("SOURCED_UNFETCHED" as const) : ("UNVERIFIED" as const), checkedAt: null } : c));
  return { added, removed, changed, claims };
}

/** Machine-readable + human citation export (description / credits). */
export function exportCitations(claims: Claim[]): { markdown: string; json: { id: string; claim: string; status: string; sources: { title: string; publisher: string; url: string; accessed: string | null }[] }[] } {
  const json = claims.map((c) => ({ id: c.id, claim: c.text, status: c.status, sources: c.sources.map((s) => ({ title: s.title, publisher: s.publisher, url: s.url, accessed: s.fetchedAt })) }));
  const markdown = ["# Nguồn tham khảo", "", ...json.flatMap((c) => [`- **${c.claim}** _(${c.status})_`, ...c.sources.map((s) => `  - ${s.publisher}: ${s.title} — ${s.url}${s.accessed ? ` (truy cập ${s.accessed.slice(0, 10)})` : " (chưa truy cập)"}`)])].join("\n");
  return { markdown, json };
}
