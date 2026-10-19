import * as os from "node:os";
import * as path from "node:path";
import { FFMPEG, runProcess } from "./exec.js";

export type EncoderChoice = { codec: "libx264" | "h264_nvenc"; args: string[]; reason: string; gpu: { name: string; vramMb: number; driver: string } | null };

/** Detect NVIDIA GPU + driver and verify NVENC with a real 1-second test encode before trusting it. */
export async function detectEncoder(opts: { allowGpu?: boolean } = {}): Promise<EncoderChoice> {
  const cpu: EncoderChoice = { codec: "libx264", args: ["-c:v", "libx264", "-preset", "medium", "-crf", "20"], reason: "CPU libx264 (mặc định an toàn)", gpu: null };
  if (opts.allowGpu === false) return cpu;
  let gpu: EncoderChoice["gpu"] = null;
  try {
    const r = await runProcess("nvidia-smi", ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"], { timeoutMs: 10_000 });
    if (r.code === 0 && r.stdout.trim()) {
      const [name, mem, driver] = r.stdout.trim().split("\n")[0].split(",").map((s) => s.trim());
      gpu = { name, vramMb: Number(mem), driver };
    }
  } catch {
    /* no nvidia-smi */
  }
  if (!gpu) return { ...cpu, reason: "Không phát hiện GPU NVIDIA — dùng CPU libx264" };
  const out = path.join(os.tmpdir(), `ttm-nvenc-test-${process.pid}.mp4`);
  const t = await runProcess(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720:d=1", "-c:v", "h264_nvenc", out], { timeoutMs: 30_000 }).catch(
    () => null,
  );
  if (!t || t.code !== 0) return { ...cpu, gpu, reason: `GPU ${gpu.name} có nhưng NVENC thử mã hóa thất bại — dùng CPU` };
  return { codec: "h264_nvenc", args: ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "21", "-b:v", "0"], reason: `NVENC đã kiểm chứng trên ${gpu.name}`, gpu };
}
