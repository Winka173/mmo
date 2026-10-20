import { getStore } from "../../../lib/data";
import { serveFile } from "../../../lib/serve";

/** Serves render artifacts only (projects/<id>/renders/<format>/<file>); path-safe, localhost UI, Range-capable. */
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const [id, format, file, extra] = (await params).path;
  if (!id || !format || !file || extra) return new Response("Không hợp lệ", { status: 400 });
  const store = await getStore();
  let full: string;
  try {
    full = store.p("projects", id, "renders", format, file);
  } catch {
    return new Response("Đường dẫn không an toàn", { status: 400 });
  }
  return serveFile(req, full, new URL(req.url).searchParams.get("download") ? `${id}-${file}` : undefined);
}
