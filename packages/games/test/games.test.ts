import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ffprobe } from "@ttm/media";
import { DataStore } from "@ttm/storage";
import { beforeAll, describe, expect, it } from "vitest";
import yazl from "./yazl-lite.js";
import {
  GameMediaIntake,
  GameRegistry,
  approveGameVideo,
  checkGameClaims,
  gameReadiness,
  isApprovalValid,
  parseChangelog,
  parseShotList,
  produceGameVideo,
  seedGameFixtures,
  buildFeatureMap,
} from "../src/index.js";
import { tmpDir } from "../../storage/test/helpers.js";

let store: DataStore;
let games: GameRegistry;
let seed: Awaited<ReturnType<typeof seedGameFixtures>>;

beforeAll(async () => {
  store = new DataStore(await tmpDir("ttm-games-"));
  await store.init();
  games = new GameRegistry(store);
  seed = await seedGameFixtures(store);
}, 300_000);

describe("multi-game registry & intake (Y1/Y2)", () => {
  it("onboards two different games with no code change; distinct brand kits and accounts", async () => {
    const list = await games.list();
    expect(list.map((g) => g.gameId).sort()).toEqual(["lantern-hollow", "machine-brigade"]);
    const [lh, mb] = list;
    expect(lh.style).toBe("2D");
    expect(mb.style).toBe("3D");
    expect(games.resolveId("mb")).toBe("machine-brigade"); // legacy alias
    expect(lh.destinationAllowlist).not.toContain("yt-machine-brigade");
  });

  it("rejects zero-byte and truncated uploads with a preserved reason (ask re-upload)", async () => {
    const rej = seed.imports["lantern-hollow"].rejected;
    expect(rej.find((r) => r.name === "upload-empty.mp4")?.reason).toMatch(/0 byte/);
    expect(rej.find((r) => r.name === "upload-truncated.mp4")?.reason).toMatch(/hỏng|giải mã|moov/);
    const ups = await fs.readdir(games.dir("lantern-hollow", "uploads"));
    const manifest = JSON.parse(await fs.readFile(games.dir("lantern-hollow", "uploads", ups[0], "import-manifest.json"), "utf8"));
    expect(manifest.items.filter((i: any) => i.result === "rejected")).toHaveLength(2);
  });

  it("probes mixed FPS once into a normalised proxy, preserving the source", async () => {
    const portrait = (await games.media("machine-brigade")).find((a) => a.originalName.includes("portrait"))!;
    expect(portrait.video).toMatchObject({ width: 1080, height: 1920, fps: 60 });
    expect(portrait.proxyPath).toBeNull(); // clean 60fps H.264 doesn't need a proxy
    const intake = new GameMediaIntake(games);
    const d = await tmpDir();
    const odd = path.join(d, "odd-24fps.mp4");
    const { ffmpeg } = await import("@ttm/media");
    await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=24:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", odd]);
    const r = await intake.importFile("lantern-hollow", odd, { kind: "gameplay" });
    expect(r.result).toBe("imported");
    expect(r.asset!.proxyPath).toMatch(/proxy\/.+\.mp4$/);
    expect((await ffprobe(store.p(r.asset!.proxyPath!))).fps).toBeCloseTo(30, 0);
    expect(await fs.stat(store.p(r.asset!.path))).toBeTruthy();
  });

  it("same file in two games gets two independent, game-scoped records (no cross-game upload)", async () => {
    const intake = new GameMediaIntake(games);
    const logoMb = (await games.media("machine-brigade")).find((a) => a.kind === "logo")!;
    const r = await intake.importFile("lantern-hollow", store.p(logoMb.path), { kind: "screenshot", originalName: "logo.png" });
    expect(r.result).toBe("imported");
    expect(r.asset!.path.startsWith("games/lantern-hollow/")).toBe(true);
    expect(r.asset!.gameId).toBe("lantern-hollow");
    // a clip id from game A referenced inside game B's project is refused
    const input = (await games.getVideo("lantern-hollow", "game-lh-teaser"))!;
    const mbClip = (await games.media("machine-brigade")).find((a) => a.kind === "gameplay")!;
    await games.saveVideo({ ...input, projectId: "lh-cross", clips: [{ ...input.clips[0], assetId: mbClip.assetId }] }, "t");
    const rd = await gameReadiness(store, "lantern-hollow", "lh-cross", { analyze: false });
    expect(rd.readiness.renderBlockers.map((b) => b.code)).toContain("ASSET_NOT_IN_GAME");
  });

  it("ZIP import blocks zip-slip, symlinks and executables; imports the rest", async () => {
    const d = await tmpDir();
    const zipFile = path.join(d, "pack.zip");
    const lhLogo = (await games.media("lantern-hollow")).find((a) => a.kind === "logo")!;
    await yazl(zipFile, [
      { name: "art/hero-sheet.png", data: await fs.readFile(store.p(lhLogo.path)) },
      { name: "../../evil.png", data: Buffer.from("x") },
      { name: "tools/run.ps1", data: Buffer.from("Remove-Item C:\\") },
      { name: ".env", data: Buffer.from("TOKEN=abc") },
    ]);
    const res = await new GameMediaIntake(games).importZip("lantern-hollow", zipFile);
    const items = res.manifest.items;
    expect(items.find((i) => i.originalName === "../../evil.png")?.reason).toMatch(/zip-slip/);
    expect(items.find((i) => i.originalName === "tools/run.ps1")?.result).toBe("rejected");
    expect(items.find((i) => i.originalName === ".env")?.result).toBe("rejected");
    expect(items.find((i) => i.originalName === "art/hero-sheet.png")?.result).toBe("duplicate"); // same bytes as the logo
    await expect(fs.access(path.join(store.root, "..", "evil.png"))).rejects.toThrow();
  });

  it("disguised files are refused by content sniffing", async () => {
    const d = await tmpDir();
    const fake = path.join(d, "clip.mp4");
    await fs.writeFile(fake, "MZ\x90\x00 this is an exe");
    expect((await new GameMediaIntake(games).importFile("lantern-hollow", fake)).reason).toMatch(/không khớp đuôi/);
  });

  it("CSV shot list maps to validated clip refs", async () => {
    const assets = await games.media("lantern-hollow");
    const { clips, errors } = parseShotList('asset,in,out,annotation,caption\nrun-floor3.mp4,1,4,"né dơi","Né dơi"\nrun-floor3.mp4,5,99,x,y\nmissing.mp4,0,1,,', assets);
    expect(clips).toHaveLength(1);
    expect(errors).toHaveLength(2);
  });
});

describe("GameBuildIntelligence (Y3)", () => {
  it("parses EN/VI changelog sections and inline tags", () => {
    const e = parseChangelog("## [Unreleased]\n### Added\n- Bản đồ tuyết\n## [1.0.0] - 2026-01-01\n### Added\n- Chế độ bão cát\n- Boss mới [planned]\n### Đã bỏ\n- Máy bay cũ");
    expect(e.map((x) => `${x.text}:${x.status}`)).toEqual(["Bản đồ tuyết:in_development", "Chế độ bão cát:confirmed", "Boss mới:planned", "Máy bay cũ:deprecated"]);
  });
  it("planned feature is never claimed playable; roadmap mention needs approval + 'đang phát triển' wording", () => {
    const f = buildFeatureMap({ verified: [{ id: "pvp", name: "Chế độ đấu PvP", keywords: ["PvP"], description: "", status: "planned", buildId: null, evidence: [], spoiler: false, marketingApproved: false }], changelogs: [] });
    expect(checkGameClaims(["Chơi ngay chế độ PvP!"], f, { releaseDate: null })[0].kind).toBe("UNRELEASED_AS_PLAYABLE");
    expect(checkGameClaims(["PvP đang phát triển"], f, { releaseDate: null })[0].kind).toBe("ROADMAP_NOT_APPROVED");
    expect(checkGameClaims(["PvP đang phát triển"], f, { releaseDate: null }, { roadmapApproved: true })).toEqual([]);
  });
  it("no confirmed release date => no countdown/date; no invented player metrics", () => {
    const v = checkGameClaims(["Ra mắt ngày 12/12/2026", "Còn 5 ngày nữa!", "100 nghìn người chơi"], [], { releaseDate: { date: "2026-12-12", confirmed: false } });
    expect(v.map((x) => x.kind)).toEqual(["UNCONFIRMED_DATE", "UNCONFIRMED_DATE", "UNVERIFIED_METRIC"]);
    expect(checkGameClaims(["Ra mắt ngày 12/12/2026"], [], { releaseDate: { date: "2026-12-12", confirmed: true } })).toEqual([]);
  });
});

describe("game video readiness (AC game rows)", () => {
  it("no gameplay footage => WAITING_FOR_CAPTURE for gameplay types; devlog from art is allowed", async () => {
    const input = (await games.getVideo("lantern-hollow", "game-lh-teaser"))!;
    await games.saveVideo({ ...input, projectId: "lh-nogameplay", contentType: "GAMEPLAY_HIGHLIGHT", clips: [] }, "t");
    const r1 = await gameReadiness(store, "lantern-hollow", "lh-nogameplay", { analyze: false });
    expect(r1.readiness.state).toBe("WAITING_FOR_CAPTURE");
    await games.saveVideo({ ...input, projectId: "lh-devlog", contentType: "GAME_DEVLOG", clips: [] }, "t");
    const r2 = await gameReadiness(store, "lantern-hollow", "lh-devlog", { analyze: false });
    expect(r2.readiness.renderable).toBe(true);
  });
  it("AI cinematics presented as gameplay are blocked", async () => {
    const intake = new GameMediaIntake(games);
    const src = (await games.media("lantern-hollow")).find((a) => a.originalName === "run-floor3.mp4")!;
    const d = await tmpDir();
    const f = path.join(d, "ai-concept-cinematic.mp4");
    await fs.copyFile(store.p(src.path), f);
    await fs.appendFile(f, Buffer.alloc(16)); // different bytes
    const r = await intake.importFile("lantern-hollow", f);
    expect(r.asset?.kind).toBe("ai_concept");
    expect(r.asset?.flags.isGameplayCapture).toBe(false);
    const input = (await games.getVideo("lantern-hollow", "game-lh-teaser"))!;
    await games.saveVideo({ ...input, projectId: "lh-ai", contentType: "GAMEPLAY_HIGHLIGHT", clips: [{ assetId: r.asset!.assetId, in: 0, out: 3, annotation: "", caption: "Trận đánh", featureIds: [] }] }, "t");
    const rd = await gameReadiness(store, "lantern-hollow", "lh-ai", { analyze: false });
    expect(rd.readiness.renderBlockers.map((b) => b.code)).toEqual(expect.arrayContaining(["AI_AS_GAMEPLAY", "WAITING_FOR_CAPTURE"]));
  });
  it("debug overlay in gameplay is detected (OCR when available) and held for review", async () => {
    const input = (await games.getVideo("lantern-hollow", "game-lh-teaser"))!;
    const dbg = (await games.media("lantern-hollow")).find((a) => a.originalName === "run-debug-build.mp4")!;
    await games.saveVideo({ ...input, projectId: "lh-debug", clips: [{ assetId: dbg.assetId, in: 0, out: 5, annotation: "", caption: "Né dơi", featureIds: [] }] }, "t");
    const rd = await gameReadiness(store, "lantern-hollow", "lh-debug");
    const fm = rd.footage[dbg.assetId];
    if (fm.leak.method === "ocr") {
      expect(fm.leak.suspicious).toBe(true);
      expect(rd.readiness.requiresApproval.map((x) => x.code)).toContain("DEBUG_LEAK");
    } else expect(rd.readiness.warnings.map((x) => x.code)).toContain("LEAK_UNCHECKED");
  });
  it("embargo and missing destination block publishing (render still allowed for preview)", async () => {
    const g = (await games.get("lantern-hollow"))!;
    await games.save({ ...g, embargoUntil: "2099-01-01T00:00:00Z" }, "t");
    const rd = await gameReadiness(store, "lantern-hollow", "game-lh-teaser", { analyze: false });
    expect(rd.readiness.renderable).toBe(true);
    expect(rd.readiness.publishBlockers.map((b) => b.code)).toContain("EMBARGO");
    expect(rd.readiness.publishBlockers.map((b) => b.code)).not.toContain("NO_DESTINATION");
    await games.save({ ...g, embargoUntil: null }, "t");
  });
  it("wishlist CTA without a store page is blocked (no invented links)", async () => {
    const input = (await games.getVideo("machine-brigade", "game-mb-highlight"))!;
    await games.saveVideo({ ...input, projectId: "mb-wishlist", cta: { text: "Thêm vào wishlist ngay", linkLabel: "Steam" } }, "t");
    const rd = await gameReadiness(store, "machine-brigade", "mb-wishlist", { analyze: false });
    expect(rd.readiness.renderBlockers.map((b) => b.code)).toEqual(expect.arrayContaining(["CTA_LINK_INVALID", "CTA_NO_STORE"]));
  });
});

describe("game video production — both fixtures, both formats (AF)", () => {
  it("renders 9:16 Short AND 16:9 long for each game with correct brand, logo, thumbnail and CTA", async () => {
    const results: Record<string, Awaited<ReturnType<typeof produceGameVideo>>> = {};
    for (const p of seed.projects) results[p.gameId] = await produceGameVideo({ store }, p.gameId, p.projectId, { mode: "demo" });
    for (const [gameId, r] of Object.entries(results)) {
      for (const f of ["short_9x16", "long_16x9"] as const) {
        const o = r.outputs[f];
        expect(o.qaPassed, `${gameId} ${f}: ${o.failed?.join("; ")}`).toBe(true);
        const pr = await ffprobe(o.video);
        expect([pr.width, pr.height]).toEqual(f === "short_9x16" ? [1080, 1920] : [1920, 1080]);
        expect(pr.videoCodec).toBe("h264");
        expect(pr.audioCodec).toBe("aac");
        const proof = JSON.parse(await fs.readFile(path.join(path.dirname(o.video), "render-proof.json"), "utf8"));
        expect(proof.brandKit.owner).toEqual({ kind: "game", id: gameId }); // never Tủ Tò Mò kit
        expect(await fs.stat(path.join(path.dirname(o.video), `${f}.thumbnail.jpg`))).toBeTruthy();
      }
    }
    // Machine Brigade: user-locked 16:9 thumbnail only re-encoded (1600x900 -> 1280x720)
    const mbThumb = JSON.parse(await fs.readFile(store.p("projects", "game-mb-highlight", "renders", "long_16x9", "thumbnails.json"), "utf8"));
    expect(mbThumb).toMatchObject({ mode: "LOCK_USER_THUMBNAIL", width: 1280, height: 720, resizeMode: "resize", needsApproval: false });
    // Lantern Hollow: no user thumbnail -> ≥3 truthful candidates from real frames, needs approval
    const lhThumb = JSON.parse(await fs.readFile(store.p("projects", "game-lh-teaser", "renders", "long_16x9", "thumbnails.json"), "utf8"));
    expect(lhThumb.candidates.length).toBeGreaterThanOrEqual(3);
    expect(lhThumb.needsApproval).toBe(true);
    // portrait mobile capture inside the 16:9 long uses blur-pad, not a misleading crop
    expect(results["machine-brigade"].outputs.long_16x9.compositions.find((c: any) => c.srcAspect < 1).mode).toBe("blur_pad");
    // CTA / metadata per game: LH has its real UTM-tagged wishlist link, MB has no invented link
    const lhMeta = JSON.parse(await fs.readFile(store.p("projects", "game-lh-teaser", "metadata.json"), "utf8"));
    const mbMeta = JSON.parse(await fs.readFile(store.p("projects", "game-mb-highlight", "metadata.json"), "utf8"));
    expect(lhMeta.youtube_long.description).toContain("https://lanternhollow.example/wishlist?utm_source=youtube");
    expect(mbMeta.youtube_long.description).not.toMatch(/https:\/\//);
    expect(mbMeta.youtube_long.description).toMatch(/Bản dựng v0\.4\.0|Footage bản cũ/);
    expect(lhMeta.youtube_long.description).not.toMatch(/Tủ Tò Mò/);
    // older-build footage labelled
    const mbReady = JSON.parse(await fs.readFile(games.dir("machine-brigade", "projects", "game-mb-highlight", "readiness.json"), "utf8"));
    expect(Object.values(mbReady.clipLabels)).toContain("Footage bản cũ v0.3.1 — bản mới nhất 0.4.0");
    // project registered for the shared publish pipeline, scoped to the game
    expect(await store.getProject("game-lh-teaser")).toMatchObject({ gameId: "lantern-hollow", brand: "lantern-hollow", mode: "demo" });
  }, 900_000);

  it("approval is invalidated when the user changes the thumbnail after approval", async () => {
    await approveGameVideo(store, "machine-brigade", "game-mb-highlight", "editor");
    expect((await isApprovalValid(store, "machine-brigade", "game-mb-highlight")).ok).toBe(true);
    const input = (await games.getVideo("machine-brigade", "game-mb-highlight"))!;
    const key = (await games.media("machine-brigade")).find((a) => a.kind === "key_art")!;
    await games.saveVideo({ ...input, thumbnail: { ...input.thumbnail, user16x9: key.assetId } }, "user");
    const v = await isApprovalValid(store, "machine-brigade", "game-mb-highlight");
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/thay đổi sau khi duyệt/);
    // undo restores the approved state
    await games.undoVideo("machine-brigade", "game-mb-highlight", "user");
    expect((await isApprovalValid(store, "machine-brigade", "game-mb-highlight")).ok).toBe(true);
  });
});
