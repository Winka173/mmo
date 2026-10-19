export type Cue = { start: number; end: number; text: string };

function ts(sec: number, sep = ","): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(r).padStart(3, "0")}`;
}

/** Split narration into readable chunks; timing proportional to characters within [start, start+dur]. */
export function cuesForNarration(text: string, start: number, dur: number, maxChars: number): Cue[] {
  const sentences = text.split(/(?<=[.!?…;:])\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (const s of sentences) {
    const words = s.split(/\s+/);
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > maxChars && cur) {
        chunks.push(cur);
        cur = w;
      } else cur = (cur + " " + w).trim();
    }
    if (cur) chunks.push(cur);
  }
  // merge tiny trailing fragments ("chính nó?") into the previous cue so nothing flashes by
  for (let i = chunks.length - 1; i > 0; i--) {
    if (chunks[i].length < 14 && chunks[i - 1].length + chunks[i].length + 1 <= maxChars + 14) {
      chunks[i - 1] = `${chunks[i - 1]} ${chunks[i]}`;
      chunks.splice(i, 1);
    }
  }
  const total = chunks.reduce((a, c) => a + c.length, 0) || 1;
  let t = start;
  return chunks.map((c) => {
    const d = (dur * c.length) / total;
    const cue = { start: t, end: t + d, text: c };
    t += d;
    return cue;
  });
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n");
}

/** ASS with PlayRes = real video size so margins/font sizes are exact pixels. */
export function toAss(cues: Cue[], o: { width: number; height: number; fontSize: number; marginV: number; fontName?: string }): string {
  const t = (sec: number) => {
    const cs = Math.max(0, Math.round(sec * 100));
    const h = Math.floor(cs / 360000);
    const m = Math.floor((cs % 360000) / 6000);
    const s = Math.floor((cs % 6000) / 100);
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
  };
  const wrapAt = Math.floor((o.width * 0.8) / (o.fontSize * 0.55));
  const breakLine = (text: string) => {
    if (text.length <= wrapAt) return text;
    const words = text.split(" ");
    let best = 1;
    let bestDiff = Infinity;
    for (let i = 1; i < words.length; i++) {
      const d = Math.abs(words.slice(0, i).join(" ").length - words.slice(i).join(" ").length);
      if (d < bestDiff) [best, bestDiff] = [i, d];
    }
    return `${words.slice(0, best).join(" ")}\\N${words.slice(best).join(" ")}`;
  };
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
    `Style: Default,${o.fontName ?? "DejaVu Sans"},${o.fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,1,0,0,0,100,100,0,0,3,14,0,2,60,60,${o.marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...cues.map((c) => `Dialogue: 0,${t(c.start)},${t(c.end)},Default,,0,0,0,,${breakLine(c.text.replace(/[{}]/g, ""))}`),
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
