import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Claim } from "@ttm/core";
import { describe, expect, it } from "vitest";
import { FileTranscreator, TopicBrief, briefToStoryboard, localizeBrief, selectSegments, shortReleaseDates, standaloneShortBrief } from "../src/index.js";
import { tmpDir } from "../../storage/test/helpers.js";

const long = TopicBrief.parse({ projectId: "long-x", title: "Sao Kim kỳ lạ", hook: "Sao Kim kỳ lạ", hookNarration: "Sao Kim là hành tinh kỳ lạ.", cta: "Theo dõi", ctaNarration: "Theo dõi nhé",
  points: [
    { title: "Tự quay ngược", narration: "Sao Kim tự quay ngược chiều so với hầu hết các hành tinh khác trong hệ Mặt Trời, theo các quan sát radar.", claimIds: ["cl1"], chapterTitle: "Quay ngược" },
    { title: "Một ngày dài", narration: "Một ngày trên Sao Kim dài hơn một năm của nó.", claimIds: ["cl2"], chapterTitle: "Ngày dài" },
    { title: "Bề mặt nóng", narration: "Bề mặt Sao Kim nóng hơn Sao Thủy.", claimIds: [], chapterTitle: "Nóng" },
    { title: "Kết luận", narration: "Tóm lại đây là lời giải đáp cuối.", claimIds: [], chapterTitle: "Kết" },
  ] });
const claims = ["cl1", "cl2"].map((id) => Claim.parse({ id, text: id, riskTier: "LOW", status: "VERIFIED", sources: [] }));

describe("LongToShortsEngine (X3)", () => {
  it("refuses non-owned/unlicensed long videos", () => {
    const sb = briefToStoryboard(long, "long_16x9", "FACT", []);
    expect(() => selectSegments({ long, storyboard: sb, sceneTimings: [], claims: [], owned: false, rightsOk: false, k: 2 })).toThrow(/sở hữu/);
  });
  it("picks standalone segments, skips spoilers, re-scripts with hook+context+CTA, shares lineage spacing", () => {
    const sb = briefToStoryboard(long, "long_16x9", "FACT", claims);
    const timings = sb.scenes.map((s, i) => ({ sceneId: s.id, start: i * 14, duration: 14 }));
    const { picks, rejected } = selectSegments({ long, storyboard: sb, sceneTimings: timings, claims, owned: true, rightsOk: true, k: 2, spoilerPointIndexes: [3] });
    expect(picks.length).toBe(2);
    expect(picks.flatMap((p) => p.pointIndexes)).not.toContain(3);
    expect(rejected.join()).toMatch(/spoiler/);
    const s = standaloneShortBrief(long, picks[0], "long-x-cut1", 1);
    expect(s.hook).toMatch(/\?$/);
    expect(s.hookNarration).toMatch(/Chủ đề: Sao Kim kỳ lạ/);
    expect(s.cta).toMatch(/bản đầy đủ/);
    expect(shortReleaseDates("2026-10-20", 2, 2)).toEqual(["2026-10-22", "2026-10-24"]);
  });
});

describe("MultilingualEngine (X2)", () => {
  it("without any translator => NEEDS_TRANSLATION (no fake translation); human file accepted only if claims/structure match; geography + affiliate checks", async () => {
    const d = await tmpDir();
    const tf = new FileTranscreator((lang) => path.join(d, `${lang}.brief.json`));
    const none = await localizeBrief({ brief: long, from: "vi", to: "en", transcreators: [tf], claims: [], assetGeography: { a1: null }, targetRegion: "US" });
    expect(none.brief).toBeNull();
    expect(none.checks[0].detail).toMatch(/NEEDS_TRANSLATION|Chưa có bản chuyển ngữ/);
    await fs.writeFile(path.join(d, "en.brief.json"), JSON.stringify({ ...long, title: "Weird Venus", points: long.points.map((p) => ({ ...p, title: `EN ${p.title}` })) }));
    const ok = await localizeBrief({ brief: long, from: "vi", to: "en", transcreators: [tf], claims: [Claim.parse({ id: "cl1", text: "price", riskTier: "LOW", status: "VERIFIED", topic: "price", sources: [] })], assetGeography: { a1: ["VN"], a2: ["WORLD"] }, targetRegion: "US", affiliateRegions: ["VN"] });
    expect(ok.brief?.title).toBe("Weird Venus");
    const by = Object.fromEntries(ok.checks.map((c) => [c.code, c.ok]));
    expect(by).toMatchObject({ TRANSCREATED: true, LICENSE_GEOGRAPHY: false, AFFILIATE_AVAILABLE: false });
    await fs.writeFile(path.join(d, "en.brief.json"), JSON.stringify({ ...long, points: long.points.slice(0, 2) }));
    expect((await localizeBrief({ brief: long, from: "vi", to: "en", transcreators: [tf], claims: [], assetGeography: {}, targetRegion: "US" })).brief).toBeNull();
  });
});
