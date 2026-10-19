import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { EspeakNgTts, TU_TO_MO_BRAND, buildChapters, cuesForNarration, ffmpeg, pickTts, qaVideo, renderStoryboard, toSrt, type TtsProvider } from "../src/index.js";
import { tmpDir } from "../../storage/test/helpers.js";

describe("subtitles & chapters", () => {
  it("cues are contiguous, readable and keep Vietnamese text intact", () => {
    const cues = cuesForNarration("Sao Kim tự quay một vòng mất khoảng hai trăm bốn mươi ba ngày Trái Đất. Thật bất ngờ!", 1, 6, 30);
    expect(cues[0].start).toBe(1);
    expect(cues.at(-1)!.end).toBeCloseTo(7);
    expect(cues.every((c) => c.text.length <= 44)).toBe(true);
    expect(toSrt(cues)).toContain("Trái Đất");
  });
  it("validates YouTube chapter rules", () => {
    expect(buildChapters([{ start: 0, title: "A" }, { start: 12, title: "B" }, { start: 30, title: "C" }]).text).toBe("0:00 A\n0:12 B\n0:30 C");
    expect(buildChapters([{ start: 0, title: "A" }, { start: 5, title: "B" }, { start: 30, title: "C" }]).ok).toBe(false);
    expect(buildChapters([{ start: 3, title: "A" }]).ok).toBe(false);
  });
});

describe("TTS provider selection (Q2.8)", () => {
  it("no available provider -> NEEDS_PROVIDER (never a fake/silent voice)", async () => {
    const dead: TtsProvider = { id: "x", costPerCharUsd: 0, available: async () => false, license: () => ({ engine: "x", voice: "x", license: "x", commercialUseOk: false, notes: "" }), synthesize: async () => 0 };
    await expect(pickTts([dead, new EspeakNgTts({ bin: "/nonexistent/espeak" })])).rejects.toMatchObject({ code: "NEEDS_PROVIDER", errorClass: "HUMAN_REQUIRED" });
  });
});

describe("render + QA (real FFmpeg)", () => {
  it("renders a real 1080x1920 H.264/AAC short that passes QA", async () => {
    const d = await tmpDir();
    const sb = { schemaVersion: 1 as const, projectId: "media-test", revision: 1, format: "short_9x16" as const, template: "CuriosityFact" as const, title: "Thử nghiệm", generatedBy: "human" as const,
      scenes: [{ id: "s1", kind: "hook" as const, title: "Xin chào Tủ Tò Mò", narration: "Xin chào, đây là bài kiểm tra dựng video tiếng Việt có dấu.", bullets: [], assetId: null, claimIds: [], minSeconds: 3, transition: "fade" as const, sourceCaption: null, chapterTitle: null },
               { id: "s2", kind: "point" as const, title: "Cảnh hai", narration: "Phụ đề phải đọc được và âm thanh phải đủ lớn.", bullets: ["Gạch đầu dòng"], assetId: null, claimIds: [], minSeconds: 3, transition: "fade" as const, sourceCaption: "Nguồn thử", chapterTitle: null }] };
    const r = await renderStoryboard({ storyboard: sb, brand: TU_TO_MO_BRAND, tts: new EspeakNgTts(), workDir: path.join(d, "w"), outDir: path.join(d, "o") });
    const qa = await qaVideo({ projectId: "media-test", format: "short_9x16", file: r.video, srt: r.srt, poster: r.poster, minSec: 3 });
    expect(qa.checks.filter((c) => !c.ok)).toEqual([]);
    expect(qa.ffprobe).toMatchObject({ width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac" });
    expect((await fs.readdir(path.join(d, "w"))).some((f) => f.endsWith(".partial.mp4"))).toBe(false);
  });
  it("QA rejects a black, silent, wrong-size video (no silent black-video publish)", async () => {
    const d = await tmpDir();
    const f = path.join(d, "bad.mp4");
    await ffmpeg(["-f", "lavfi", "-i", "color=black:s=720x1280:d=12", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "12", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", f]);
    await fs.writeFile(path.join(d, "s.srt"), "");
    const qa = await qaVideo({ projectId: "bad-1", format: "short_9x16", file: f, srt: path.join(d, "s.srt"), poster: path.join(d, "none.png") });
    expect(qa.passed).toBe(false);
    const failed = qa.checks.filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toEqual(expect.arrayContaining(["kích thước", "không có khung đen dài", "không có khoảng lặng > 2.5s", "phụ đề đọc được"]));
  });
});
