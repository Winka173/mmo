import * as fs from "node:fs/promises";
import { FactoryError, type Claim } from "@ttm/core";
import type { LlmProvider } from "./llm.js";
import { TopicBrief } from "./script.js";

export interface Transcreator {
  readonly id: string;
  available(): Promise<boolean>;
  transcreate(brief: TopicBrief, from: string, to: string, glossary: Record<string, string>): Promise<TopicBrief>;
}

/** Human/editor translation dropped as projects/<id>/translations/<lang>.brief.json — preferred, free. */
export class FileTranscreator implements Transcreator {
  readonly id = "human-file";
  constructor(private readonly fileFor: (lang: string) => string) {}
  async available() {
    return true;
  }
  async transcreate(brief: TopicBrief, _from: string, to: string): Promise<TopicBrief> {
    const raw = await fs.readFile(this.fileFor(to), "utf8").catch(() => null);
    if (!raw) throw new FactoryError("NEEDS_TRANSLATION", "HUMAN_REQUIRED", `Chưa có bản chuyển ngữ ${to} (đặt file ${this.fileFor(to)} hoặc cấu hình LLM)`);
    const t = TopicBrief.parse(JSON.parse(raw));
    // structure must match: same claims per point (facts stay tied to the verified ledger)
    if (t.points.length !== brief.points.length || t.points.some((p, i) => JSON.stringify(p.claimIds) !== JSON.stringify(brief.points[i].claimIds)))
      throw new FactoryError("TRANSLATION_MISMATCH", "BLOCKED", "Bản dịch không khớp cấu trúc/claim của bản gốc — không dùng");
    return { ...t, projectId: brief.projectId };
  }
}

/** LLM transcreation (local or paid via its own budget) — transcreate, not word-for-word. */
export class LlmTranscreator implements Transcreator {
  readonly id: string;
  constructor(private readonly llm: LlmProvider) {
    this.id = `llm:${llm.id}`;
  }
  async available() {
    return this.llm.configured;
  }
  async transcreate(brief: TopicBrief, from: string, to: string, glossary: Record<string, string>): Promise<TopicBrief> {
    const out = await this.llm.completeJson(
      {
        system: `You transcreate short educational video scripts from ${from} to ${to}. Keep meaning and every factual claim exactly; adapt idioms and examples for the audience; do NOT add new facts, numbers, prices or claims. Keep claimIds and structure unchanged. Glossary (must use): ${JSON.stringify(glossary)}. Return JSON matching the input shape.`,
        user: JSON.stringify(brief),
        temperature: 0.3,
      },
      TopicBrief,
    );
    if (out.points.length !== brief.points.length || out.points.some((p, i) => JSON.stringify(p.claimIds) !== JSON.stringify(brief.points[i].claimIds)))
      throw new FactoryError("TRANSLATION_MISMATCH", "BLOCKED", "LLM thay đổi cấu trúc/claim — từ chối bản chuyển ngữ");
    return { ...out, projectId: brief.projectId };
  }
}

export const EN_LEXICON: [RegExp, string][] = [
  [/\bTủ Tò Mò\b/g, "Tu To Mo"],
  [/\bShopee\b/g, "Shopee"],
];

export type LocalizationCheck = { code: string; ok: boolean; detail: string };

/**
 * MultilingualEngine: produce a localized brief + the checks that must pass before a localized
 * render can publish: claims re-check for time-sensitive topics, licence geography of every asset,
 * affiliate availability in the target region, localized metadata present.
 */
export async function localizeBrief(x: {
  brief: TopicBrief;
  from: string;
  to: string;
  transcreators: Transcreator[];
  glossary?: Record<string, string>;
  claims: Claim[];
  /** assetId -> allowed regions (null = worldwide/unknown => must be confirmed) */
  assetGeography: Record<string, string[] | null>;
  targetRegion: string;
  affiliateRegions?: string[] | null;
}): Promise<{ brief: TopicBrief | null; via: string | null; checks: LocalizationCheck[] }> {
  const checks: LocalizationCheck[] = [];
  let out: TopicBrief | null = null;
  let via: string | null = null;
  let lastErr = "";
  for (const t of x.transcreators) {
    if (!(await t.available())) continue;
    try {
      out = await t.transcreate(x.brief, x.from, x.to, x.glossary ?? {});
      via = t.id;
      break;
    } catch (e: any) {
      lastErr = e.message;
    }
  }
  checks.push({ code: "TRANSCREATED", ok: !!out, detail: out ? `qua ${via}` : `NEEDS_PROVIDER/NEEDS_TRANSLATION: ${lastErr || "không có bộ chuyển ngữ khả dụng"}` });
  const used = new Set(x.brief.points.flatMap((p) => p.claimIds));
  const recheck = x.claims.filter((c) => used.has(c.id) && (c.timeSensitive || ["news", "price", "spec"].includes(c.topic)));
  checks.push({ code: "CLAIMS_RECHECK", ok: recheck.length === 0, detail: recheck.length ? `cần kiểm chứng lại cho thị trường ${x.targetRegion}: ${recheck.map((c) => c.id).join(", ")}` : "claim không phụ thuộc khu vực/thời điểm" });
  const geoBad = Object.entries(x.assetGeography).filter(([, g]) => g !== null && !g.includes(x.targetRegion) && !g.includes("WORLD"));
  const geoUnknown = Object.entries(x.assetGeography).filter(([, g]) => g === null);
  checks.push({ code: "LICENSE_GEOGRAPHY", ok: geoBad.length === 0 && geoUnknown.length === 0, detail: geoBad.length ? `license không bao gồm ${x.targetRegion}: ${geoBad.map(([a]) => a).join(", ")}` : geoUnknown.length ? `chưa rõ phạm vi địa lý: ${geoUnknown.map(([a]) => a).join(", ")}` : "mọi asset được phép ở khu vực đích" });
  if (x.affiliateRegions !== undefined) checks.push({ code: "AFFILIATE_AVAILABLE", ok: !!x.affiliateRegions?.includes(x.targetRegion), detail: x.affiliateRegions?.includes(x.targetRegion) ? "link affiliate dùng được tại khu vực đích" : `sản phẩm/link affiliate không xác nhận có ở ${x.targetRegion} — bỏ CTA mua hàng` });
  return { brief: out, via, checks };
}
