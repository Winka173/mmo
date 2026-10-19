import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getStore } from "../../../lib/data";

const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".srt": "text/plain; charset=utf-8", ".png": "image/png" };

/** Serves render artifacts only (projects/<id>/renders/<format>/<file>); path-safe, localhost UI. */
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const [id, format, file] = (await params).path;
  if (!id || !format || !file || !TYPES[path.extname(file)]) return new Response("Không hợp lệ", { status: 400 });
  const store = await getStore();
  let full: string;
  try {
    full = store.p("projects", id, "renders", format, file);
  } catch {
    return new Response("Đường dẫn không an toàn", { status: 400 });
  }
  const data = await fs.readFile(full).catch(() => null);
  if (!data) return new Response("Không tìm thấy", { status: 404 });
  const headers: Record<string, string> = { "content-type": TYPES[path.extname(file)], "content-length": String(data.length) };
  if (new URL(req.url).searchParams.get("download")) headers["content-disposition"] = `attachment; filename="${id}-${file}"`;
  return new Response(data, { headers });
}
