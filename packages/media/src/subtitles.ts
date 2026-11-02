export type Cue = { start: number; end: number; text: string };
export type SpeechInterval = { start: number; end: number };

/** Match the deterministic two-line ASS layout; the width estimate is not font measurement. */
export function captionLines(text: string, wrapAt: number): string[] {
  if (Array.from(text).length <= wrapAt) return [text];
  const words = text.split(" ");
  if (words.length < 2) return [text];
  let best = 1, bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const d = Math.abs(Array.from(words.slice(0, i).join(" ")).length - Array.from(words.slice(i).join(" ")).length);
    if (d < bestDiff) [best, bestDiff] = [i, d];
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

function ts(sec: number, sep = ","): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(r).padStart(3, "0")}`;
}

/** Split narration into readable chunks; timing proportional to characters within [start, start+dur]. */
export function cuesForNarration(text: string, start: number, dur: number, maxChars: number, speech?: SpeechInterval[]): Cue[] {
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(dur) || dur <= 0 || !Number.isFinite(maxChars) || maxChars < 1) throw new RangeError("Caption offset, duration and character limit must be finite positive values (offset may be zero)");
  const length = (value: string) => Array.from(value).length;
  const sentences = text.split(/(?<=[.!?…;:])\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (const s of sentences) {
    const words = s.split(/\s+/);
    let cur = "";
    for (const w of words) {
      if (length((cur + " " + w).trim()) > maxChars && cur) {
        chunks.push(cur);
        cur = w;
      } else cur = (cur + " " + w).trim();
    }
    if (cur) chunks.push(cur);
  }
  // merge tiny trailing fragments ("chính nó?") into the previous cue so nothing flashes by
  for (let i = chunks.length - 1; i > 0; i--) {
    if (length(chunks[i]) < 14 && length(chunks[i - 1]) + length(chunks[i]) + 1 <= maxChars + 14) {
      chunks[i - 1] = `${chunks[i - 1]} ${chunks[i]}`;
      chunks.splice(i, 1);
    }
  }
  // Speech intervals are local to this narration file. They anchor phrase boundaries,
  // but distributing characters over speech time is still an estimate, not alignment.
  const spans = speech?.length && speech.every((s, i) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end > s.start && s.end <= dur + 0.001 && (!i || s.start >= speech[i - 1].end)) ? speech : undefined;
  const speechDuration = spans?.reduce((sum, s) => sum + s.end - s.start, 0) ?? dur;
  // Short opening/interior sentences can flash even when the complete narration is
  // readable. Regroup adjacent text within the same two-line allowance. This is
  // still estimated phrase timing; never lengthen cues into unmeasured speech.
  for (let i = 0; i < chunks.length && chunks.length > 1;) {
    const total = chunks.reduce((sum, chunk) => sum + length(chunk), 0) || 1;
    if (speechDuration * length(chunks[i]) / total >= 0.8) { i++; continue; }
    const candidates = [i - 1, i + 1].filter(j => j >= 0 && j < chunks.length && length(chunks[j]) + length(chunks[i]) + 1 <= maxChars + 14);
    if (!candidates.length) { i++; continue; }
    const neighbor = candidates.sort((a, b) => length(chunks[a]) - length(chunks[b]))[0], first = Math.min(i, neighbor);
    chunks.splice(first, 2, `${chunks[first]} ${chunks[first + 1]}`);
    i = Math.max(0, first - 1);
  }
  const total = chunks.reduce((sum, chunk) => sum + length(chunk), 0) || 1;
  const position = (elapsed: number, side: "start" | "end") => {
    if (!spans) return start + elapsed;
    let remaining = elapsed;
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i], length = s.end - s.start;
      if (remaining < length - 1e-9 || side === "end" && remaining <= length + 1e-9 || i === spans.length - 1) return start + s.start + Math.min(length, Math.max(0, remaining));
      remaining -= length;
    }
    return start + spans[spans.length - 1].end;
  };
  let t = 0;
  return chunks.map((c) => {
    const d = (speechDuration * length(c)) / total;
    const cue = { start: position(t, "start"), end: position(t + d, "end"), text: c };
    t += d;
    return cue;
  });
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n");
}

/** ASS with PlayRes = real video size so margins/font sizes are exact pixels. */
export function toAss(cues: Cue[], o: { width: number; height: number; fontSize: number; marginV: number; fontName?: string;color?:string }): string {
  const t = (sec: number) => {
    const cs = Math.max(0, Math.round(sec * 100));
    const h = Math.floor(cs / 360000);
    const m = Math.floor((cs % 360000) / 6000);
    const s = Math.floor((cs % 6000) / 100);
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
  };
  const wrapAt = Math.floor((o.width * 0.8) / (o.fontSize * 0.55));
  const rgb=/^#[a-fA-F0-9]{6}$/.test(o.color??"")?o.color!.slice(1):"FFFFFF",primary=`&H00${rgb.slice(4,6)}${rgb.slice(2,4)}${rgb.slice(0,2)}`;
  // A zero-width word joiner makes user backslashes literal to libass (e.g. a
  // Windows path containing \\N). Fullwidth braces preserve visible braces while
  // preventing override tags. Renderer-owned line breaks are added afterwards.
  const literal = (text: string) => text.replace(/\\/g, "\\\u2060").replace(/\{/g, "｛").replace(/\}/g, "｝").replace(/[\r\n\t]+/g, " ");
  const breakLine = (text: string) => captionLines(text, wrapAt).map(literal).join("\\N");
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${o.width}`,
    `PlayResY: ${o.height}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${o.fontName ?? "DejaVu Sans"},${o.fontSize},${primary},&H00FFFFFF,&H00000000,&H96000000,1,0,0,0,100,100,0,0,3,14,0,2,60,60,${o.marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...cues.map((c) => `Dialogue: 0,${t(c.start)},${t(c.end)},Default,,0,0,0,,${breakLine(c.text)}`),
    "",
  ].join("\n");
}

export function parseSrt(srt: string): Cue[] {
  const toSec = (t: string) => {
    const [h, m, rest] = t.split(":");
    const [s, ms] = rest.split(",");
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
  };
  return srt
    .trim()
    .split(/\n\s*\n/)
    .map((b) => {
      const lines = b.split("\n");
      const [a, z] = lines[1].split(" --> ");
      return { start: toSec(a.trim()), end: toSec(z.trim()), text: lines.slice(2).join("\n") };
    });
}

/** YouTube chapter rules: first at 0:00, at least 3 chapters, each >= 10 s. */
export function buildChapters(marks: { start: number; title: string }[]): { ok: boolean; text: string; reason?: string } {
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
  };
  if (!marks.length || marks[0].start > 0.5) return { ok: false, text: "", reason: "chương đầu tiên phải bắt đầu ở 0:00" };
  if (marks.length < 3) return { ok: false, text: "", reason: "cần ít nhất 3 chương" };
  for (let i = 1; i < marks.length; i++)
    if (marks[i].start - marks[i - 1].start < 10) return { ok: false, text: "", reason: `chương "${marks[i - 1].title}" ngắn hơn 10 giây` };
  return { ok: true, text: marks.map((m, i) => `${fmt(i === 0 ? 0 : m.start)} ${m.title}`).join("\n") };
}
