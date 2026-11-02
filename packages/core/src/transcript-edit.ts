import type { EditOperation, Timeline } from "./timeline.js";

export type TranscriptRange = { start: number; end: number };
export type TranscriptPhrase = TranscriptRange & { clipId: string; text: string; clipRefs: string[] };
export type TranscriptEditErrorCode = "NO_SELECTION" | "INVALID_RANGE" | "UNKNOWN_PHRASE" | "WHOLE_VIDEO" | "NO_RETAINED_SPEECH" | "PARTIAL_CAPTION" | "TOO_MANY_CUTS";
export class TranscriptEditError extends Error {
  constructor(public code: TranscriptEditErrorCode) { super(code); this.name = "TranscriptEditError"; }
}

/** Browser-safe planning only: no inference, text rewriting or mutation of a timeline. */
export function transcriptPhrases(timeline: Timeline): TranscriptPhrase[] {
  return timeline.clips.filter(c => c.track === "caption").map(c => ({
    clipId: c.id, start: c.start, end: c.start + c.duration, text: c.text,
    clipRefs: timeline.clips.filter(source => ["video", "dialogue"].includes(source.track) && source.start < c.start + c.duration && source.start + source.duration > c.start).map(source => source.id),
  })).sort((a, b) => a.start - b.start || a.end - b.end || a.clipId.localeCompare(b.clipId));
}

export function mergeTranscriptRanges(input: TranscriptRange[], duration: number): TranscriptRange[] {
  if (!input.length) throw new TranscriptEditError("NO_SELECTION");
  if (!Number.isFinite(duration) || duration <= 0 || input.some(r => !Number.isFinite(r.start) || !Number.isFinite(r.end) || r.start < 0 || r.end <= r.start || r.end > duration)) throw new TranscriptEditError("INVALID_RANGE");
  const merged: TranscriptRange[] = [];
  for (const range of input.map(r => ({ start: r.start, end: r.end })).sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push(range);
  }
  if (merged.reduce((sum, r) => sum + r.end - r.start, 0) >= duration - 0.0001) throw new TranscriptEditError("WHOLE_VIDEO");
  if (merged.length > 50) throw new TranscriptEditError("TOO_MANY_CUTS");
  return merged;
}

export function planTranscriptCut(timeline: Timeline, selectedClipIds: string[]) {
  const phrases = transcriptPhrases(timeline), selected = new Set(selectedClipIds);
  if (!selected.size) throw new TranscriptEditError("NO_SELECTION");
  if ([...selected].some(id => !phrases.some(phrase => phrase.clipId === id))) throw new TranscriptEditError("UNKNOWN_PHRASE");
  // Validate all caption bounds so retained-wording preview cannot hide malformed cues.
  if (phrases.some(p => !Number.isFinite(p.start) || !Number.isFinite(p.end) || p.start < 0 || p.end <= p.start || p.end > timeline.duration)) throw new TranscriptEditError("INVALID_RANGE");
  const ranges = mergeTranscriptRanges(phrases.filter(p => selected.has(p.clipId)), timeline.duration);
  const retained: (TranscriptPhrase & { originalStart: number; originalEnd: number })[] = [], removed: TranscriptPhrase[] = [];
  for (const phrase of phrases) {
    const intersecting = ranges.filter(range => phrase.start < range.end && phrase.end > range.start);
    if (intersecting.length) {
      // Core remove_range estimates words for partial cues. This transcript tool only
      // cuts whole phrases, so it refuses that path instead of inventing retained words.
      if (!intersecting.some(range => range.start <= phrase.start && range.end >= phrase.end)) throw new TranscriptEditError("PARTIAL_CAPTION");
      removed.push(phrase);
    } else {
      const shift = ranges.filter(range => range.end <= phrase.start).reduce((sum, range) => sum + range.end - range.start, 0);
      retained.push({ ...phrase, originalStart: phrase.start, originalEnd: phrase.end, start: phrase.start - shift, end: phrase.end - shift });
    }
  }
  if (!retained.some(phrase => phrase.text.trim())) throw new TranscriptEditError("NO_RETAINED_SPEECH");
  const sentenceBoundaryWarnings = removed.filter(phrase => {
    const previous = phrases[phrases.indexOf(phrase) - 1];
    return !/[.!?…。！？]["'”’)]*\s*$/.test(phrase.text) || !!previous && !/[.!?…。！？]["'”’)]*\s*$/.test(previous.text);
  }).map(phrase => phrase.clipId);
  const removedSeconds = ranges.reduce((sum, range) => sum + range.end - range.start, 0);
  // Existing API applies operations sequentially. Highest timestamps first preserve
  // the original coordinates of every earlier disjoint selection.
  const operations: EditOperation[] = [...ranges].reverse().map(range => ({ kind: "remove_range", ...range }));
  return { operations, ranges, removed, retained, sentenceBoundaryWarnings, removedSeconds, durationBefore: timeline.duration, durationAfter: timeline.duration - removedSeconds, captionTiming: timeline.captionTiming };
}
