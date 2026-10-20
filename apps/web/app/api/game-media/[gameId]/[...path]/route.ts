import { getStore } from "../../../../lib/data";
import { serveFile } from "../../../../lib/serve";

/** Serves a game's own media (games/<gameId>/media/**) only; path-safe; Range for scrubbing. */
export async function GET(req: Request, { params }: { params: Promise<{ gameId: string; path: string[] }> }) {
  const { gameId, path } = await params;
  if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(gameId) || !path.length) return new Response("Không hợp lệ", { status: 400 });
  const store = await getStore();
  let full: string;
  try {
    full = store.p("games", gameId, "media", ...path);
  } catch {
    return new Response("Đường dẫn không an toàn", { status: 400 });
  }
  return serveFile(req, full);
}
