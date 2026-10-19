import { DataStore, appendJsonl, readJsonl } from "@ttm/storage";
import { canonicalUrl, cosine, hamming, jaccard } from "./similarity.js";

export type HistoryEntry = {
  kind: "published" | "candidate" | "market";
  id: string;
  canonicalUrl: string | null;
  sha256: string | null;
  /** Vietnamese (or translated) concept text used for cross-language comparison */
  conceptVi: string;
  productKey: string | null;
  imageHash: string | null;
  at: string;
};

export type DupMatch = { id: string; kind: HistoryEntry["kind"]; signal: string; score: number };

export type DupResult = {
  matches: DupMatch[];
  maxScore: number;
  novelty: number;
  decision: "UNIQUE_IN_CHECKED_SOURCES" | "POSSIBLE_DUPLICATE_HOLD" | "DUPLICATE_REJECTED";
};

/** Normalised product key: lowercase, strip sizes/colours/punctuation so SKU variants collide. */
export function productKey(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(\d+(ml|g|kg|cm|mm|l|pcs|cai)|mau \w+|size \w+)\b/g, "")
    .replace(/[^a-z0-9一-鿿]+/g, " ")
    .trim()
    .split(" ")
    .sort()
    .join(" ");
}

/**
 * Multi-signal duplicate detection (spec O4): canonical URL, SHA256, perceptual image hash,
 * concept text similarity (translated), product key. Results are "not found in checked sources",
 * never a guarantee of global uniqueness.
 */
export class DuplicateScanner {
  constructor(
    private readonly store: DataStore,
    private readonly opts: { horizonDays?: number; rejectAt?: number; holdAt?: number; doNotReuseUrls?: string[] } = {},
  ) {}

  private file() {
    return this.store.p("discovery", "checksums", "history.jsonl");
  }

  async history(now = new Date()): Promise<HistoryEntry[]> {
    const { records } = await readJsonl<HistoryEntry>(this.file());
    const cutoff = now.getTime() - (this.opts.horizonDays ?? 180) * 86400_000;
    return records.filter((r) => new Date(r.at).getTime() >= cutoff);
  }

  async remember(e: HistoryEntry): Promise<void> {
    await appendJsonl(this.file(), e);
  }

  async scan(c: { url?: string | null; sha256?: string | null; conceptVi: string; productTitle?: string | null; imageHash?: bigint | null }, now = new Date()): Promise<DupResult> {
    const hist = await this.history(now);
    const matches: DupMatch[] = [];
    const cu = c.url ? canonicalUrl(c.url) : null;
    if (cu && (this.opts.doNotReuseUrls ?? []).map(canonicalUrl).includes(cu)) matches.push({ id: "doNotReuseUrls", kind: "published", signal: "url_blocklist", score: 1 });
    const pk = c.productTitle ? productKey(c.productTitle) : null;
    for (const h of hist) {
      if (cu && h.canonicalUrl === cu) matches.push({ id: h.id, kind: h.kind, signal: "canonical_url", score: 1 });
      if (c.sha256 && h.sha256 === c.sha256) matches.push({ id: h.id, kind: h.kind, signal: "sha256", score: 1 });
      if (pk && h.productKey && h.productKey === pk) matches.push({ id: h.id, kind: h.kind, signal: "product_key", score: 0.9 });
      if (c.imageHash != null && h.imageHash) {
        const sim = 1 - hamming(c.imageHash, BigInt(h.imageHash)) / 64;
        if (sim >= 0.85) matches.push({ id: h.id, kind: h.kind, signal: "image_dhash", score: Math.round(sim * 100) / 100 });
      }
      const text = Math.max(jaccard(c.conceptVi, h.conceptVi), cosine(c.conceptVi, h.conceptVi));
      if (text >= 0.45) matches.push({ id: h.id, kind: h.kind, signal: "concept_text", score: Math.round(text * 100) / 100 });
    }
    const maxScore = matches.reduce((m, x) => Math.max(m, x.score), 0);
    const rejectAt = this.opts.rejectAt ?? 0.8;
    const holdAt = this.opts.holdAt ?? 0.55;
    return {
      matches: matches.sort((a, b) => b.score - a.score),
      maxScore,
      novelty: Math.round((1 - maxScore) * 100) / 100,
      decision: maxScore >= rejectAt ? "DUPLICATE_REJECTED" : maxScore >= holdAt ? "POSSIBLE_DUPLICATE_HOLD" : "UNIQUE_IN_CHECKED_SOURCES",
    };
  }
}
