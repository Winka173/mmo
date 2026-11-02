import { captionLines, type Cue } from "./subtitles.js";

export type CaptionFinding = { criterion: string; status: "fail" | "unknown"; cueIndex?: number; evidence: Record<string, unknown>; recommendedFix: string };

/** Deterministic readability checks. Layout is a conservative character estimate, not OCR. */
export function inspectCaptionCues(cues: Cue[], options: { duration: number; width: number; fontSize: number; minDuration?: number; maxCharactersPerSecond?: number }) {
  const minDuration = options.minDuration ?? 0.8, maxCharactersPerSecond = options.maxCharactersPerSecond ?? 20;
  const wrapAt = Math.max(1, Math.floor((options.width * 0.8) / (options.fontSize * 0.55)));
  const findings: CaptionFinding[] = [];
  if (!cues.length) findings.push({ criterion: "caption.missing", status: "fail", evidence: { cueCount: 0 }, recommendedFix: "Add captions from the original script and review their timing" });
  const metrics = cues.map((cue, cueIndex) => {
    const duration = cue.end - cue.start, characters = Array.from(cue.text).length;
    const lines = captionLines(cue.text, wrapAt), lineLengths = lines.map(line => Array.from(line).length);
    const charactersPerSecond = duration > 0 && Number.isFinite(duration) ? characters / duration : null;
    const add = (criterion: string, status: "fail" | "unknown", evidence: Record<string, unknown>, recommendedFix: string) => findings.push({ criterion, status, cueIndex, evidence, recommendedFix });
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || duration <= 0 || cue.end > options.duration + 0.001) add("caption.bounds", "fail", { start: cue.start, end: cue.end, mediaDuration: options.duration }, "Correct cue bounds without changing spoken content");
    if (cueIndex && cue.start < cues[cueIndex - 1].end - 0.001) add("caption.overlap", "fail", { start: cue.start, previousEnd: cues[cueIndex - 1].end }, "Review overlapping cue times");
    if (!cue.text.trim()) add("caption.empty_text", "fail", {}, "Restore original caption text");
    if (duration > 0 && duration < minDuration) add("caption.minimum_duration", "unknown", { duration, minimumSeconds: minDuration }, "Review this short cue; adjust caption grouping or timing after listening");
    if (charactersPerSecond !== null && charactersPerSecond > maxCharactersPerSecond) add("caption.reading_speed", "unknown", { characters, duration, charactersPerSecond, maximumCharactersPerSecond: maxCharactersPerSecond }, "Review reading speed; regroup captions without removing speech or facts");
    if (lineLengths.some(length => length > wrapAt)) add("caption.layout_overflow", "unknown", { lines, lineLengths, estimatedCharactersPerLine: wrapAt, layoutMethod: "ASS two-line character estimate" }, "Inspect the rendered caption and regroup or resize it if needed");
    return { cueIndex, start: cue.start, end: cue.end, duration, characters, charactersPerSecond, lines, lineLengths };
  });
  return { status: findings.some(f => f.status === "fail") ? "fail" : findings.length ? "review_required" : "pass", limits: { minDuration, maxCharactersPerSecond, estimatedCharactersPerLine: wrapAt }, metrics, findings, layoutMethod: "ASS two-line character estimate; visual review required" };
}
