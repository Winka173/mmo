import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FactoryError, type Format } from "@ttm/core";
import sharp from "sharp";
import { FORMAT_SPECS, type BrandKit } from "./brand.js";
import { detectEncoder, type EncoderChoice } from "./encoder.js";
import { audioDuration, ffmpeg } from "./exec.js";
import { esc, wrap } from "./frames.js";
import { buildChapters, cuesForNarration, toAss, toSrt, type Cue } from "./subtitles.js";
import type { TtsProvider } from "./tts.js";

export type GameplaySegment = {
  id: string;
  file: string;
  in: number;
  out: number;
  srcWidth: number;
  srcHeight: number;
  hasAudio: boolean;
  keepAudio: boolean;
  /** on-screen caption (truthful annotation of what happens) */
  caption: string;
  narration: string | null;
  /** small persistent label: build label, "Concept — không phải gameplay", … */
  label: string | null;
  chapterTitle?: string | null;
  /** image segments (screenshots / key art) are shown with a slow zoom */
  still?: boolean;
  stillSec?: number;
};

export type GameRenderInput = {
  format: Format;
  brand: BrandKit;
  gameName: string;
  logoFile: string | null;
  hook: string;
  segments: GameplaySegment[];
  cta: { title: string; sub: string; narration: string | null };
  tts: TtsProvider | null;
  workDir: string;
  outDir: string;
  badges?: string[];
  encoder?: EncoderChoice;
  music?: { file: string; gainDb: number } | null;
  onProgress?: (stage: string, detail: string) => void;
};

export type GameRenderOutput = {
  video: string;
  srt: string;
  transcript: string;
  poster: string;
  durationSec: number;
  sceneTimings: { sceneId: string; start: number; duration: number }[];
  chapters: ReturnType<typeof buildChapters> | null;
  encoder: string;
  compositions: { segmentId: string; mode: "fill" | "blur_pad" | "still"; srcAspect: number }[];
};

const r3 = (n: number) => n.toFixed(3);

/** How a source is fitted into the target frame. Big aspect mismatch => blurred-pad, never a misleading crop. */
export function fitMode(srcW: number, srcH: number, dstW: number, dstH: number): "fill" | "blur_pad" {
  const sa = srcW / srcH;
  const da = dstW / dstH;
  return Math.abs(sa - da) / da < 0.06 ? "fill" : "blur_pad";
}

async function overlayPng(o: { W: number; H: number; format: Format; brand: BrandKit; gameName: string; logo: Buffer | null; caption: string; label: string | null; badges: string[] }, out: string) {
  const spec = FORMAT_SPECS[o.format];
  const c = o.brand.colors;
  const font = o.brand.fontFamily;
  const v = o.format === "short_9x16";
  const L = spec.safe.left;
  const top = spec.safe.top;
  const logoSize = v ? 96 : 76;
  const nameX = L + (o.logo ? logoSize + 20 : 0);
  const nameSize = v ? 44 : 36;
  const pillW = Math.min(o.W - nameX - spec.safe.right, 40 + o.gameName.length * nameSize * 0.58);
  let svg = `<rect x="${nameX - 14}" y="${top + logoSize / 2 - nameSize * 0.85}" width="${pillW}" height="${nameSize * 1.5}" rx="${nameSize * 0.4}" fill="${c.bg2}" opacity="0.72"/>
    <text x="${nameX}" y="${top + logoSize / 2 + nameSize * 0.32}" font-size="${nameSize}" font-weight="800" fill="${c.text}" font-family="${font}">${esc(o.gameName)}</text>`;
  let captionBottom = top + logoSize + 30;
  if (o.caption) {
    const size = v ? 54 : 44;
    const lines = wrap(o.caption, size, o.W - L - spec.safe.right - 40, v ? 3 : 2);
    const y0 = v ? top + logoSize + 60 : top + logoSize + 30;
    const boxH = lines.length * size * 1.25 + 34;
    captionBottom = y0 + boxH;
    svg += `<rect x="${L - 8}" y="${y0}" width="${o.W - L - spec.safe.right + 16}" height="${boxH}" rx="22" fill="${c.bg2}" opacity="0.78"/>`;
    lines.forEach((ln, i) => (svg += `<text x="${L + 18}" y="${y0 + 22 + size * (i + 0.95) * 1.18}" font-size="${size}" font-weight="700" fill="${c.text}" font-family="${font}">${esc(ln)}</text>`));
  }
  // 9:16: labels go under the caption box (top safe area) so burned subtitles never cover them;
  // 16:9: bottom-left, above the subtitle band.
  const bottomY = o.H - spec.safe.bottom + (v ? -20 : -10);
  const tags = [...o.badges, ...(o.label ? [o.label] : [])];
  tags.forEach((t, i) => {
    const size = v ? 30 : 26;
    const y = v ? captionBottom + 50 + i * (size * 1.9) : bottomY - i * (size * 1.9);
    svg += `<rect x="${L - 6}" y="${y - size * 1.1}" width="${Math.min(o.W - L - spec.safe.right, 34 + t.length * size * 0.56)}" height="${size * 1.55}" rx="12" fill="${c.bg2}" opacity="0.8"/><text x="${L + 10}" y="${y}" font-size="${size}" fill="${c.badge}" font-family="${font}">${esc(t)}</text>`;
  });
  const base = sharp({ create: { width: o.W, height: o.H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  const comps: sharp.OverlayOptions[] = [{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${o.W}" height="${o.H}">${svg}</svg>`), top: 0, left: 0 }];
  if (o.logo) comps.unshift({ input: await sharp(o.logo).resize(logoSize, logoSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(), top, left: L });
  await base.composite(comps).png().toFile(out);
}

async function hookPng(o: { W: number; H: number; format: Format; brand: BrandKit; hook: string }, out: string) {
  const v = o.format === "short_9x16";
  const size = v ? 92 : 78;
  const lines = wrap(o.hook, size, o.W * 0.84, 3);
  const c = o.brand.colors;
  const y0 = v ? o.H * 0.4 : o.H * 0.42;
  const txt = lines.map((l, i) => `<text x="${o.W / 2}" y="${y0 + i * size * 1.15}" text-anchor="middle" font-size="${size}" font-weight="900" fill="${c.text}" stroke="${c.bg2}" stroke-width="10" paint-order="stroke" font-family="${o.brand.fontFamily}">${esc(l)}</text>`).join("");
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${o.W}" height="${o.H}">${txt}</svg>`)).png().toFile(out);
}

async function outroPng(o: { W: number; H: number; format: Format; brand: BrandKit; gameName: string; logo: Buffer | null; title: string; sub: string }, out: string) {
  const c = o.brand.colors;
  const v = o.format === "short_9x16";
  const ts = v ? 80 : 68;
  const lines = wrap(o.title, ts, o.W * 0.8, 3);
  const y0 = v ? o.H * 0.5 : o.H * 0.55;
  const subLines = wrap(o.sub, ts * 0.5, o.W * 0.8, 3);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${o.W}" height="${o.H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.bg1}"/><stop offset="1" stop-color="${c.bg2}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="${o.W / 2}" y="${y0 - (v ? 120 : 90)}" text-anchor="middle" font-size="${v ? 56 : 46}" font-weight="800" fill="${c.accent}" font-family="${o.brand.fontFamily}">${esc(o.gameName)}</text>
    ${lines.map((l, i) => `<text x="${o.W / 2}" y="${y0 + i * ts * 1.15}" text-anchor="middle" font-size="${ts}" font-weight="900" fill="${c.text}" font-family="${o.brand.fontFamily}">${esc(l)}</text>`).join("")}
    ${subLines.map((l, i) => `<text x="${o.W / 2}" y="${y0 + lines.length * ts * 1.15 + 40 + i * ts * 0.62}" text-anchor="middle" font-size="${ts * 0.5}" fill="${c.muted}" font-family="${o.brand.fontFamily}">${esc(l)}</text>`).join("")}
  </svg>`;
  const comps: sharp.OverlayOptions[] = [];
  const ls = v ? 260 : 200;
  if (o.logo) comps.push({ input: await sharp(o.logo).resize(ls, ls, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(), top: Math.round(y0 - (v ? 120 : 90) - ls - 50), left: Math.round(o.W / 2 - ls / 2) });
  await sharp(Buffer.from(svg)).composite(comps).png().toFile(out);
}

/**
 * Real gameplay video: every frame in the clip part comes from the user's own capture file (or a
 * still asset with a visible label). The composition never crops a source by more than ~6% of its
 * aspect; bigger mismatches use a blurred pad of the same footage.
 */
export async function renderGameplayVideo(input: GameRenderInput): Promise<GameRenderOutput> {
  const spec = FORMAT_SPECS[input.format];
  const W = spec.width;
  const H = spec.height;
  const fps = spec.fps;
  const log = input.onProgress ?? (() => undefined);
  if (!input.segments.length) throw new FactoryError("NO_SEGMENTS", "HUMAN_REQUIRED", "Không có clip/asset nào để dựng");
  await fs.mkdir(input.workDir, { recursive: true });
  await fs.mkdir(input.outDir, { recursive: true });
  const enc = input.encoder ?? (await detectEncoder({ allowGpu: false }));
  const logo = input.logoFile ? await fs.readFile(input.logoFile) : null;
  const timings: GameRenderOutput["sceneTimings"] = [];
  const cues: Cue[] = [];
  const segs: string[] = [];
  const comps: GameRenderOutput["compositions"] = [];
  const maxChars = input.format === "short_9x16" ? 30 : 46;
  let t = 0;
  const hookPath = path.join(input.workDir, "hook.png");
  await hookPng({ W, H, format: input.format, brand: input.brand, hook: input.hook }, hookPath);

  const narrate = async (text: string | null, key: string): Promise<{ wav: string | null; sec: number }> => {
    if (!text || !input.tts) return { wav: null, sec: 0 };
    const wav = path.join(input.workDir, `narr-${key}-${hash(text + input.tts.id)}.wav`);
    if (await fs.stat(wav).catch(() => null)) return { wav, sec: await audioDuration(wav) };
    log("TTS", key);
    const sec = await input.tts.synthesize(text, wav);
    if (!(sec > 0.2)) throw new FactoryError("TTS_EMPTY", "RETRYABLE", `TTS rỗng ở ${key}`);
    return { wav, sec };
  };

  for (const [i, s] of input.segments.entries()) {
    const srcDur = Math.max(0.5, s.still ? (s.stillSec ?? 3) : s.out - s.in);
    const n = await narrate(s.narration, `${String(i).padStart(2, "0")}`);
    const dur = Math.max(srcDur, n.sec + 0.35);
    const ov = path.join(input.workDir, `ov-${i}.png`);
    await overlayPng({ W, H, format: input.format, brand: input.brand, gameName: input.gameName, logo, caption: s.caption, label: s.label, badges: i === 0 ? (input.badges ?? []) : [] }, ov);
    const mode = s.still ? "still" : fitMode(s.srcWidth, s.srcHeight, W, H);
    comps.push({ segmentId: s.id, mode, srcAspect: Math.round((s.srcWidth / s.srcHeight) * 1000) / 1000 });
    const fit =
      mode === "fill"
        ? `[0:v]fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[base]`
        : mode === "still"
          ? `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=decrease,pad=${W * 2}:${H * 2}:(ow-iw)/2:(oh-ih)/2:color=black,zoompan=z='min(zoom+0.0008,1.08)':d=${Math.ceil(dur * fps)}:s=${W}x${H}:fps=${fps},setsar=1[base]`
          : `[0:v]fps=${fps},split=2[bg][fg];[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=28:2,eq=brightness=-0.05:saturation=1.1[bgb];[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[fgs];[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1[base]`;
    const pad = dur - srcDur > 0.02 ? `,tpad=stop_mode=clone:stop_duration=${r3(dur - srcDur + 0.05)}` : "";
    const hookOv = i === 0 ? `;[v1][2:v]overlay=0:0:enable='lt(t,2.8)'[v2]` : "";
    const vOut = i === 0 ? "v2" : "v1";
    const useGame = s.hasAudio && s.keepAudio && !s.still;
    const inputs = s.still ? ["-loop", "1", "-t", r3(dur), "-i", s.file] : ["-ss", r3(s.in), "-t", r3(srcDur), "-i", s.file];
    inputs.push("-loop", "1", "-i", ov);
    if (i === 0) inputs.push("-loop", "1", "-i", hookPath);
    const nIdx = inputs.filter((x) => x === "-i").length;
    if (n.wav) inputs.push("-i", n.wav);
    let audio: string;
    if (useGame && n.wav) audio = `;[0:a]aresample=48000,volume=0.3,apad[ga];[${nIdx}:a]aresample=48000,apad[na];[na][ga]amix=inputs=2:duration=first:normalize=0,atrim=0:${r3(dur)},aformat=channel_layouts=stereo[aout]`;
    else if (useGame) audio = `;[0:a]aresample=48000,apad,atrim=0:${r3(dur)},aformat=channel_layouts=stereo[aout]`;
    else if (n.wav) audio = `;[${nIdx}:a]aresample=48000,apad,atrim=0:${r3(dur)},aformat=channel_layouts=stereo[aout]`;
    else audio = `;anullsrc=r=48000:cl=stereo,atrim=0:${r3(dur)}[aout]`;
    const filter = `${fit};[base]${pad ? pad.slice(1) : "null"}[bp];[bp][1:v]overlay=0:0,format=yuv420p[v1]${hookOv}${audio}`;
    const seg = path.join(input.workDir, `seg-${String(i).padStart(2, "0")}.mp4`);
    log("CLIP", `${i + 1}/${input.segments.length} ${mode}`);
    await ffmpeg([...inputs, "-filter_complex", filter, "-map", `[${vOut}]`, "-map", "[aout]", "-t", r3(dur), "-r", String(fps), ...enc.args, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", seg], { timeoutMs: 20 * 60_000 });
    segs.push(seg);
    timings.push({ sceneId: s.id, start: t, duration: dur });
    const subText = s.narration ?? s.caption;
    if (subText) cues.push(...cuesForNarration(subText, t + 0.05, Math.max(0.8, (n.sec || dur) - 0.1), maxChars));
    t += dur;
  }

  // outro CTA card
  const on = await narrate(input.cta.narration, "cta");
  const odur = Math.max(2.5, on.sec + 0.4);
  const opng = path.join(input.workDir, "outro.png");
  await outroPng({ W, H, format: input.format, brand: input.brand, gameName: input.gameName, logo, title: input.cta.title, sub: input.cta.sub }, opng);
  const oseg = path.join(input.workDir, "seg-99-outro.mp4");
  await ffmpeg(
    [
      "-loop", "1", "-framerate", String(fps), "-t", r3(odur), "-i", opng,
      ...(on.wav ? ["-i", on.wav] : ["-f", "lavfi", "-t", r3(odur), "-i", "anullsrc=r=48000:cl=stereo"]),
      "-filter_complex", `[0:v]fade=t=in:st=0:d=0.3,format=yuv420p[v];[1:a]aresample=48000,apad,atrim=0:${r3(odur)},aformat=channel_layouts=stereo[a]`,
      "-map", "[v]", "-map", "[a]", "-t", r3(odur), "-r", String(fps), ...enc.args, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", oseg,
    ],
    { timeoutMs: 5 * 60_000 },
  );
  segs.push(oseg);
  timings.push({ sceneId: "outro-cta", start: t, duration: odur });
  cues.push(...cuesForNarration(input.cta.narration ?? input.cta.title, t + 0.05, odur - 0.2, maxChars));
  t += odur;

  log("CONCAT", `${segs.length} đoạn`);
  await fs.writeFile(path.join(input.workDir, "segments.txt"), segs.map((s) => `file '${path.basename(s)}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", "segments.txt", "-c", "copy", "joined.mp4"], { cwd: input.workDir });
  const base = input.format;
  const srt = path.join(input.outDir, `${base}.vi.srt`);
  await fs.writeFile(srt, toSrt(cues), "utf8");
  await fs.writeFile(path.join(input.workDir, "subs.ass"), toAss(cues, { width: W, height: H, fontSize: spec.subtitle.fontSize, marginV: spec.subtitle.marginV, fontName: process.env.SUBTITLE_FONT }), "utf8");
  const transcript = path.join(input.outDir, `${base}.transcript.txt`);
  await fs.writeFile(transcript, [...input.segments.map((s) => s.narration ?? `[${s.caption}]`), input.cta.narration ?? input.cta.title].join("\n\n") + "\n", "utf8");
  const tmpOut = path.join(input.workDir, `${base}.partial.mp4`);
  const musicArgs = input.music ? ["-stream_loop", "-1", "-i", input.music.file] : [];
  const af = input.music ? `[1:a]volume=${Math.pow(10, input.music.gainDb / 20).toFixed(3)},atrim=0:${r3(t)}[m];[0:a][m]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.8:level=false[a]` : `[0:a]loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.8:level=false[a]`;
  log("MUX", "phụ đề + loudnorm");
  await ffmpeg(["-i", "joined.mp4", ...musicArgs, "-filter_complex", `[0:v]ass=subs.ass[v];${af}`, "-map", "[v]", "-map", "[a]", ...enc.args, "-pix_fmt", "yuv420p", "-r", String(fps), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-t", r3(t), path.basename(tmpOut)], { cwd: input.workDir, timeoutMs: 30 * 60_000 });
  const out = path.join(input.outDir, `${base}.mp4`);
  await fs.rename(tmpOut, out);
  const poster = path.join(input.outDir, `${base}.poster.png`);
  await ffmpeg(["-ss", Math.min(1.5, t / 3).toFixed(2), "-i", out, "-frames:v", "1", poster]);
  let chapters: GameRenderOutput["chapters"] = null;
  if (input.format === "long_16x9") {
    // greedy: only segments that start ≥10 s after the previous chapter become chapters (YouTube rule)
    const marks: { start: number; title: string }[] = [];
    for (const [i, s] of input.segments.entries()) {
      if (!s.chapterTitle) continue;
      const start = marks.length ? timings[i].start : 0;
      if (!marks.length || start - marks[marks.length - 1].start >= 10) marks.push({ start, title: s.chapterTitle });
    }
    while (marks.length > 1 && t - marks[marks.length - 1].start < 10) marks.pop();
    chapters = marks.length >= 3 ? buildChapters(marks) : null;
  }
  return { video: out, srt, transcript, poster, durationSec: t, sceneTimings: timings, chapters, encoder: enc.reason, compositions: comps };
}

function hash(s: string) {
  let h = 5381;
  for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return h.toString(36);
}
