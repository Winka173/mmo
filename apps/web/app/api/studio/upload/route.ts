import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { getStore } from "../../../lib/data";
export async function POST(request: Request) {
  if (request.headers.get("origin") !== `http://${request.headers.get("host")}`) return Response.json({ error: "Invalid origin" }, { status: 403 });
  try {
    // Stream-sized upload caps before buffering. Large footage can be imported by folder.
    const size = Number(request.headers.get("content-length") ?? 0);
    if (!size || size > 256 * 1024 * 1024) throw new Error("Upload limit 256 MB. Use a local folder for larger media.");
    const form = await request.formData(); const files = form.getAll("files") as File[];
    if (!files.length || files.length > 30) throw new Error("Choose 1–30 media files");
    const store = await getStore(); const dir = store.p("studio", "imports", randomUUID()); await fs.mkdir(dir, { recursive: true });
    for (const file of files) {
      const ext = path.extname(file.name).toLowerCase();
      if (![".mp4", ".mov", ".mkv", ".webm", ".jpg", ".jpeg", ".png", ".webp"].includes(ext)) throw new Error("Unsupported media extension");
      await fs.writeFile(path.join(dir, `${randomUUID()}${ext}`), Buffer.from(await file.arrayBuffer()));
    }
    return Response.json({ folder: dir, count: files.length });
  } catch(e: any) { return Response.json({ error: e.message }, { status: 400 }); }
}
