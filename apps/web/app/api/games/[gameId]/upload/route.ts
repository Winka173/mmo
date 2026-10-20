import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { GameMediaIntake, parseShotList, AssetKind } from "@ttm/games";
import { getGames } from "../../../../lib/data";

export const runtime = "nodejs";

/**
 * Multipart upload for one game: media files, ZIP packs, JSON manifest or CSV shot list.
 * Files are written to a private temp dir, then imported (hash, sniff, probe, content-address).
 * Only localhost serves this UI (next start -H 127.0.0.1).
 */
export async function POST(req: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const games = await getGames();
  if (!(await games.get(gameId))) return Response.json({ error: `Không có game ${gameId}` }, { status: 404 });
  const origin = req.headers.get("origin");
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return Response.json({ error: "Chỉ chấp nhận từ localhost" }, { status: 403 });
  const form = await req.formData();
  const kindRaw = String(form.get("kind") ?? "");
  const kind = AssetKind.safeParse(kindRaw).success ? (kindRaw as any) : undefined;
  const buildId = String(form.get("buildId") ?? "") || null;
  const annotation = String(form.get("annotation") ?? "");
  const locked = form.get("lockedThumbnail") === "on" || form.get("lockedThumbnail") === "true";
  const intake = new GameMediaIntake(games);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ttm-upload-"));
  try {
    const files: { path: string; originalName: string }[] = [];
    for (const f of form.getAll("files")) {
      if (typeof f === "string") continue;
      const name = path.basename(f.name || "upload.bin").replace(/[^\p{L}\p{N}._ -]/gu, "_");
      const p = path.join(tmp, `${files.length}-${name}`);
      await fs.writeFile(p, Buffer.from(await f.arrayBuffer()));
      files.push({ path: p, originalName: f.name || name });
    }
    if (!files.length) return Response.json({ error: "Chưa chọn file" }, { status: 400 });
    const out: unknown[] = [];
    const media: typeof files = [];
    for (const f of files) {
      const ext = path.extname(f.originalName).toLowerCase();
      if (ext === ".zip") out.push((await intake.importZip(gameId, f.path, { defaults: kind ? { kind, buildId, annotation } : { buildId, annotation } })).manifest);
      else if (ext === ".csv") {
        const r = parseShotList(await fs.readFile(f.path, "utf8"), await games.media(gameId));
        out.push({ shotList: r });
      } else if (ext === ".json") out.push({ error: "Nhập manifest JSON bằng CLI `factory game-import` (đường dẫn file tham chiếu cần nằm cạnh manifest)" });
      else media.push(f);
    }
    if (media.length)
      out.push((await intake.importFiles(gameId, media.map((m) => ({ path: m.path, originalName: m.originalName, opts: { kind, buildId, annotation, flags: kind === "thumbnail" ? { lockedThumbnail: locked } : undefined } })))).manifest);
    return Response.json({ ok: true, results: out });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 400 });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
