import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { FFMPEG, ffmpeg, probeMedia, runProcess } from "@ttm/media";
import sharp from "sharp";

export type Interval = { start: number; end: number };

export type FootageMap = {
  assetId: string;
  durationSec: number;
  scenes: number[];
  freezes: Interval[];
  blacks: Interval[];
  silences: Interval[];
  /** per-second RMS dBFS (null when no audio) */
  audioRms: (number | null)[];
  /** per-sample motion 0..1 between consecutive sampled frames */
  motion: { t: number; v: number }[];
  highlights: { in: number; out: number; score: number; confidence: "low" | "medium" | "high"; reasons: string[] }[];
  heroCandidates: { t: number; sharpness: number; contrast: number; score: number }[];
  /** fraction of the clip that is frozen/black (loading screens, pauses) */
  boringRatio: number;
  leak: { method: "ocr" | "unavailable"; suspicious: boolean; matches: { t: number; text: string }[] };
  warnings: string[];
  analyzedAt: string;
};

const LEAK_RE = /(debug|fps[: ]\s*\d|dev[- ]?build|localhost|127\.0\.0\.1|api[_ -]?key|token|password|stack ?trace|exception|nullreference|console|C:\\Users|\/home\/|build[- ]?server|cheat|god ?mode|noclip|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,})/i;

let tesseractOk: boolean | null = null;
export async function ocrAvailable(): Promise<boolean> {
  if (tesseractOk !== null) return tesseractOk;
  const bin = process.env.TESSERACT_PATH || "tesseract";
  tesseractOk = await runProcess(bin, ["--version"], { timeoutMs: 10_000 }).then((r) => r.code === 0, () => false);
  return tesseractOk;
}

async function ocr(png: string): Promise<string> {
  const r = await runProcess(process.env.TESSERACT_PATH || "tesseract", [png, "stdout", "--psm", "11"], { timeoutMs: 60_000 });
  return r.code === 0 ? r.stdout : "";
}

/** Laplacian-variance sharpness + RMS contrast on a greyscale thumbnail. */
async function frameStats(png: string): Promise<{ sharpness: number; contrast: number; hash: bigint }> {
  const img = sharp(png).greyscale().resize(160, 90, { fit: "fill" });
  const px = await img.clone().raw().toBuffer();
  let mean = 0;
  for (const v of px) mean += v;
  mean /= px.length;
  let varc = 0;
  for (const v of px) varc += (v - mean) ** 2;
  const lap = await img.clone().convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] }).raw().toBuffer();
  let lm = 0;
  for (const v of lap) lm += v;
  lm /= lap.length;
  let lv = 0;
  for (const v of lap) lv += (v - lm) ** 2;
  const small = await sharp(png).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let h = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h = (h << 1n) | (small[y * 9 + x] > small[y * 9 + x + 1] ? 1n : 0n);
  return { sharpness: lv / lap.length, contrast: Math.sqrt(varc / px.length), hash: h };
}

const ham = (a: bigint, b: bigint) => {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
};

const overlaps = (t: number, ivs: Interval[]) => ivs.some((i) => t >= i.start && t <= i.end);

/**
 * FootageAnalyzer: cheap local signals only (FFmpeg filters + 1 frame / N s). It proposes
 * highlights with confidence; when confidence is low it asks for a human annotation instead of
 * inventing what happens in the clip.
 */
export async function analyzeFootage(assetId: string, file: string, opts: { sampleEverySec?: number; ocrFrames?: number } = {}): Promise<FootageMap> {
  const probe = await probeMedia(file);
  const dur = probe.durationSec;
  const every = opts.sampleEverySec ?? Math.max(0.5, Math.min(2, dur / 20));
  const warnings: string[] = [];

  const r = await runProcess(
    FFMPEG,
    [
      "-hide_banner", "-nostats", "-loglevel", "info", "-i", file,
      "-filter_complex",
      `[0:v]split=2[sa][sb];[sa]select='gt(scene,0.28)',metadata=print:key=lavfi.scene_score[v1];[sb]freezedetect=n=0.003:d=1.2,blackdetect=d=0.5:pix_th=0.08[v2]` +
        (probe.hasAudio ? `;[0:a]silencedetect=n=-45dB:d=1.5,asetnsamples=n=48000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level[a1]` : ""),
      "-map", "[v1]", "-map", "[v2]", ...(probe.hasAudio ? ["-map", "[a1]"] : []),
      "-f", "null", "-",
    ],
    { timeoutMs: 30 * 60_000 },
  );
  const err = r.stderr;
  const scenes = [...err.matchAll(/pts_time:([\d.]+)[^\n]*\n[^\n]*lavfi\.scene_score=([\d.]+)/g)].map((m) => +m[1]);
  const freezes: Interval[] = [];
  for (const m of err.matchAll(/freeze_start: ([\d.]+)/g)) freezes.push({ start: +m[1], end: dur });
  [...err.matchAll(/freeze_end: ([\d.]+)/g)].forEach((m, i) => freezes[i] && (freezes[i].end = +m[1]));
  const blacks = [...err.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => ({ start: +m[1], end: +m[2] }));
  const silences: Interval[] = [];
  for (const m of err.matchAll(/silence_start: (-?[\d.]+)/g)) silences.push({ start: Math.max(0, +m[1]), end: dur });
  [...err.matchAll(/silence_end: ([\d.]+)/g)].forEach((m, i) => silences[i] && (silences[i].end = +m[1]));
  const audioRms: (number | null)[] = probe.hasAudio ? [...err.matchAll(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === "-inf" ? -120 : +m[1])) : [];

  // sampled frames
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ttm-footage-"));
  const motion: FootageMap["motion"] = [];
  const hero: FootageMap["heroCandidates"] = [];
  const leakMatches: { t: number; text: string }[] = [];
  let method: FootageMap["leak"]["method"] = "unavailable";
  try {
    await ffmpeg(["-i", file, "-vf", `fps=1/${every.toFixed(3)},scale=640:-2`, path.join(tmp, "f-%04d.png")], { timeoutMs: 20 * 60_000 });
    const frames = (await fs.readdir(tmp)).filter((f) => f.endsWith(".png")).sort();
    let prev: bigint | null = null;
    for (const [i, f] of frames.entries()) {
      const t = Math.min(dur, i * every);
      const st = await frameStats(path.join(tmp, f));
      if (prev !== null) motion.push({ t, v: Math.round((ham(prev, st.hash) / 64) * 1000) / 1000 });
      prev = st.hash;
      if (!overlaps(t, blacks) && !overlaps(t, freezes)) hero.push({ t, sharpness: Math.round(st.sharpness), contrast: Math.round(st.contrast * 10) / 10, score: 0 });
    }
    if (await ocrAvailable()) {
      method = "ocr";
      const n = Math.min(frames.length, opts.ocrFrames ?? 4);
      for (let k = 0; k < n; k++) {
        const idx = Math.floor((k * frames.length) / n);
        const full = path.join(tmp, `ocr-${k}.png`);
        await ffmpeg(["-ss", (idx * every).toFixed(2), "-i", file, "-frames:v", "1", full]);
        const text = (await ocr(full)).replace(/\s+/g, " ").trim();
        const m = LEAK_RE.exec(text);
        if (m) leakMatches.push({ t: Math.round(idx * every * 10) / 10, text: text.slice(Math.max(0, m.index - 20), m.index + 40) });
      }
    } else warnings.push("Không có OCR (Tesseract) — không tự kiểm tra được chữ debug/thông tin riêng trong khung hình; cần người xem lại");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
  const maxSharp = Math.max(1, ...hero.map((h) => h.sharpness));
  const maxContrast = Math.max(1, ...hero.map((h) => h.contrast));
  for (const h of hero) h.score = Math.round((0.6 * (h.sharpness / maxSharp) + 0.4 * (h.contrast / maxContrast)) * 1000) / 1000;
  hero.sort((a, b) => b.score - a.score);

  // highlight windows (3 s): scene density + audio energy + motion, excluding frozen/black time
  const win = Math.min(3, Math.max(1, dur / 3));
  const rmsVals = audioRms.filter((x): x is number => x !== null && x > -100);
  const medRms = rmsVals.length ? [...rmsVals].sort((a, b) => a - b)[Math.floor(rmsVals.length / 2)] : null;
  const candidates: FootageMap["highlights"] = [];
  for (let s = 0; s + win <= dur + 0.01; s += win / 2) {
    const e = Math.min(dur, s + win);
    const reasons: string[] = [];
    const sc = scenes.filter((t) => t >= s && t < e).length;
    const mo = motion.filter((m) => m.t >= s && m.t < e);
    const moAvg = mo.length ? mo.reduce((a, m) => a + m.v, 0) / mo.length : 0;
    const rms = audioRms.slice(Math.floor(s), Math.ceil(e)).filter((x): x is number => x !== null);
    const loud = medRms !== null && rms.length ? Math.max(...rms) - medRms : 0;
    const frozen = [...freezes, ...blacks].reduce((a, iv) => a + Math.max(0, Math.min(e, iv.end) - Math.max(s, iv.start)), 0) / (e - s);
    if (frozen > 0.5) continue;
    let score = 0;
    let signals = 0;
    if (sc) {
      score += Math.min(1, sc / 2) * 0.35;
      reasons.push(`${sc} lần chuyển cảnh`);
      signals++;
    }
    if (moAvg > 0.08) {
      score += Math.min(1, moAvg / 0.3) * 0.35;
      reasons.push(`chuyển động ${(moAvg * 100).toFixed(0)}%`);
      signals++;
    }
    if (loud > 3) {
      score += Math.min(1, loud / 12) * 0.3;
      reasons.push(`âm thanh nổi bật +${loud.toFixed(1)} dB`);
      signals++;
    }
    if (score > 0.15) candidates.push({ in: Math.round(s * 100) / 100, out: Math.round(e * 100) / 100, score: Math.round(score * 1000) / 1000, confidence: signals >= 3 ? "high" : signals === 2 ? "medium" : "low", reasons });
  }
  candidates.sort((a, b) => b.score - a.score);
  const highlights: FootageMap["highlights"] = [];
  for (const c of candidates) if (!highlights.some((h) => c.in < h.out && c.out > h.in)) highlights.push(c);
  const boring = [...freezes, ...blacks].reduce((a, iv) => a + Math.max(0, iv.end - iv.start), 0);
  const boringRatio = dur ? Math.min(1, Math.round((boring / dur) * 1000) / 1000) : 0;
  if (boringRatio > 0.4) warnings.push(`${Math.round(boringRatio * 100)}% clip đứng hình/màn đen (màn hình chờ?) — nên cắt bớt`);
  if (!highlights.length || highlights.every((h) => h.confidence === "low")) warnings.push("Không chắc đoạn nào là điểm nhấn — hãy ghi chú (annotation) đoạn quan trọng");
  if (!probe.hasAudio) warnings.push("Clip không có âm thanh");
  return { assetId, durationSec: dur, scenes, freezes, blacks, silences, audioRms, motion, highlights: highlights.slice(0, 8), heroCandidates: hero.slice(0, 6), boringRatio, leak: { method, suspicious: leakMatches.length > 0, matches: leakMatches }, warnings, analyzedAt: new Date().toISOString() };
}
