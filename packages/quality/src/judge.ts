import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Format, Storyboard } from "@ttm/core";
import { FFMPEG, FORMAT_SPECS, ffmpeg, parseSrt, probeMedia, runProcess, vietnameseFontAvailable, type Cue } from "@ttm/media";
import sharp from "sharp";

export type QaMode = "FAST_QA" | "STANDARD_QA" | "PREMIUM_QA";
export type Evidence = { t: number | null; note: string };
export type HardCheck = { code: string; ok: boolean; detail: string; evidence: Evidence[]; repair: RepairAction | null };
export type SoftScore = { name: string; score: number; weight: number; explanation: string; evidence: Evidence[] };
export type RepairAction = "SUBTITLE_REFLOW" | "TRIM_SILENCE" | "LOUDNESS_FIX" | "REGENERATE_THUMBNAIL" | "RERENDER_SCENE" | "NONE";

export type JudgeReport = {
  file: string;
  format: Format;
  mode: QaMode;
  hard: HardCheck[];
  soft: SoftScore[];
  editorialScore: number;
  verdict: "PASS" | "REPAIRABLE" | "NEEDS_REVIEW";
  repairPlan: { action: RepairAction; reason: string; sceneIds: string[] }[];
  premium: { used: boolean; note: string };
  sampledFrames: number;
  judgedAt: string;
  disclaimer: string;
};

export type JudgeInput = {
  file: string;
  srt: string;
  format: Format;
  /** scene timings from render-proof (optional; improves evidence) */
  sceneTimings?: { sceneId: string; start: number; duration: number }[];
  storyboard?: Storyboard | null;
  thumbnailScore?: number | null;
  /** disclosures the metadata MUST carry (affiliate/AI) and whether they do */
  disclosure?: { required: boolean; present: boolean };
  /** fact/rights gate state — accuracy is scored from gates, never from a model's opinion */
  gatesOk?: boolean | null;
  novelty?: number | null;
  mode?: QaMode;
  /** false when some cues are on-screen captions without narration (e.g. gameplay captions) */
  subtitleSyncCheck?: boolean;
  minSec?: number;
  maxSec?: number;
  /** PREMIUM_QA hook: paid judge — called ONLY when no hard error was found and caller allows it */
  premiumJudge?: (r: JudgeReport) => Promise<{ used: boolean; note: string; adjust?: number }>;
};

type Interval = { start: number; end: number };

async function signals(file: string) {
  const r = await runProcess(
    FFMPEG,
    ["-hide_banner", "-nostats", "-loglevel", "info", "-i", file, "-filter_complex", "[0:v]split=2[a][b];[a]blackdetect=d=0.8:pix_th=0.06[v1];[b]freezedetect=n=0.002:d=3[v2];[0:a]silencedetect=n=-45dB:d=2.5,ebur128=peak=true[a1]", "-map", "[v1]", "-map", "[v2]", "-map", "[a1]", "-f", "null", "-"],
    { timeoutMs: 20 * 60_000 },
  );
  const err = r.stderr;
  const blacks = [...err.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => ({ start: +m[1], end: +m[2] }));
  const iv = (startRe: RegExp, endRe: RegExp, dur: number) => {
    const out: Interval[] = [...err.matchAll(startRe)].map((m) => ({ start: Math.max(0, +m[1]), end: dur }));
    [...err.matchAll(endRe)].forEach((m, i) => out[i] && (out[i].end = +m[1]));
    return out;
  };
  const summary = err.slice(err.lastIndexOf("Summary:"));
  return {
    blacks,
    freezesRaw: (dur: number) => iv(/freeze_start: ([\d.]+)/g, /freeze_end: ([\d.]+)/g, dur),
    silencesRaw: (dur: number) => iv(/silence_start: (-?[\d.]+)/g, /silence_end: ([\d.]+)/g, dur),
    lufs: Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1] ?? NaN),
    peak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1] ?? NaN),
  };
}

/** Speech (non-silent at -35 dB) intervals — used for subtitle/audio alignment. */
async function speechIntervals(file: string, dur: number): Promise<Interval[]> {
  const r = await runProcess(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "silencedetect=n=-35dB:d=0.35", "-f", "null", "-"], { timeoutMs: 10 * 60_000 });
  const sil: Interval[] = [...r.stderr.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => ({ start: Math.max(0, +m[1]), end: dur }));
  [...r.stderr.matchAll(/silence_end: ([\d.]+)/g)].forEach((m, i) => sil[i] && (sil[i].end = +m[1]));
  const speech: Interval[] = [];
  let t = 0;
  for (const s of sil.sort((a, b) => a.start - b.start)) {
    if (s.start > t) speech.push({ start: t, end: s.start });
    t = Math.max(t, s.end);
  }
  if (t < dur) speech.push({ start: t, end: dur });
  return speech;
}

const overlap = (a: Interval, list: Interval[]) => list.reduce((s, b) => s + Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)), 0);

async function frameStats(png: string) {
  const st = await sharp(png).greyscale().stats();
  const px = await sharp(png).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let h = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h = (h << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  return { mean: st.channels[0].mean, std: st.channels[0].stdev, hash: h };
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

/**
 * AI Video Quality Judge — multi-signal and explainable, NOT one opaque model score. Objective
 * hard blockers are separated from heuristic editorial scores. It inspects the real MP4 (probe,
 * filters, 1–2 sampled frames per scene, SRT vs speech). It cannot certify virality.
 */
export async function judgeVideo(input: JudgeInput): Promise<JudgeReport> {
  const mode = input.mode ?? "FAST_QA";
  const spec = FORMAT_SPECS[input.format];
  const hard: HardCheck[] = [];
  const soft: SoftScore[] = [];
  const add = (code: string, ok: boolean, detail: string, evidence: Evidence[] = [], repair: RepairAction | null = null) => hard.push({ code, ok, detail, evidence, repair: ok ? null : repair });

  const p = await probeMedia(input.file);
  const dur = p.durationSec;
  add("DIMENSIONS", p.width === spec.width && p.height === spec.height && p.rotation === 0, `${p.width}x${p.height} xoay ${p.rotation}° (cần ${spec.width}x${spec.height})`, [], "RERENDER_SCENE");
  add("FPS_CFR", Math.abs(p.fps - spec.fps) < 0.5 && !p.vfr, `${p.fps.toFixed(2)} fps${p.vfr ? " VFR" : ""}`, [], "RERENDER_SCENE");
  add("CODECS", p.videoCodec === "h264" && p.audioCodec === "aac" && p.pixFmt === "yuv420p", `${p.videoCodec}/${p.audioCodec}/${p.pixFmt}`, [], "RERENDER_SCENE");
  const expectedFrames = Math.round(dur * spec.fps);
  if (p.frames !== null) add("FRAME_COUNT", Math.abs(p.frames - expectedFrames) <= Math.max(3, expectedFrames * 0.02), `${p.frames} khung / mong đợi ~${expectedFrames} (phát hiện đoạn hỏng/thiếu)`, [], "RERENDER_SCENE");
  add("DURATION", dur >= (input.minSec ?? spec.minSec) && dur <= (input.maxSec ?? spec.maxSec), `${dur.toFixed(2)}s`, [], "NONE");

  const s = await signals(input.file);
  const longBlack = s.blacks.filter((b) => b.end - b.start > 1);
  add("NO_BLACK_FRAMES", !longBlack.length, longBlack.length ? `${longBlack.length} đoạn màn đen` : "không có", longBlack.map((b) => ({ t: b.start, note: `đen ${(b.end - b.start).toFixed(1)}s` })), "RERENDER_SCENE");
  const silences = s.silencesRaw(dur).filter((x) => x.end - x.start > 2.5);
  const sceneAt = (t: number) => input.sceneTimings?.find((x) => t >= x.start && t < x.start + x.duration)?.sceneId ?? null;
  add("NO_DEAD_AIR", !silences.length, silences.length ? `${silences.length} khoảng lặng > 2.5s` : "không có", silences.map((x) => ({ t: Math.round(x.start * 10) / 10, note: `lặng ${(x.end - x.start).toFixed(1)}s${sceneAt(x.start + 0.1) ? ` (cảnh ${sceneAt(x.start + 0.1)})` : ""}` })), "TRIM_SILENCE");
  add("LOUDNESS", s.lufs >= -18 && s.lufs <= -10, `${s.lufs} LUFS (−18..−10)`, [], "LOUDNESS_FIX");
  add("PEAK", s.peak <= -0.5, `${s.peak} dBFS`, [], "LOUDNESS_FIX");

  // subtitles: presence, length (safe width), reading speed, timing vs speech
  const srt = await fs.readFile(input.srt, "utf8").catch(() => "");
  const cues: Cue[] = srt.trim() ? parseSrt(srt) : [];
  const safeWidthPx = spec.width - spec.safe.left - spec.safe.right;
  const maxCharsPerLine = Math.floor(safeWidthPx / (spec.subtitle.fontSize * 0.55));
  const tooLong = cues.filter((c) => c.text.length > maxCharsPerLine * 2);
  const tooFast = cues.filter((c) => c.text.replace(/\s/g, "").length / Math.max(0.01, c.end - c.start) > 22);
  add("SUBTITLES_PRESENT", cues.length > 0, `${cues.length} câu`, [], "SUBTITLE_REFLOW");
  add("SUBTITLE_FITS_SAFE_AREA", !tooLong.length, tooLong.length ? `${tooLong.length} câu dài hơn 2 dòng trong vùng an toàn (${maxCharsPerLine} ký tự/dòng) — chữ có thể bị cắt` : "vừa vùng an toàn", tooLong.slice(0, 5).map((c) => ({ t: c.start, note: `"${c.text.slice(0, 40)}…" (${c.text.length} ký tự)` })), "SUBTITLE_REFLOW");
  add("SUBTITLE_READING_SPEED", !tooFast.length, tooFast.length ? `${tooFast.length} câu hiển thị quá nhanh (> 22 ký tự/giây)` : "≤ 22 ký tự/giây", tooFast.slice(0, 5).map((c) => ({ t: c.start, note: `${(c.text.length / (c.end - c.start)).toFixed(0)} ký tự/s` })), "SUBTITLE_REFLOW");
  const speech = await speechIntervals(input.file, dur);
  const misaligned = cues.filter((c) => c.end - c.start > 0.6 && overlap(c, speech) / (c.end - c.start) < 0.4);
  if (input.subtitleSyncCheck !== false) add("SUBTITLE_AUDIO_SYNC", misaligned.length <= Math.max(1, cues.length * 0.15), `${misaligned.length}/${cues.length} câu không trùng lời nói`, misaligned.slice(0, 5).map((c) => ({ t: c.start, note: `"${c.text.slice(0, 30)}" không có tiếng nói` })), "SUBTITLE_REFLOW");
  const vi = await vietnameseFontAvailable();
  add("VIETNAMESE_FONT", vi !== false, vi === null ? "không kiểm tra được fontconfig (Windows: kiểm tra bằng mắt)" : vi ? "có font hỗ trợ dấu" : "THIẾU font tiếng Việt — dấu sẽ lỗi", [], "NONE");

  // sampled frames: 1–2 per scene (or every ~3 s)
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ttm-judge-"));
  const times = input.sceneTimings?.length
    ? input.sceneTimings.flatMap((x) => (x.duration > 4 && mode !== "FAST_QA" ? [x.start + x.duration * 0.3, x.start + x.duration * 0.75] : [x.start + x.duration * 0.5]))
    : Array.from({ length: Math.max(2, Math.floor(dur / 3)) }, (_, i) => (i + 0.5) * 3).filter((t) => t < dur);
  const frames: { t: number; mean: number; std: number; hash: bigint }[] = [];
  try {
    for (const [i, t] of times.entries()) {
      const f = path.join(tmp, `f${i}.png`);
      await ffmpeg(["-ss", t.toFixed(2), "-i", input.file, "-frames:v", "1", "-vf", "scale=320:-2", f]);
      frames.push({ t, ...(await frameStats(f)) });
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
  const dark = frames.filter((f) => f.mean < 18);
  const flat = frames.filter((f) => f.std < 8);
  add("READABLE_FRAMES", !dark.length && !flat.length, `${dark.length} khung quá tối, ${flat.length} khung gần như trơn (mất nội dung)`, [...dark, ...flat].map((f) => ({ t: Math.round(f.t * 10) / 10, note: `độ sáng ${f.mean.toFixed(0)}, tương phản ${f.std.toFixed(0)}` })), "RERENDER_SCENE");

  // ------------------------------------------------------------ editorial (soft, heuristic, explained)
  const sc = (name: string, score: number, weight: number, explanation: string, evidence: Evidence[] = []) => soft.push({ name, score: Math.max(0, Math.min(100, Math.round(score))), weight, explanation, evidence });
  const first = cues[0];
  const hookScene = input.sceneTimings?.[0];
  const hookTitle = input.storyboard?.scenes[0]?.title ?? "";
  sc(
    "Hook rõ trong 1–3 giây đầu",
    (first && first.start < 0.8 ? 40 : 10) + (hookScene && hookScene.duration <= 4 ? 30 : 10) + (hookTitle && hookTitle.length <= 60 ? 30 : hookTitle ? 15 : 0),
    3,
    `Lời đầu bắt đầu ở ${first ? first.start.toFixed(2) : "?"}s; cảnh mở dài ${hookScene?.duration.toFixed(1) ?? "?"}s; tiêu đề hook ${hookTitle.length} ký tự`,
    first ? [{ t: first.start, note: first.text.slice(0, 50) }] : [],
  );
  const words = cues.reduce((a, c) => a + c.text.split(/\s+/).filter(Boolean).length, 0);
  const wps = words / Math.max(1, dur);
  sc("Mật độ thông tin", wps >= 1.6 && wps <= 3.4 ? 90 : wps < 1.6 ? 40 + wps * 25 : 100 - (wps - 3.4) * 40, 2, `${wps.toFixed(2)} từ/giây (dễ theo: 1.6–3.4 cho tiếng Việt)`);
  const shots = input.sceneTimings?.length ?? Math.max(1, frames.length);
  const sps = dur / shots;
  sc("Nhịp dựng", input.format === "short_9x16" ? (sps <= 7 ? 90 : 90 - (sps - 7) * 12) : sps <= 25 ? 85 : 85 - (sps - 25) * 3, 2, `${sps.toFixed(1)} giây/cảnh (${shots} cảnh)`);
  let repeats = 0;
  for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) if (ham(frames[i].hash, frames[j].hash) <= 4) repeats++;
  const pairs = (frames.length * (frames.length - 1)) / 2 || 1;
  sc("Đa dạng hình ảnh", 100 - (repeats / pairs) * 200, 1, `${repeats}/${pairs} cặp khung gần như giống hệt (B-roll lặp)`);
  const claimScenes = input.storyboard?.scenes.filter((x) => x.claimIds.length) ?? [];
  if (claimScenes.length) sc("Khớp claim ↔ hình (có ghi nguồn trên khung)", (claimScenes.filter((x) => x.sourceCaption).length / claimScenes.length) * 100, 2, `${claimScenes.filter((x) => x.sourceCaption).length}/${claimScenes.length} cảnh có claim hiển thị nguồn`);
  const cta = input.storyboard?.scenes.at(-1)?.kind === "cta" || input.storyboard?.scenes.at(-2)?.kind === "cta";
  const ctaDur = input.sceneTimings?.find((x) => /cta/.test(x.sceneId))?.duration ?? null;
  sc("CTA phù hợp", (cta || !input.storyboard ? 60 : 20) + (ctaDur !== null && ctaDur / dur <= 0.2 ? 40 : ctaDur === null ? 20 : 0), 1, `CTA ${cta ? "có" : "không rõ"}; thời lượng CTA ${ctaDur?.toFixed(1) ?? "?"}s (${ctaDur ? Math.round((ctaDur / dur) * 100) : "?"}%)`);
  if (input.novelty != null) sc("Giá trị mới (độ khác biệt)", input.novelty * 100, 2, `novelty ${input.novelty} từ báo cáo originality`);
  if (input.thumbnailScore != null) sc("Thumbnail", input.thumbnailScore, 1, `điểm heuristic thumbnail ${input.thumbnailScore}/100`);
  if (input.gatesOk != null) sc("Độ chính xác (theo cổng fact/quyền)", input.gatesOk ? 100 : 0, 3, input.gatesOk ? "mọi claim/quyền đã qua cổng" : "còn claim/quyền bị giữ — xem cổng");
  if (input.disclosure) sc("Công bố (quảng cáo/AI)", !input.disclosure.required || input.disclosure.present ? 100 : 0, 2, input.disclosure.required ? (input.disclosure.present ? "có công bố" : "THIẾU công bố bắt buộc") : "không bắt buộc");
  sc("Khả năng tiếp cận", (cues.length ? 50 : 0) + (tooFast.length ? 0 : 25) + (dark.length ? 0 : 25), 1, `${cues.length ? "có" : "không có"} phụ đề; ${tooFast.length} câu quá nhanh; ${dark.length} khung quá tối`);
  const tw = soft.reduce((a, x) => a + x.weight, 0);
  const editorialScore = Math.round(soft.reduce((a, x) => a + x.score * x.weight, 0) / Math.max(1, tw));

  const failed = hard.filter((h) => !h.ok);
  const repairable = failed.every((h) => h.repair && h.repair !== "NONE");
  const repairPlan = [...new Set(failed.map((h) => h.repair!).filter((r) => r !== "NONE"))].map((action) => ({
    action,
    reason: failed.filter((h) => h.repair === action).map((h) => h.code).join(", "),
    sceneIds: [...new Set(failed.filter((h) => h.repair === action).flatMap((h) => h.evidence.map((e) => (e.t !== null ? sceneAt(e.t + 0.1) : null)).filter(Boolean) as string[]))],
  }));
  const report: JudgeReport = {
    file: input.file,
    format: input.format,
    mode,
    hard,
    soft,
    editorialScore,
    verdict: failed.length ? (repairable ? "REPAIRABLE" : "NEEDS_REVIEW") : "PASS",
    repairPlan,
    premium: { used: false, note: mode === "PREMIUM_QA" ? "chưa gọi" : "không dùng (FAST/STANDARD là kiểm tra local miễn phí)" },
    sampledFrames: frames.length,
    judgedAt: new Date().toISOString(),
    disclaimer: "Điểm biên tập là heuristic có giải thích, không dự đoán viral. Lỗi cứng (hard) mới chặn đăng.",
  };
  // paid judge never called when a cheaper deterministic check already found a hard error
  if (mode === "PREMIUM_QA") {
    if (failed.length) report.premium = { used: false, note: "bỏ qua judge trả phí: đã có lỗi cứng từ kiểm tra local" };
    else if (input.premiumJudge) {
      const r = await input.premiumJudge(report);
      report.premium = { used: r.used, note: r.note };
      if (r.used && r.adjust) report.editorialScore = Math.max(0, Math.min(100, report.editorialScore + r.adjust));
    } else report.premium = { used: false, note: "PREMIUM_QA chưa cấu hình provider (BudgetRouter) — dùng kết quả local" };
  }
  return report;
}
