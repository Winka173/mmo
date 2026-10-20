import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FactoryError, type Storyboard } from "@ttm/core";
import { FORMAT_SPECS, type BrandKit } from "./brand.js";
import { detectEncoder, type EncoderChoice } from "./encoder.js";
import { ffmpeg } from "./exec.js";
import { renderSceneFrame, renderThumbnail } from "./frames.js";
import { buildChapters, cuesForNarration, toAss, toSrt, type Cue } from "./subtitles.js";
import type { TtsProvider } from "./tts.js";

export type RenderInput = {
  storyboard: Storyboard;
  brand: BrandKit;
  tts: TtsProvider;
  workDir: string;
  outDir: string;
  /** assetId -> local image path for verified assets */
  assetFiles?: Record<string, string>;
  badges?: string[];
  encoder?: EncoderChoice;
  thumbnailTitle?: string;
  onProgress?: (stage: string, detail: string) => void;
  /** max characters per subtitle cue (auto-repair lowers it when cues are too long/fast) */
  subtitleMaxChars?: number;
};

export type RenderOutput = {
  video: string;
  srt: string;
  transcript: string;
  poster: string;
  thumbnail: string;
  durationSec: number;
  sceneTimings: { sceneId: string; start: number; duration: number }[];
  chapters: ReturnType<typeof buildChapters> | null;
  encoder: string;
  /** scene ids actually (re)rendered in this run — others came from cache */
  scenesRendered: string[];
  cues: Cue[];
};

const PAD_AFTER_NARRATION = 0.45;

/**
 * Deterministic FFmpeg pipeline (CPU by default; NVENC only if verified):
 * per-scene TTS -> per-scene frame -> per-scene clip with slow pan + fades -> concat ->
 * loudness-normalised narration track -> burned-in subtitles -> H.264/AAC MP4 (+faststart).
 * Narration WAVs are cached by content so a failed render resumes without re-synthesis.
 */
export async function renderStoryboard(input: RenderInput): Promise<RenderOutput> {
  const sb = input.storyboard;
  const spec = FORMAT_SPECS[sb.format];
  const log = input.onProgress ?? (() => undefined);
  await fs.mkdir(input.workDir, { recursive: true });
  await fs.mkdir(input.outDir, { recursive: true });
  const enc = input.encoder ?? (await detectEncoder({ allowGpu: false }));

  const timings: RenderOutput["sceneTimings"] = [];
  const cues: Cue[] = [];
  const segs: string[] = [];
  const auds: string[] = [];
  let t = 0;
  const maxChars = input.subtitleMaxChars ?? (sb.format === "short_9x16" ? 30 : 46);
  const segsRendered: string[] = [];

  for (const [i, scene] of sb.scenes.entries()) {
    const wav = path.join(input.workDir, `narr-${String(i).padStart(2, "0")}-${hash(scene.narration + input.tts.id)}.wav`);
    let narr: number;
    try {
      await fs.access(wav);
      const { audioDuration } = await import("./exec.js");
      narr = await audioDuration(wav);
    } catch {
      log("TTS", `cảnh ${i + 1}/${sb.scenes.length}`);
      narr = await input.tts.synthesize(scene.narration, wav);
    }
    if (!(narr > 0.2)) throw new FactoryError("TTS_EMPTY", "RETRYABLE", `TTS trả về audio rỗng ở cảnh ${scene.id}`);
    const dur = Math.max(scene.minSeconds, narr + PAD_AFTER_NARRATION);
    timings.push({ sceneId: scene.id, start: t, duration: dur });
    cues.push(...cuesForNarration(scene.narration, t + 0.05, narr, maxChars));

    // per-scene cache: an unchanged scene is never re-rendered (scoped auto-repair / resume)
    const segKey = hash(JSON.stringify([scene, dur.toFixed(3), sb.format, input.brand, scene.assetId ? input.assetFiles?.[scene.assetId] ?? null : null, i === 0 ? input.badges : [], i, sb.scenes.length]));
    const seg = path.join(input.workDir, `seg-${String(i).padStart(2, "0")}-${segKey}.mp4`);
    const pad = path.join(input.workDir, `aud-${String(i).padStart(2, "0")}.wav`);
    if (await fs.stat(seg).catch(() => null)) {
      segs.push(seg);
      await ffmpeg(["-i", wav, "-af", `apad=whole_dur=${dur.toFixed(3)}`, "-t", dur.toFixed(3), "-ar", "48000", "-ac", "2", pad]);
      auds.push(pad);
      t += dur;
      continue;
    }
    segsRendered.push(scene.id);
    const png = path.join(input.workDir, `frame-${String(i).padStart(2, "0")}.png`);
    log("FRAME", `cảnh ${i + 1}`);
    await renderSceneFrame(
      {
        scene,
        format: sb.format,
        brand: input.brand,
        backgroundImage: scene.assetId ? (input.assetFiles?.[scene.assetId] ?? null) : null,
        badges: i === 0 ? input.badges : [],
        index: i,
        total: sb.scenes.length,
      },
      png,
    );
    const fadeIn = scene.transition === "fade" ? `,fade=t=in:st=0:d=0.25` : "";
    const fadeOut = `,fade=t=out:st=${(dur - 0.25).toFixed(3)}:d=0.25`;
    const dir = i % 2 === 0 ? "" : "1-";
    await ffmpeg(
      [
        "-loop", "1", "-framerate", String(spec.fps), "-t", dur.toFixed(3), "-i", png,
        "-vf", `crop=${spec.width}:${spec.height}:x='(iw-ow)*(${dir}t/${dur.toFixed(3)})':y='(ih-oh)/2'${fadeIn}${fadeOut},format=yuv420p`,
        "-r", String(spec.fps), ...enc.args, "-an", seg,
      ],
      { timeoutMs: 5 * 60_000 },
    );
    segs.push(seg);
    await ffmpeg(["-i", wav, "-af", `apad=whole_dur=${dur.toFixed(3)}`, "-t", dur.toFixed(3), "-ar", "48000", "-ac", "2", pad]);
    auds.push(pad);
    t += dur;
  }

  log("CONCAT", `${segs.length} đoạn`);
  const list = path.join(input.workDir, "segments.txt");
  await fs.writeFile(list, segs.map((s) => `file '${path.basename(s)}'`).join("\n"));
  const silent = path.join(input.workDir, "video-noaudio.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", "segments.txt", "-c", "copy", silent], { cwd: input.workDir });
  const alist = path.join(input.workDir, "audio.txt");
  await fs.writeFile(alist, auds.map((s) => `file '${path.basename(s)}'`).join("\n"));
  const narration = path.join(input.workDir, "narration.wav");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", "audio.txt", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", narration], { cwd: input.workDir });

  const base = sb.format;
  const srtPath = path.join(input.outDir, `${base}.vi.srt`);
  await fs.writeFile(srtPath, toSrt(cues), "utf8");
  await fs.writeFile(
    path.join(input.workDir, "subs.ass"),
    toAss(cues, { width: spec.width, height: spec.height, fontSize: spec.subtitle.fontSize, marginV: spec.subtitle.marginV, fontName: process.env.SUBTITLE_FONT }),
    "utf8",
  );
  const transcript = path.join(input.outDir, `${base}.transcript.txt`);
  await fs.writeFile(transcript, sb.scenes.map((s) => s.narration).join("\n\n") + "\n", "utf8");

  log("MUX", "phụ đề + âm thanh");
  const out = path.join(input.outDir, `${base}.mp4`);
  const tmpOut = path.join(input.workDir, `${base}.partial.mp4`);
  await ffmpeg(
    [
      "-i", "video-noaudio.mp4", "-i", "narration.wav",
      "-vf", "ass=subs.ass",
      ...enc.args, "-pix_fmt", "yuv420p", "-r", String(spec.fps),
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
      "-movflags", "+faststart", "-shortest", path.basename(tmpOut),
    ],
    { cwd: input.workDir, timeoutMs: 20 * 60_000 },
  );
  await fs.rename(tmpOut, out); // never leave a half-written final file

  const poster = path.join(input.outDir, `${base}.poster.png`);
  await ffmpeg(["-ss", Math.min(1.2, t / 3).toFixed(2), "-i", out, "-frames:v", "1", poster]);
  const thumbnail = path.join(input.outDir, `${base}.thumbnail.png`);
  await renderThumbnail({ title: input.thumbnailTitle ?? sb.title, format: sb.format, brand: input.brand, badge: input.badges?.[0] }, thumbnail);

  let chapters: RenderOutput["chapters"] = null;
  if (sb.format === "long_16x9") {
    const marks = sb.scenes.flatMap((s, i) => (s.chapterTitle ? [{ start: timings[i].start, title: s.chapterTitle }] : []));
    chapters = buildChapters(marks);
  }
  return { video: out, srt: srtPath, transcript, poster, thumbnail, durationSec: t, sceneTimings: timings, chapters, encoder: enc.reason, scenesRendered: segsRendered, cues };
}

function hash(s: string) {
  let h = 5381;
  for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return h.toString(36);
}
