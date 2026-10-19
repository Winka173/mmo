import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FactoryError } from "@ttm/core";
import { DataStore } from "@ttm/storage";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  BrowserPublicConnector, DEFAULT_SOURCE_POLICIES, DuplicateScanner, GameProjectProvider, UserImportConnector, canonicalUrl, decideAcquisition, imageSimilarity,
  lawfulDownload, phraseByStatus, runDiscovery, dHash, type PageDriver, type SourcePolicy,
} from "../src/index.js";
import { tmpDir } from "../../storage/test/helpers.js";

const permitted: SourcePolicy = { ...DEFAULT_SOURCE_POLICIES[0], sourceId: "public-fixture", automationPermitted: true, maxPagesPerRun: 3, minDelayMs: 0, reviewedAt: "2026-10-01" };
function driver(pages: any[][], wall: null | "captcha" = null): () => Promise<PageDriver> {
  let p = 0;
  const calls: string[] = [];
  return async () => ({
    open: async (u) => void calls.push(u),
    detectWall: async () => wall,
    extractListing: async () => pages[p] ?? [],
    scrollNext: async () => ++p < pages.length,
    close: async () => undefined,
  });
}
const row = (id: string) => ({ originId: id, url: `https://item.example.test/${id}?spm=a1`, title: `宝贝 ${id}`, creator: null, followers: null, description: "", thumbnail: null });
async function store() {
  const s = new DataStore(await tmpDir());
  await s.init();
  return s;
}

describe("connector ladder (Q2.1, Q2.2)", () => {
  it("public page without API: permitted browse extracts metadata only, dedupes pagination, never invents followers", async () => {
    const c = new BrowserPublicConnector("public-fixture", permitted, driver([[row("1"), row("2")], [row("2"), row("3")]]), (q) => `https://example.test/s?q=${q}`);
    const r = await c.discover("x", { now: new Date(), maxItems: 10 });
    expect(r.items.map((i) => i.originId)).toEqual(["1", "2", "3"]);
    expect(r.items.every((i) => i.observedFollowerCount === null && i.downloadPermission === "not_granted" && i.mediaUrl === null)).toBe(true);
  });
  it("CAPTCHA: stops immediately and asks the user — no bypass", async () => {
    const c = new BrowserPublicConnector("taobao", permitted, driver([[row("1")]], "captcha"), () => "https://example.test");
    await expect(c.discover("x", { now: new Date(), maxItems: 5 })).rejects.toMatchObject({ code: "USER_ACTION_REQUIRED", errorClass: "HUMAN_REQUIRED" });
  });
  it("source without reviewed policy is skipped and the pipeline falls back to user import with a decision trace", async () => {
    const s = await store();
    const f = path.join(await tmpDir(), "import.json");
    await fs.writeFile(f, JSON.stringify([{ source: "douyin", originId: "d1", sourceUrl: "https://www.douyin.com/video/1?utm_source=x", title: "标题", sourceLanguage: "zh", downloadPermission: "not_granted", userNotes: "Ý tưởng: vì sao bọt xà phòng có màu cầu vồng — giao thoa ánh sáng màng mỏng." }]));
    const blocked = new BrowserPublicConnector("taobao", DEFAULT_SOURCE_POLICIES[0], async () => { throw new Error("must not open browser"); }, () => "");
    const r = await runDiscovery({ store: s, connectors: [blocked, new UserImportConnector(f)], query: "q" });
    expect(r.trace.steps.some((x) => x.outcome === "SOURCE_SKIPPED")).toBe(true);
    expect(r.trace.fallbackUsed).toBe("user-import");
    expect(r.candidates[0].decision).toBe("ACCEPT");
    expect(r.candidates[0].acquisition.action).toBe("IDEA_ONLY");
    expect(JSON.parse(await fs.readFile(r.traceFile, "utf8")).runId).toBe(r.trace.runId);
  });
});

describe("media acquisition (Q2.3 + edge cases)", () => {
  const item = (o: object = {}) => ({ source: "douyin", originId: "x", sourceUrl: "https://a.test/v", title: "t", description: "", creatorDisplayName: null, observedFollowerCount: null, observedAt: "2026-10-19T00:00:00Z", sourceLanguage: "zh", thumbnailUrl: null, mediaUrl: null, downloadPermission: "not_granted" as const, license: null, userNotes: null, ...o });
  it("not downloadable/redistributable -> IDEA_ONLY/ORIGINAL_REMAKE and download refused", async () => {
    const d = decideAcquisition(item(), null);
    expect(d).toMatchObject({ action: "IDEA_ONLY", next: "ORIGINAL_REMAKE" });
    await expect(lawfulDownload("https://a.test/v.mp4", path.join(await tmpDir(), "v.mp4"), { decision: d, fetchImpl: async () => { throw new Error("must not fetch"); } })).rejects.toMatchObject({ code: "DOWNLOAD_NOT_PERMITTED" });
  });
  it("licence without commercial/derivative rights -> IDEA_ONLY; missing licence id -> RIGHTS_REVIEW", () => {
    expect(decideAcquisition(item({ downloadPermission: "allowed_by_license" }), { licenseId: "CC-BY-NC-ND", commercialUse: false, adaptationAllowed: false, redistributionAllowed: true }).action).toBe("IDEA_ONLY");
    expect(decideAcquisition(item({ downloadPermission: "allowed_by_license" }), null).action).toBe("RIGHTS_REVIEW");
  });
  it("lawful download: resumes partial content (206), restarts on 416, fails on 410, verifies checksum", async () => {
    const ok = { action: "OFFICIAL_DOWNLOAD" as const, reason: "CC-BY" };
    const data = Buffer.from("0123456789");
    let n = 0;
    const f = (async (_u: string, init?: any) => {
      n++;
      if (n === 1) return new Response(data.subarray(0, 4), { status: 200, headers: { "content-length": "10" } });
      if (n === 2) return new Response(null, { status: 416 });
      if (n === 3) return new Response(data.subarray(0, 6), { status: 200, headers: { "content-length": "10" } });
      expect(init.headers.range).toBe("bytes=6-");
      return new Response(data.subarray(6), { status: 206, headers: { "content-length": "4" } });
    }) as any;
    const dest = path.join(await tmpDir(), "v.bin");
    const r = await lawfulDownload("https://cc.test/v", dest, { decision: ok, fetchImpl: f, maxAttempts: 5 });
    expect(await fs.readFile(dest, "utf8")).toBe("0123456789");
    expect(r.bytes).toBe(10);
    await expect(lawfulDownload("https://cc.test/v", dest + "2", { decision: ok, fetchImpl: (async () => new Response(null, { status: 410 })) as any })).rejects.toMatchObject({ code: "HTTP_410" });
    await expect(lawfulDownload("https://cc.test/v", dest + "3", { decision: ok, expectedSha256: "00", fetchImpl: (async () => new Response(data)) as any, maxAttempts: 1 })).rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });
  });
});

describe("duplicate detection (Q2.4)", () => {
  it("canonical URLs collapse tracking params / www / trailing slash", () => {
    expect(canonicalUrl("https://www.douyin.com/video/1/?utm_source=a&share_token=b#x")).toBe(canonicalUrl("https://douyin.com/video/1"));
  });
  it("same concept (Chinese source translated vs Vietnamese post) and cropped/re-encoded/flipped image are flagged", async () => {
    const s = await store();
    const scan = new DuplicateScanner(s);
    const svg = (w: number) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}"><rect width="100%" height="100%" fill="#fff"/><circle cx="${w * 0.3}" cy="${w * 0.4}" r="${w * 0.2}" fill="#c00"/><rect x="${w * 0.55}" y="${w * 0.5}" width="${w * 0.3}" height="${w * 0.35}" fill="#036"/></svg>`);
    const original = await sharp(svg(800)).png().toBuffer();
    const reencoded = await sharp(original).resize(512).jpeg({ quality: 40 }).toBuffer();
    const flipped = await sharp(original).flop().toBuffer();
    const cropped = await sharp(original).extract({ left: 80, top: 80, width: 640, height: 640 }).toBuffer();
    expect(await imageSimilarity(original, reencoded)).toBeGreaterThan(0.9);
    expect(await imageSimilarity(original, flipped)).toBeGreaterThan(0.9);
    expect(await imageSimilarity(original, cropped)).toBeGreaterThan(0.85);
    const h = await dHash(original);
    await scan.remember({ kind: "published", id: "post-1", canonicalUrl: null, sha256: null, conceptVi: "Vì sao trứng nổi trong nước muối nhưng chìm trong nước ngọt: khối lượng riêng", productKey: null, imageHash: h.hash.toString(), at: new Date().toISOString() });
    const r = await scan.scan({ conceptVi: "Trứng nổi trong nước muối, chìm trong nước ngọt — do khối lượng riêng", imageHash: (await dHash(reencoded)).hash });
    expect(r.decision).not.toBe("UNIQUE_IN_CHECKED_SOURCES");
    expect(r.matches.map((m) => m.signal)).toEqual(expect.arrayContaining(["image_dhash", "concept_text"]));
    const fresh = await scan.scan({ conceptVi: "Vì sao mèo luôn tiếp đất bằng bốn chân" });
    expect(fresh.decision).toBe("UNIQUE_IN_CHECKED_SOURCES");
  });
});

describe("Machine Brigade (Q2.5)", () => {
  it("no gameplay footage -> WAITING_FOR_CAPTURE; planned features never phrased as released; secrets ignored", async () => {
    const dir = await tmpDir();
    await fs.mkdir(path.join(dir, "assets"));
    await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).png().toFile(path.join(dir, "assets", "r.png"));
    await fs.writeFile(path.join(dir, ".env"), "SECRET=1");
    await fs.writeFile(path.join(dir, "game-manifest.json"), JSON.stringify({
      game: "Machine Brigade", buildId: "b1", buildDate: "2026-10-01", version: "0.1", platforms: [{ name: "PC", status: "planned" }], vehicles: [], features: [{ id: "pvp", text: "PvP", status: "planned" }],
      assets: [{ id: "r", file: "assets/r.png", kind: "render", buildId: "b1", ownership: "OWNED", publishAllowed: true }, { id: "env", file: ".env", kind: "screenshot", buildId: null, ownership: "OWNED", publishAllowed: true }],
    }));
    const g = await new GameProjectProvider(dir).load();
    expect(g.assetFiles.env).toBeUndefined();
    expect(g.missing.join()).toMatch(/whitelist/);
    expect(GameProjectProvider.gameplayReadiness(g.manifest, g.assetFiles).state).toBe("WAITING_FOR_CAPTURE");
    expect(phraseByStatus("PvP", "planned")).toMatch(/Dự kiến.*chưa có/);
    expect(g.ledger.find((c) => c.id === "feat-pvp")?.status).toBe("planned");
  });
});
