import * as fs from "node:fs/promises";
import type { Format, QaReport } from "@ttm/core";
import { sha256File } from "@ttm/storage";
import { FORMAT_SPECS } from "./brand.js";
import { ffprobe, runProcess, FFMPEG } from "./exec.js";
import { parseSrt } from "./subtitles.js";

async function analyse(file: string) {
  const r = await runProcess(
    FFMPEG,
    ["-hide_banner", "-nostats", "-i", file, "-vf", "blackdetect=d=0.8:pix_th=0.06", "-af", "silencedetect=n=-45dB:d=2.5,ebur128=peak=true", "-f", "null", "-"],
    { timeoutMs: 15 * 60_000 },
  );
  const err = r.stderr;
  const blacks = [...err.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => ({ start: +m[1], end: +m[2] }));
  const silences = [...err.matchAll(/silence_start: ([\d.]+)/g)].length;
  const summary = err.slice(err.lastIndexOf("Summary:"));
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1] ?? NaN);
  const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1] ?? NaN);
  return { blacks, silences, lufs, peak };
}

/** Render QA gate (spec E4): no silent/black/wrong-size video can pass. */
export async function qaVideo(input: { projectId: string; format: Format; file: string; srt: string; poster: string; minSec?: number; maxSec?: number }): Promise<QaReport> {
  const spec = FORMAT_SPECS[input.format];
  const checks: QaReport["checks"] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const probe = await ffprobe(input.file);
  const minSec = input.minSec ?? spec.minSec;
  const maxSec = input.maxSec ?? spec.maxSec;
  add("kích thước", probe.width === spec.width && probe.height === spec.height, `${probe.width}x${probe.height} (cần ${spec.width}x${spec.height})`);
  add("tỉ lệ khung", Math.abs(probe.width / probe.height - spec.width / spec.height) < 0.01, `${(probe.width / probe.height).toFixed(4)}`);
  add("fps", Math.abs(probe.fps - spec.fps) < 0.5, `${probe.fps.toFixed(2)} fps`);
  add("codec video H.264", probe.videoCodec === "h264", probe.videoCodec);
  add("codec audio AAC", probe.audioCodec === "aac", probe.audioCodec ?? "không có audio");
  add("pixel format yuv420p", probe.pixFmt === "yuv420p", probe.pixFmt ?? "?");
  add("thời lượng", probe.durationSec >= minSec && probe.durationSec <= maxSec, `${probe.durationSec.toFixed(2)}s (cho phép ${minSec}–${maxSec}s)`);
  const a = await analyse(input.file);
  const longBlack = a.blacks.filter((b) => b.end - b.start > 1.0);
  add("không có khung đen dài", longBlack.length === 0, longBlack.length ? JSON.stringify(longBlack) : "không phát hiện");
  add("không có khoảng lặng > 2.5s", a.silences === 0, `${a.silences} đoạn lặng`);
  add("độ ồn tích hợp (-18..-10 LUFS)", a.lufs >= -18 && a.lufs <= -10, `${a.lufs} LUFS`);
  add("đỉnh âm thanh <= -0.5 dBFS", a.peak <= -0.5, `${a.peak} dBFS`);
  const srt = await fs.readFile(input.srt, "utf8").catch(() => "");
  const cues = srt ? parseSrt(srt) : [];
  const overlong = cues.filter((c) => c.text.length > 64 || c.end - c.start < 0.7);
  add("phụ đề đọc được", cues.length > 0 && overlong.length === 0, `${cues.length} câu, ${overlong.length} câu quá dài/quá nhanh`);
  add("phụ đề UTF-8 tiếng Việt", /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(srt), "có dấu tiếng Việt");
  add("poster tồn tại", (await fs.stat(input.poster).catch(() => null))?.size! > 1000, input.poster);
  const sha = await sha256File(input.file);
  return {
    schemaVersion: 1,
    projectId: input.projectId,
    format: input.format,
    file: input.file,
    sha256: sha,
    ffprobe: { width: probe.width, height: probe.height, durationSec: probe.durationSec, videoCodec: probe.videoCodec, audioCodec: probe.audioCodec, fps: probe.fps },
    checks,
    passed: checks.every((c) => c.ok),
    createdAt: new Date().toISOString(),
  };
}
