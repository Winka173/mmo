import * as fs from "node:fs/promises";
import * as path from "node:path";
import { nowIso, rightsGate } from "@ttm/core";
import { GameMediaIntake, GameRegistry, gameReadiness } from "@ttm/games";
import { BrandIdentityEngine, BrandKitFile, TU_TO_MO_BRAND, applyLexicon, ffmpeg, renderThumbnailCandidates, scoreThumbnail } from "@ttm/media";
import { DataStore } from "@ttm/storage";
import { describe, expect, it } from "vitest";
import { EDGE_CASES } from "./edge-cases.js";
import { tmpDir } from "../../../packages/storage/test/helpers.js";

async function newGame(store: DataStore, gameId: string) {
  const games = new GameRegistry(store);
  await games.save({ gameId, internalName: gameId, publicTitle: `Game ${gameId}`, ownerRights: { owner: "Studio", statement: "sở hữu", evidencePath: null }, destinationAllowlist: [] }, "t");
  return games;
}

describe("AC edge-case matrix — remaining rows", () => {
  it("AC-GI-01 new game without logo: draft saved, text-only fallback, never an invented logo", async () => {
    const store = new DataStore(await tmpDir());
    await store.init();
    const games = await newGame(store, "no-logo-game");
    await games.saveVideo({ projectId: "nologo-1", gameId: "no-logo-game", contentType: "GAME_DEVLOG", title: "Devlog 1", formats: ["short_9x16"] }, "t");
    const r = await gameReadiness(store, "no-logo-game", "nologo-1", { analyze: false });
    expect(r.readiness.warnings.map((w) => w.code)).toContain("LOGO_MISSING");
    expect(r.readiness.warnings.find((w) => w.code === "LOGO_MISSING")!.message).toMatch(/không tạo logo giả/);
    expect((await games.getVideo("no-logo-game", "nologo-1"))?.status).toBe("draft");
  });

  it("AC-GI-07 10-bit / odd-fps source is probed and transcoded ONCE to a normalised proxy; source preserved", async () => {
    const store = new DataStore(await tmpDir());
    await store.init();
    const games = await newGame(store, "tenbit-game");
    const d = await tmpDir();
    const src = path.join(d, "capture-10bit.mp4");
    await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=25", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p10le", src]);
    const intake = new GameMediaIntake(games);
    const r = await intake.importFile("tenbit-game", src, { kind: "gameplay" });
    expect(r.asset?.video?.bitDepth).toBe(10);
    expect(r.asset?.qa.notes.join()).toMatch(/10-bit/);
    expect(r.asset?.proxyPath).toBeTruthy();
    const again = await intake.importFile("tenbit-game", src, { kind: "gameplay" });
    expect(again.result).toBe("duplicate"); // no second transcode
    expect(await fs.stat(store.p(r.asset!.path))).toBeTruthy();
  });

  it("AC-GA-05 licensed third-party music must cover every target platform (and be commercial, unexpired)", async () => {
    const store = new DataStore(await tmpDir());
    await store.init();
    const games = await newGame(store, "music-game");
    const d = await tmpDir();
    const wav = path.join(d, "bgm-track.wav");
    await ffmpeg(["-f", "lavfi", "-i", "sine=f=330:d=2", wav]);
    const intake = new GameMediaIntake(games);
    const m = await intake.importFile("music-game", wav, { kind: "music", rights: { owner: "Label X", ownershipType: "LICENSED_STOCK", licenseId: "LIC-77", licenseEvidencePath: "lic.pdf", commercialUse: true, platformScope: ["youtube_shorts"], expiresAt: null, attribution: "Label X" } });
    await games.saveVideo({ projectId: "music-1", gameId: "music-game", contentType: "GAME_DEVLOG", title: "Devlog nhạc", formats: ["short_9x16"], targets: ["youtube_shorts", "tiktok"], musicAssetId: m.asset!.assetId }, "t");
    const r = await gameReadiness(store, "music-game", "music-1", { analyze: false });
    const music = r.readiness.publishBlockers.filter((b) => b.code === "MUSIC_LICENSE");
    expect(music[0].message).toMatch(/không bao gồm: tiktok/);
  });

  it("AC-RI-01 licence expires after approval: publish eligibility revoked by the rights gate at publish time", async () => {
    const t = nowIso();
    const project = { schemaVersion: 1 as const, id: "exp-1", brand: "tutomo", gameId: null, lineageId: null, language: "vi", contentType: "FACT_SHORT" as const, title: "x", mode: "live" as const, status: "READY_FOR_REVIEW" as const, revision: 1, topicId: null, productId: null, formats: ["short_9x16" as const], categories: [], originalityChecklist: null, createdAt: t, updatedAt: t };
    const manifest = { schemaVersion: 1 as const, projectId: "exp-1", music: [], voice: null, assets: [{ assetId: "stock-1", originUrl: null, author: "S", ownershipType: "LICENSED_STOCK" as const, licenseId: "L1", licenseEvidencePath: "x", commercialUse: true, adaptationAllowed: true, redistributionAllowed: true, platformScope: null, attribution: null, expiresAt: "2026-10-21T00:00:00Z", acquiredHow: "official_download" as const, hash: null, status: "VERIFIED" as const, notes: "" }] };
    expect(rightsGate(project, manifest, new Date("2026-10-20T12:00:00Z")).ok).toBe(true); // at approval time
    expect(rightsGate(project, manifest, new Date("2026-10-21T12:00:00Z"))).toMatchObject({ ok: false, hold: "HOLD_RIGHTS" }); // at publish time
  });

  it("AC-TH-01 thumbnail text outside the 4:5 feed crop / over HUD is detected; generated candidates keep text in the safe area", async () => {
    const d = await tmpDir();
    const [cand] = await renderThumbnailCandidates({ frame: null, title: "Tầng 3 đáng sợ", brand: TU_TO_MO_BRAND, logo: null, aspect: "9x16", outPrefix: path.join(d, "t"), layouts: ["left-text"] });
    const good = await scoreThumbnail({ ...cand, aspect: "9x16" }, { brand: TU_TO_MO_BRAND });
    expect(good.checks.find((c) => c.name.startsWith("an toàn khi crop"))?.ok).toBe(true);
    const bad = await scoreThumbnail({ ...cand, textBox: { x: 40, y: 20, w: 1000, h: 150 }, aspect: "9x16" }, { brand: TU_TO_MO_BRAND });
    expect(bad.checks.find((c) => c.name.startsWith("an toàn khi crop"))?.ok).toBe(false);
    expect(bad.score).toBeLessThan(good.score);
  });

  it("AC-TTS-01 brand/game names follow the per-brand pronunciation lexicon before TTS", async () => {
    const kit = BrandKitFile.parse({ kitVersion: 1, owner: { kind: "game", id: "lantern-hollow" }, name: "Lantern Hollow", colors: TU_TO_MO_BRAND.colors, pronunciation: [{ from: "Lantern Hollow", to: "Len tơn Hô lâu" }], updatedAt: nowIso() });
    expect(applyLexicon("Chào mừng tới Lantern Hollow!", [...BrandIdentityEngine.lexicon(kit)])).toBe("Chào mừng tới Len tơn Hô lâu!");
    expect(applyLexicon("Xem trên YouTube và TikTok", undefined)).toBe("Xem trên Diu túp và Tíc tốc");
    expect(BrandIdentityEngine.bannedPhraseHits({ ...kit, bannedPhrases: ["miễn phí 100%"] }, "Tải MIỄN PHÍ 100% ngay")).toEqual(["miễn phí 100%"]);
  });
});

describe("Edge-case registry integrity", () => {
  it("every AC row maps to an existing test (doc generated from this registry)", async () => {
    const root = path.resolve(import.meta.dirname, "../../..");
    const files = [...(await walk(path.join(root, "packages"))), ...(await walk(path.join(root, "apps", "worker", "test")))].filter((f) => f.endsWith(".test.ts"));
    const text = (await Promise.all(files.map((f) => fs.readFile(f, "utf8")))).join("\n");
    const missing = EDGE_CASES.filter((c) => !text.includes(c.test.split(" > ").at(-1)!));
    expect(missing.map((m) => m.caseId)).toEqual([]);
    expect(EDGE_CASES.filter((c) => c.externalSideEffects !== "zero" && c.blocked).map((c) => c.caseId)).toEqual([]);
  });
});

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}
