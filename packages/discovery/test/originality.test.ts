import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { DataStore } from "@ttm/storage";
import { describe, expect, it } from "vitest";
import { OriginalityEngine, originalityGate, type OriginalityEntry } from "../src/index.js";
import { tmpDir } from "../../storage/test/helpers.js";

const ff = (args: string[]) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
};
const base = (id: string, over: Partial<OriginalityEntry> = {}): Omit<OriginalityEntry, "sha256" | "video" | "audio" | "at"> => ({
  id, kind: "draft", projectId: null, lineageId: null, owner: "tutomo", title: "", hook: "", text: "", conceptVi: null, language: "vi", structure: [], productKeys: [], urls: [], ownedOrLicensed: false, ...over,
});

describe("CrossPlatformOriginalityEngine (V1)", () => {
  it("catches cropped + mirrored + re-encoded copies of third-party footage (video pHash + audio) and blocks", async () => {
    const d = await tmpDir("ttm-orig-");
    const src = path.join(d, "src.mp4");
    const copy = path.join(d, "copy.mp4");
    const other = path.join(d, "other.mp4");
    ff(["-f", "lavfi", "-i", "mandelbrot=s=640x360:r=25", "-f", "lavfi", "-i", "aevalsrc='sin(2*PI*(200+100*sin(t))*t)*abs(sin(3*t))':s=44100", "-t", "8", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", src]);
    ff(["-i", src, "-vf", "crop=iw*0.85:ih*0.85,hflip,scale=1280:720", "-c:v", "libx264", "-crf", "30", "-c:a", "aac", "-b:a", "64k", "-af", "volume=0.6", copy]);
    ff(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=25", "-f", "lavfi", "-i", "sine=f=440", "-t", "8", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", other]);
    const store = new DataStore(d);
    await store.init();
    const eng = new OriginalityEngine(store);
    await eng.add(await eng.fingerprint({ ...base("market:douyin-123", { kind: "market", owner: "small creator", text: "video nguồn" }), file: src }));
    const cand = await eng.fingerprint({ ...base("proj-copy", { projectId: "proj-copy" }), file: copy });
    const r = await eng.check(cand);
    expect(r.matches.map((m) => m.level)).toEqual(expect.arrayContaining(["video_phash", "audio_envelope"]));
    expect(r.decision).toBe("DUPLICATE_BLOCK");
    expect(r.rightsNote).toMatch(/Độ mới ≠ quyền/);
    expect(originalityGate(r)).toMatchObject({ ok: false, hold: "HOLD_RIGHTS" });
    await expect(eng.override("proj-copy", "editor", "tôi nghĩ là ổn mà")).rejects.toThrow(/Không thể bỏ qua/);
    const fresh = await eng.check(await eng.fingerprint({ ...base("proj-other", { projectId: "proj-other" }), file: other }));
    expect(fresh.decision).toBe("ORIGINAL");
  }, 180_000);

  it("flags a cross-language (zh→vi) near-copy script; allows own multi-platform distribution; override with reason", async () => {
    const store = new DataStore(await tmpDir());
    await store.init();
    const eng = new OriginalityEngine(store);
    await eng.add(await eng.fingerprint(base("market:xhs-9", { kind: "market", language: "zh", text: "鸡蛋在盐水中漂浮的实验 3 步", conceptVi: "Thí nghiệm trứng nổi trong nước muối với 3 bước: hòa muối, thả trứng, quan sát trứng nổi lên" })));
    const vi = await eng.fingerprint(base("proj-egg", { projectId: "proj-egg", title: "Trứng nổi trong nước muối", text: "Thí nghiệm trứng nổi trong nước muối với 3 bước: hòa muối, thả trứng, quan sát trứng nổi lên mặt nước" }));
    const r = await eng.check(vi);
    expect(r.matches[0].level).toBe("cross_language_concept");
    expect(r.decision).toBe("NEEDS_REVIEW");
    const ov = await eng.override("proj-egg", "editor", "Góc mới: đo khối lượng riêng bằng tỷ trọng kế, hình ảnh tự quay");
    expect(originalityGate(ov).ok).toBe(true);
    // own long video + its Shorts share a lineage: same script is legitimate distribution
    await eng.add(await eng.fingerprint(base("owned:long-venus", { kind: "owned_post", projectId: "long-venus", lineageId: "venus", ownedOrLicensed: true, text: "Sao Kim tự quay rất chậm, một ngày dài hơn một năm" })));
    const cut = await eng.check(await eng.fingerprint(base("cut-venus", { projectId: "cut-venus", lineageId: "venus", text: "Sao Kim tự quay rất chậm, một ngày dài hơn một năm" })));
    expect(cut.decision).toBe("OWN_CONTENT_DISTRIBUTION");
  });
});
