import { spawn } from "node:child_process";
import { FactoryError } from "@ttm/core";

export type RunResult = { code: number; stdout: string; stderr: string; ms: number };

/** Run an isolated subprocess with timeout; stderr tail kept for actionable errors. */
export function runProcess(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number; input?: string } = {}): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const cap = (s: string, add: string) => (s.length > 2_000_000 ? s : s + add);
    child.stdout.on("data", (d) => (stdout = cap(stdout, d.toString())));
    child.stderr.on("data", (d) => (stderr = cap(stderr, d.toString())));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new FactoryError("PROCESS_TIMEOUT", "RETRYABLE", `${cmd} vượt quá thời gian ${opts.timeoutMs} ms`));
    }, opts.timeoutMs ?? 10 * 60_000);
    child.on("error", (e: any) => {
      clearTimeout(timer);
      reject(
        e.code === "ENOENT"
          ? new FactoryError("BINARY_MISSING", "HUMAN_REQUIRED", `Không tìm thấy chương trình "${cmd}". Hãy cài đặt và thêm vào PATH (xem RUNBOOK.md).`)
          : e,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, ms: Date.now() - started });
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
export const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

export async function ffmpeg(args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<RunResult> {
  const r = await runProcess(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], opts);
  if (r.code !== 0) {
    const tail = r.stderr.trim().split("\n").slice(-6).join("\n");
    const oom = /out of memory|CUDA_ERROR_OUT_OF_MEMORY|OpenEncodeSessionEx failed/i.test(r.stderr);
    const disk = /No space left on device/i.test(r.stderr);
    throw new FactoryError(oom ? "GPU_OOM" : disk ? "DISK_FULL" : "FFMPEG_FAILED", disk ? "HUMAN_REQUIRED" : "RETRYABLE", `FFmpeg lỗi: ${tail}`);
  }
  return r;
}

export type ProbeInfo = {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string | null;
  rotation: number;
  pixFmt: string | null;
};

export async function ffprobe(file: string): Promise<ProbeInfo> {
  const r = await runProcess(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { timeoutMs: 60_000 });
  if (r.code !== 0) throw new FactoryError("FFPROBE_FAILED", "PERMANENT", `FFprobe không đọc được file ${file}: ${r.stderr.trim().slice(-300)}`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s: any) => s.codec_type === "video");
  const a = j.streams.find((s: any) => s.codec_type === "audio");
  const [num, den] = String(v?.avg_frame_rate ?? "0/1").split("/").map(Number);
  const rot = Number(v?.side_data_list?.find((s: any) => s.rotation !== undefined)?.rotation ?? v?.tags?.rotate ?? 0);
  return {
    durationSec: Number(j.format?.duration ?? 0),
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    fps: den ? num / den : 0,
    videoCodec: v?.codec_name ?? "none",
    audioCodec: a?.codec_name ?? null,
    rotation: rot,
    pixFmt: v?.pix_fmt ?? null,
  };
}

export async function audioDuration(file: string): Promise<number> {
  const r = await runProcess(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { timeoutMs: 30_000 });
  return Number(r.stdout.trim()) || 0;
}
