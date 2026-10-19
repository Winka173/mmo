import { FactoryError, newId, nowIso, scoreDiscovery } from "@ttm/core";
import { DataStore, writeJsonAtomic } from "@ttm/storage";
import { decideAcquisition, type AcquisitionDecision } from "./acquire.js";
import type { DiscoverEvent, DiscoveredItem, SourceConnector } from "./connectors.js";
import { DuplicateScanner, type DupResult } from "./duplicates.js";
import { canonicalUrl } from "./similarity.js";

export type Candidate = {
  id: string;
  item: DiscoveredItem;
  canonicalUrl: string;
  conceptVi: string;
  translatedSummary: string | null;
  acquisition: AcquisitionDecision;
  dup: DupResult;
  score: number;
  scoreBreakdown: Record<string, number>;
  decision: "ACCEPT" | "DUPLICATE_REJECTED" | "RIGHTS_REJECTED" | "LOW_SCORE" | "HOLD_DUPLICATE_REVIEW";
  decisionReason: string;
  createdAt: string;
};

export type DecisionTrace = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  query: string;
  steps: { at: string; connector: string; step: string; outcome: string; detail?: unknown }[];
  events: DiscoverEvent[];
  accepted: string[];
  rejected: { id: string; reason: string }[];
  fallbackUsed: string | null;
};

/** Translator is optional; without it, Chinese titles are not "understood" and need owner notes. */
export type Translator = (text: string, from: string) => Promise<string | null>;

/**
 * Discover -> SourceCapabilityCheck -> SearchBrowse -> MetadataNormalize -> RightsPrecheck ->
 * DuplicateScan -> Ranking -> CandidateInbox. Connectors are tried in ladder order; a blocked
 * source falls through to the next lawful one and every decision lands in decision-trace.json.
 */
export async function runDiscovery(input: {
  store: DataStore;
  connectors: SourceConnector[];
  query: string;
  maxItems?: number;
  translator?: Translator;
  now?: Date;
  minNovelty?: number;
}): Promise<{ trace: DecisionTrace; candidates: Candidate[]; traceFile: string }> {
  const now = input.now ?? new Date();
  const runId = newId("disc_");
  const trace: DecisionTrace = { runId, startedAt: nowIso(now), finishedAt: "", query: input.query, steps: [], events: [], accepted: [], rejected: [], fallbackUsed: null };
  const step = (connector: string, s: string, outcome: string, detail?: unknown) => trace.steps.push({ at: nowIso(), connector, step: s, outcome, detail });
  const scanner = new DuplicateScanner(input.store);
  const candidates: Candidate[] = [];

  for (const [idx, conn] of input.connectors.entries()) {
    const caps = conn.capabilities();
    step(conn.id, "SourceCapabilityCheck", caps.join(","));
    if (caps.includes("unsupported")) {
      step(conn.id, "SourceCapabilityCheck", "SOURCE_SKIPPED", "chưa được phép tự động hóa");
      trace.events.push({ level: "warn", code: "SOURCE_SKIPPED", message: `${conn.id}: bỏ qua (chưa được phép/không hỗ trợ) — dùng MANUAL_IMPORT` });
      continue;
    }
    let found: Awaited<ReturnType<SourceConnector["discover"]>>;
    try {
      found = await conn.discover(input.query, { now, maxItems: input.maxItems ?? 20 });
    } catch (e) {
      const fe = e instanceof FactoryError ? e : new FactoryError("CONNECTOR_ERROR", "RETRYABLE", (e as Error).message);
      step(conn.id, "SearchBrowse", fe.code, fe.message);
      trace.events.push({ level: fe.errorClass === "RETRYABLE" ? "warn" : "action", code: fe.code, message: fe.message });
      continue;
    }
    trace.events.push(...found.events);
    step(conn.id, "SearchBrowse", `${found.items.length} mục qua ${found.via}`);
    if (idx > 0 && !trace.fallbackUsed) trace.fallbackUsed = conn.id;

    for (const item of found.items) {
      const cu = canonicalUrl(item.sourceUrl);
      let translated: string | null = null;
      if (item.sourceLanguage !== "vi" && item.sourceLanguage !== "und" && input.translator) translated = await input.translator(`${item.title}\n${item.description}`, item.sourceLanguage);
      const conceptVi = [item.userNotes, translated, item.sourceLanguage === "vi" || item.sourceLanguage === "und" ? `${item.title} ${item.description}` : null].filter(Boolean).join(" ");
      const acquisition = decideAcquisition(item, item.license ? { licenseId: item.license, commercialUse: true, adaptationAllowed: true, redistributionAllowed: null } : null);
      const dup = await scanner.scan({ url: item.sourceUrl, conceptVi: conceptVi || item.title });
      // Rights gate for the *idea*: an idea is always usable for an original remake; reuse of media
      // is gated separately by `acquisition`.
      const rightsOk = acquisition.action !== "RIGHTS_REVIEW";
      const s = scoreDiscovery(
        {
          novelty: dup.novelty,
          marketDuplication: dup.matches.some((m) => m.kind === "market") ? 0.2 : 1,
          contentQuality: Math.min(1, (item.description.length + (item.userNotes?.length ?? 0)) / 200),
          evidenceConfidence: item.userNotes ? 0.6 : 0.3,
          rightsConfidence: acquisition.action === "LOCAL_IMPORT" || acquisition.action === "OFFICIAL_DOWNLOAD" ? 1 : 0.6,
          productionFit: conceptVi ? 0.8 : 0.3,
        },
        { rightsGatePassed: rightsOk, minNovelty: input.minNovelty },
      );
      let decision: Candidate["decision"] = s.decision;
      let reason = s.decision === "ACCEPT" ? "đạt điểm và qua cổng quyền" : s.decision;
      if (dup.decision === "DUPLICATE_REJECTED") [decision, reason] = ["DUPLICATE_REJECTED", `trùng: ${dup.matches[0]?.signal} (${dup.matches[0]?.score})`];
      else if (dup.decision === "POSSIBLE_DUPLICATE_HOLD" && decision === "ACCEPT") [decision, reason] = ["HOLD_DUPLICATE_REVIEW", `có thể trùng: ${dup.matches[0]?.signal}`];
      if (!conceptVi && decision === "ACCEPT") [decision, reason] = ["LOW_SCORE", "chưa hiểu nội dung (thiếu bản dịch/ghi chú tiếng Việt)"];
      const cand: Candidate = {
        id: newId("cand_"),
        item,
        canonicalUrl: cu,
        conceptVi,
        translatedSummary: translated,
        acquisition,
        dup,
        score: s.score,
        scoreBreakdown: s.breakdown,
        decision,
        decisionReason: reason,
        createdAt: nowIso(now),
      };
      candidates.push(cand);
      await writeJsonAtomic(input.store.p("discovery", "candidates", `${cand.id}.json`), cand);
      if (decision === "ACCEPT") {
        trace.accepted.push(cand.id);
        await scanner.remember({ kind: "candidate", id: cand.id, canonicalUrl: cu, sha256: null, conceptVi: conceptVi || item.title, productKey: null, imageHash: null, at: nowIso(now) });
      } else trace.rejected.push({ id: cand.id, reason });
      step(conn.id, "Ranking", decision, { id: cand.id, score: s.score, acquisition: acquisition.action });
    }
  }
  if (!candidates.length) trace.events.push({ level: "action", code: "NO_LAWFUL_SOURCE", message: "Không có nguồn hợp lệ nào trả kết quả — chuyển sang đề tài gốc/owned content." });
  trace.finishedAt = nowIso();
  const traceFile = input.store.p("discovery", "review", `${runId}.decision-trace.json`);
  await writeJsonAtomic(traceFile, trace);
  await input.store.audit({ actor: "discovery", action: "discovery.run", subject: runId, detail: { accepted: trace.accepted.length, rejected: trace.rejected.length } });
  return { trace, candidates, traceFile };
}
