import "server-only";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";

export const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".srt": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".json": "application/json; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".wav": "audio/wav", ".mp3": "audio/mpeg",
};

/** Stream a local file with HTTP Range support (video scrubbing in the wizard). Caller guarantees path safety. */
export async function serveFile(req: Request, full: string, downloadName?: string): Promise<Response> {
  const type = MIME[path.extname(full).toLowerCase()];
  if (!type) return new Response("Loại file không được phục vụ", { status: 400 });
  const st = await fs.stat(full).catch(() => null);
  if (!st?.isFile()) return new Response("Không tìm thấy", { status: 404 });
  const headers: Record<string, string> = { "content-type": type, "accept-ranges": "bytes", "cache-control": "private, max-age=60" };
  if (downloadName) headers["content-disposition"] = `attachment; filename="${encodeURIComponent(downloadName)}"`;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start >= st.size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${st.size}` } });
    headers["content-range"] = `bytes ${start}-${end}/${st.size}`;
    headers["content-length"] = String(end - start + 1);
    return new Response(Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream, { status: 206, headers });
  }
  headers["content-length"] = String(st.size);
  return new Response(Readable.toWeb(createReadStream(full)) as ReadableStream, { headers });
}
