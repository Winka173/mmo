import { getStore } from "../../../../lib/data";
import { serveFile } from "../../../../lib/serve";
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path;
  const store = await getStore();
  if (parts.some(p => !/^[a-zA-Z0-9._-]+$/.test(p) || p === "." || p === "..")) return new Response("Invalid path", { status: 400 });
  return serveFile(req, store.p("studio", "artifacts", ...parts));
}
