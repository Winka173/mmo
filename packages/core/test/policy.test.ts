import { describe, expect, it } from "vitest";
import { Claim, Project, Settings, affiliateGate, autoSafeEligibility, canApprove, factGate, idempotencyKey, rightsGate, scoreDiscovery, type MediaRights, type RightsManifest } from "../src/index.js";

const now = new Date("2026-10-19T00:00:00Z");
const project = (o: Partial<Project> = {}) =>
  Project.parse({ schemaVersion: 1, id: "proj-1", contentType: "FACT_SHORT", title: "t", mode: "live", status: "QA", revision: 1, formats: ["short_9x16"], createdAt: now.toISOString(), updatedAt: now.toISOString(), ...o });
const asset = (o: Partial<MediaRights> = {}): MediaRights => ({
  assetId: "asset-1", originUrl: "https://x.test/a", author: "A", ownershipType: "CREATIVE_COMMONS", licenseId: "CC-BY-4.0", licenseEvidencePath: "ev.png",
  commercialUse: true, adaptationAllowed: true, redistributionAllowed: true, platformScope: null, attribution: "A", expiresAt: null, acquiredHow: "official_download", hash: "h", status: "VERIFIED", notes: "", ...o,
});
const manifest = (assets: MediaRights[]): RightsManifest => ({ schemaVersion: 1, projectId: "proj-1", assets, music: [], voice: null });
const claim = (o: Partial<Claim> = {}) =>
  Claim.parse({ id: "cl-1", text: "x", riskTier: "MEDIUM", status: "VERIFIED", checkedAt: now.toISOString(), sources: [
    { url: "https://a.test", title: "A", publisher: "Pub A", tier: "primary", fetchedAt: now.toISOString(), excerpt: "e" },
    { url: "https://b.test", title: "B", publisher: "Pub B", tier: "secondary", fetchedAt: now.toISOString(), excerpt: "e" } ], ...o });

describe("rights gate", () => {
  it("passes verified CC-BY with evidence", () => expect(rightsGate(project(), manifest([asset()]), now).ok).toBe(true));
  it.each([
    [{ ownershipType: "UNKNOWN" as const }, /chưa rõ nguồn gốc/],
    [{ status: "REVOKED" as const }, /REVOKED/],
    [{ expiresAt: "2026-01-01T00:00:00Z" }, /hết hạn/],
    [{ commercialUse: false }, /thương mại/],
    [{ licenseEvidencePath: null }, /bằng chứng/],
  ])("holds %o", (o, re) => {
    const g = rightsGate(project(), manifest([asset(o)]), now);
    expect(g.ok).toBe(false);
    expect(g.hold).toBe("HOLD_RIGHTS");
    expect(g.reasons.join()).toMatch(re);
  });
  it("translation with unknown derivative licence never passes; owned with originality does", () => {
    const tr = project({ contentType: "TRANSLATED_ADAPTATION", originalityChecklist: { newNarration: true, originalLayout: true, substantialEditing: true, uniqueValueNote: "x" } });
    expect(rightsGate(tr, manifest([asset({ adaptationAllowed: null })]), now).ok).toBe(false);
    expect(rightsGate(tr, manifest([asset({ ownershipType: "OWNED", licenseId: "OWNED" })]), now).ok).toBe(true);
    expect(rightsGate(project({ contentType: "TRANSLATED_ADAPTATION" }), manifest([asset({ ownershipType: "OWNED" })]), now).reasons.join()).toMatch(/giá trị gốc/);
  });
});

describe("fact gate", () => {
  it("holds unverified, single-source medium risk, contradictions and stale time-sensitive claims", () => {
    expect(factGate([claim()], now).ok).toBe(true);
    expect(factGate([claim({ status: "SOURCED_UNFETCHED" })], now).ok).toBe(false);
    expect(factGate([claim({ sources: [claim().sources[0]] })], now).reasons.join()).toMatch(/≥2 nguồn/);
    expect(factGate([claim({ contradictionNotes: ["x"] })], now).ok).toBe(false);
    expect(factGate([claim({ timeSensitive: true, checkedAt: "2026-10-10T00:00:00Z" })], now).ok).toBe(false);
  });
});

describe("affiliate gate", () => {
  const prod = { schemaVersion: 1 as const, id: "prod-1", title: "x", isDemo: false, shopeeUrl: null, features: [], disclosure: "d",
    affiliateLink: { url: "https://s.shopee.vn/x", createdAt: now.toISOString(), expiresAt: null, verifiedAt: now.toISOString() }, price: null };
  it("holds demo, missing/expired link, unverified price and unverified features", () => {
    expect(affiliateGate(prod, [], now).ok).toBe(true);
    expect(affiliateGate({ ...prod, isDemo: true }, [], now).ok).toBe(false);
    expect(affiliateGate({ ...prod, affiliateLink: null }, [], now).hold).toBe("HOLD_AFFILIATE");
    expect(affiliateGate({ ...prod, affiliateLink: { ...prod.affiliateLink, expiresAt: "2026-01-01T00:00:00Z" } }, [], now).ok).toBe(false);
    expect(affiliateGate({ ...prod, price: { amountVnd: 1000, verifiedAt: null } }, [], now).ok).toBe(false);
    expect(affiliateGate({ ...prod, features: [{ text: "giữ nóng 12h", claimId: null }] }, [], now).ok).toBe(false);
  });
});

describe("AUTO_SAFE & approval", () => {
  const s = Settings.parse({ schemaVersion: 1, externalPostingEnabled: true, autoSafeOptIns: ["youtube_shorts:FACT_SHORT"] });
  const base = { project: project(), settings: s, platform: "youtube_shorts" as const, gates: [], qaPassed: true, publisherAuthorized: true };
  it("requires opt-in, live, non-sensitive, posting enabled, kill switch off", () => {
    expect(autoSafeEligibility(base).ok).toBe(true);
    expect(autoSafeEligibility({ ...base, platform: "tiktok" }).ok).toBe(false);
    expect(autoSafeEligibility({ ...base, settings: { ...s, killSwitch: true } }).ok).toBe(false);
    expect(autoSafeEligibility({ ...base, project: project({ categories: ["medical"] }) }).ok).toBe(false);
    expect(autoSafeEligibility({ ...base, project: project({ contentType: "NEWS_SUMMARY" }) }).ok).toBe(false);
    expect(autoSafeEligibility({ ...base, settings: Settings.parse({ schemaVersion: 1 }) }).reasons.join()).toMatch(/externalPostingEnabled/);
  });
  it("human approval cannot override rights/fact gates", () => {
    expect(canApprove([rightsGate(project(), manifest([asset({ status: "RIGHTS_REVIEW" })]), now)]).ok).toBe(false);
  });
  it("idempotency key is stable and filename-safe", () => {
    expect(idempotencyKey({ brand: "tutomo", contentId: "p/1", revision: 2, destination: "youtube_shorts" })).toBe("tutomo:p_1:r2:youtube_shorts");
  });
  it("discovery: rights is a hard gate regardless of score", () => {
    const sig = { novelty: 1, marketDuplication: 1, contentQuality: 1, evidenceConfidence: 1, rightsConfidence: 1, productionFit: 1 };
    expect(scoreDiscovery(sig, { rightsGatePassed: false }).decision).toBe("RIGHTS_REJECTED");
    expect(scoreDiscovery(sig, { rightsGatePassed: true }).score).toBe(100);
  });
});
