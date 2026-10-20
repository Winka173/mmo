import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Storyboard } from "@ttm/core";
import { EspeakNgTts, TU_TO_MO_BRAND, ffmpeg, renderStoryboard } from "@ttm/media";
import { describe, expect, it } from "vitest";
import { judgeAndRepair, judgeVideo } from "../src/index.js";
import { tmpDir } from "../../storage/test/helpers.js";

const scene = (id: string, kind: any, title: string, narration: string, minSeconds = 3) => ({ id, kind, title, narration, bullets: [], assetId: null, claimIds: [], minSeconds, transition: "fade" as const, sourceCaption: null, chapterTitle: null });

describe("Quality Judge + auto-repair (U1 / AF)", () => {
  it("detects a silent clip and unreadable subtitles on the REAL mp4, repairs only the affected scene/subtitles, keeps v1+v2", async () => {
    const d = await tmpDir("ttm-qj-");
    const sb: Storyboard = {
      schemaVersion: 1, projectId: "qj", revision: 1, format: "short_9x16", template: "CuriosityFact", title: "Thử judge", generatedBy: "human",
      scenes: [
        scene("s00-hook", "hook", "Bạn có biết?", "Bạn có biết vì sao bầu trời có màu xanh vào ban ngày không nhỉ?", 2.5),
        scene("s01-point", "point", "Cảnh bị lặng", "Ánh sáng tán xạ.", 9), // 9 s scene, ~1 s narration => dead air
        scene("s98-cta", "cta", "Theo dõi Tủ Tò Mò", "Theo dõi Tủ Tò Mò để mở thêm nhiều ngăn tủ thú vị mỗi ngày nhé các bạn.", 2.5),
      ],
    };
    const tts = new EspeakNgTts();
    const workDir = path.join(d, "work");
    const outDir = path.join(d, "out");
    const rr = (s: Storyboard, maxChars: number) => renderStoryboard({ storyboard: s, brand: TU_TO_MO_BRAND, tts, workDir, outDir, subtitleMaxChars: maxChars });
    const first = await rr(sb, 90); // bad: very long subtitle cues
    const res = await judgeAndRepair({ storyboard: sb, first, outDir, workDir, subtitleMaxChars: 90, judge: { format: "short_9x16", minSec: 3, disclosure: { required: false, present: false } }, rerender: (p) => rr(p.storyboard, p.subtitleMaxChars ?? 30) });
    const v1 = res.reports[0];
    const failed1 = v1.hard.filter((h) => !h.ok).map((h) => h.code);
    expect(failed1).toEqual(expect.arrayContaining(["NO_DEAD_AIR", "SUBTITLE_FITS_SAFE_AREA"]));
    expect(v1.verdict).toBe("REPAIRABLE");
    const dead = v1.hard.find((h) => h.code === "NO_DEAD_AIR")!;
    expect(dead.evidence[0].note).toMatch(/cảnh s01-point/); // frame/time evidence in Vietnamese
    expect(res.status).toBe("PASS");
    expect(res.log[0].actions.map((a) => a.action)).toEqual(expect.arrayContaining(["SUBTITLE_REFLOW", "TRIM_SILENCE"]));
    expect(res.log[0].scenesRerendered).toEqual(["s01-point"]); // only the affected scene was re-rendered
    expect(res.log.length).toBeLessThanOrEqual(3);
    expect(await fs.stat(path.join(outDir, "v1", "short_9x16.mp4"))).toBeTruthy();
    expect(await fs.stat(path.join(outDir, "v2", "short_9x16.mp4"))).toBeTruthy();
    const final = res.reports.at(-1)!;
    expect(final.soft.length).toBeGreaterThan(4);
    expect(final.soft.every((s) => s.explanation.length > 5)).toBe(true);
    expect(final.sampledFrames).toBeGreaterThanOrEqual(3);
  }, 600_000);

  it("rights/fact-blocked content is judged but never auto-repaired; premium judge never called on hard errors", async () => {
    const d = await tmpDir();
    const f = path.join(d, "bad.mp4");
    await ffmpeg(["-f", "lavfi", "-i", "color=black:s=720x1280:d=6", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", f]);
    await fs.writeFile(path.join(d, "s.srt"), "");
    let premiumCalled = false;
    const r = await judgeVideo({ file: f, srt: path.join(d, "s.srt"), format: "short_9x16", mode: "PREMIUM_QA", minSec: 3, premiumJudge: async () => ((premiumCalled = true), { used: true, note: "x" }) });
    expect(r.hard.filter((h) => !h.ok).map((h) => h.code)).toEqual(expect.arrayContaining(["DIMENSIONS", "NO_BLACK_FRAMES", "NO_DEAD_AIR", "SUBTITLES_PRESENT", "READABLE_FRAMES"]));
    expect(premiumCalled).toBe(false);
    expect(r.premium.note).toMatch(/lỗi cứng/);
  }, 120_000);
});
