import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { FactoryError, newId, nowIso } from "@ttm/core";
import { ffmpeg, probeMedia, runProcess, FFMPEG } from "@ttm/media";
import { sha256File, writeJsonAtomic } from "@ttm/storage";
import sharp from "sharp";
import yauzl from "yauzl";
import { z } from "zod";
import { GameRegistry } from "./registry.js";
import { AssetKind, AssetRights, ClipRef, GameAsset, ImportManifest, type AssetKind as AssetKindT } from "./schemas.js";

const EXT_KIND: Record<string, "video" | "image" | "audio" | "doc" | "model"> = {
  ".mp4": "video", ".mov": "video", ".webm": "video", ".mkv": "video", ".m4v": "video",
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image",
  ".wav": "audio", ".mp3": "audio", ".m4a": "audio", ".ogg": "audio", ".flac": "audio",
  ".md": "doc", ".txt": "doc", ".json": "doc", ".csv": "doc",
  ".glb": "model", ".fbx": "model",
};
const MIME: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska", ".m4v": "video/mp4", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".flac": "audio/flac", ".md": "text/markdown", ".txt": "text/plain", ".json": "application/json", ".csv": "text/csv", ".glb": "model/gltf-binary", ".fbx": "application/octet-stream" };

/** Folders/files never imported (secrets, VCS, engine caches, executables). */
export const IGNORED_PATH = /(^|[\\/])(\.git|\.svn|\.env[^\\/]*|[^\\/]*\.(pem|key|pfx|p12|exe|dll|bat|cmd|ps1|sh|js|mjs|cjs|py|vbs|msi|apk|ipa|so|dylib)|secrets?|node_modules|Library|Temp|obj|Intermediate|DerivedDataCache|\.godot|\.import)([\\/]|$)/i;

/** Content sniffing: the extension must match the real bytes (no disguised executables). */
export function sniffMatches(ext: string, head: Buffer): boolean {
  const s = (a: number, b: number) => head.subarray(a, b).toString("latin1");
  switch (ext) {
    case ".mp4": case ".mov": case ".m4v": case ".m4a":
      return s(4, 8) === "ftyp" || s(4, 8) === "moov" || s(4, 8) === "mdat" || s(4, 8) === "wide" || s(4, 8) === "free";
    case ".webm": case ".mkv":
      return head.readUInt32BE(0) === 0x1a45dfa3;
    case ".png":
      return head.readUInt32BE(0) === 0x89504e47;
    case ".jpg": case ".jpeg":
      return head[0] === 0xff && head[1] === 0xd8;
    case ".webp":
      return s(0, 4) === "RIFF" && s(8, 12) === "WEBP";
    case ".wav":
      return s(0, 4) === "RIFF" && s(8, 12) === "WAVE";
    case ".mp3":
      return s(0, 3) === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
    case ".ogg":
      return s(0, 4) === "OggS";
    case ".flac":
      return s(0, 4) === "fLaC";
    case ".glb":
      return s(0, 4) === "glTF";
    case ".md": case ".txt": case ".json": case ".csv":
      return !head.subarray(0, 512).includes(0); // text: no NUL bytes
    default:
      return false;
  }
}

/** Infer asset kind from path hints; the user can always correct it in the UI. */
export function inferKind(rel: string): AssetKindT {
  const r = rel.toLowerCase();
  const ext = path.extname(r);
  if (/ai[-_ ]?concept|midjourney|generated[-_]?concept|concept[-_]?ai/.test(r)) return "ai_concept";
  if (/thumb|cover/.test(r)) return "thumbnail";
  if (/logo/.test(r)) return "logo";
  if (/icon/.test(r)) return "icon";
  if (/key[-_ ]?art|keyart|poster/.test(r)) return "key_art";
  if (/charac|hero|sprite|unit/.test(r) && EXT_KIND[ext] === "image") return "character";
  if (/trailer/.test(r)) return "trailer";
  if (/music|bgm|soundtrack/.test(r)) return "music";
  if (/render|turntable/.test(r) && EXT_KIND[ext] !== "doc") return "render";
  if (/before|after/.test(r) && EXT_KIND[ext] === "image") return "before_after";
  switch (EXT_KIND[ext]) {
    case "video":
      return "gameplay";
    case "image":
      return "screenshot";
    case "audio":
      return "audio";
    default:
      return "document";
  }
}

export type ImportOptions = {
  kind?: AssetKindT;
  rights?: z.input<typeof AssetRights>;
  buildId?: string | null;
  annotation?: string;
  capturedAt?: string | null;
  flags?: Partial<GameAsset["flags"]>;
  uploadId?: string | null;
  originalName?: string;
  /** create a normalised 30fps SDR proxy when the source is VFR/HDR/10-bit/odd fps/rotated */
  normalize?: boolean;
};

export type ImportResult = { result: "imported" | "duplicate" | "rejected"; asset: GameAsset | null; reason: string | null };

const MAX_FILE_BYTES = 8 * 1024 ** 3;

/**
 * GameMediaIntake: immutable, content-addressed, per-game import. The same file imported into two
 * games gets two independent records under each game folder (no cross-game leakage).
 */
export class GameMediaIntake {
  constructor(readonly games: GameRegistry) {}

  private get store() {
    return this.games.store;
  }

  async importFile(gameId: string, src: string, opts: ImportOptions = {}): Promise<ImportResult> {
    const game = await this.games.mustGet(gameId);
    const originalName = opts.originalName ?? path.basename(src);
    const ext = path.extname(originalName).toLowerCase();
    const reject = (reason: string): ImportResult => ({ result: "rejected", asset: null, reason });
    if (IGNORED_PATH.test(originalName)) return reject("loại file/đường dẫn bị chặn (secret, mã thực thi hoặc thư mục hệ thống)");
    const cls = EXT_KIND[ext];
    if (!cls) return reject(`định dạng ${ext || "(không có đuôi)"} không được hỗ trợ`);
    const st = await fs.stat(src).catch(() => null);
    if (!st?.isFile()) return reject("không đọc được file");
    if (st.size === 0) return reject("file rỗng (0 byte) — hãy tải lên lại");
    if (st.size > MAX_FILE_BYTES) return reject("file vượt 8 GB — hãy cắt nhỏ hoặc xuất lại");
    const fh = await fs.open(src, "r");
    const head = Buffer.alloc(64);
    await fh.read(head, 0, 64, 0);
    await fh.close();
    if (!sniffMatches(ext, head)) return reject(`nội dung file không khớp đuôi ${ext} (có thể hỏng hoặc giả dạng)`);

    const kind = opts.kind ?? inferKind(originalName);
    const sha = await sha256File(src);
    const existing = (await this.games.media(game.gameId)).find((a) => a.sha256 === sha);
    if (existing) return { result: "duplicate", asset: existing, reason: `trùng nội dung với ${existing.assetId}` };

    const rel = path.posix.join("games", game.gameId, "media", kind, `${sha}${ext}`);
    const dest = this.store.p(rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
    if ((await sha256File(dest)) !== sha) {
      await fs.rm(dest, { force: true });
      return reject("sao chép lỗi (checksum khác) — thử lại");
    }

    let video: GameAsset["video"] = null;
    let image: GameAsset["image"] = null;
    const notes: string[] = [];
    try {
      if (cls === "video") {
        const p = await probeMedia(dest);
        if (!p.hasVideo || !(p.durationSec > 0.2) || !p.width) throw new FactoryError("MEDIA_CORRUPT", "PERMANENT", "không có luồng video hợp lệ");
        // decode start + end: catches truncated/corrupt files cheaply
        for (const args of [["-t", "1.5"], ["-sseof", "-1.5"]]) {
          const r = await runProcess(FFMPEG, ["-v", "error", ...args, "-i", dest, "-f", "null", "-"], { timeoutMs: 120_000 });
          if (r.code !== 0 || /Invalid data|corrupt|error while decoding|moov atom not found/i.test(r.stderr)) throw new FactoryError("MEDIA_CORRUPT", "PERMANENT", `giải mã lỗi: ${r.stderr.trim().split("\n").slice(-1)[0] ?? ""}`);
        }
        video = { durationSec: p.durationSec, width: p.width, height: p.height, fps: Math.round(p.fps * 100) / 100, vfr: p.vfr, hdr: p.hdr, bitDepth: p.bitDepth, videoCodec: p.videoCodec, audioCodec: p.audioCodec, rotation: p.rotation, hasAudio: p.hasAudio };
        if (p.vfr) notes.push("VFR (khung hình biến thiên)");
        if (p.hdr) notes.push("HDR — sẽ chuyển SDR ở bản proxy");
        if ((p.bitDepth ?? 8) > 8) notes.push(`${p.bitDepth}-bit`);
        if (p.rotation) notes.push(`metadata xoay ${p.rotation}°`);
      } else if (cls === "image") {
        const m = await sharp(dest).metadata();
        if (!m.width || !m.height) throw new FactoryError("MEDIA_CORRUPT", "PERMANENT", "ảnh không đọc được");
        await sharp(dest).resize(8, 8).raw().toBuffer(); // full decode
        image = { width: m.width, height: m.height, hasAlpha: !!m.hasAlpha };
      }
    } catch (e: any) {
      await fs.rm(dest, { force: true });
      return reject(`file media hỏng: ${e.message}`);
    }

    const ai = kind === "ai_concept" || !!opts.flags?.aiGenerated;
    const asset = GameAsset.parse({
      assetId: `${kind}-${sha.slice(0, 12)}`,
      gameId: game.gameId,
      kind: ai && kind === "gameplay" ? "ai_concept" : kind,
      path: rel,
      originalName,
      sha256: sha,
      bytes: st.size,
      mime: MIME[ext] ?? "application/octet-stream",
      video,
      image,
      buildId: opts.buildId ?? null,
      capturedAt: opts.capturedAt ?? null,
      rights: AssetRights.parse(opts.rights ?? { owner: game.ownerRights?.owner ?? game.studio ?? "chủ game", ownershipType: "OWNED", commercialUse: true, licenseId: "OWNED-GAME-ASSET", licenseEvidencePath: game.ownerRights?.evidencePath ?? null }),
      flags: { ...opts.flags, aiGenerated: ai, isGameplayCapture: kind === "gameplay" && !ai, lockedThumbnail: kind === "thumbnail" ? (opts.flags?.lockedThumbnail ?? false) : false },
      annotation: opts.annotation ?? "",
      qa: { status: notes.length ? "warn" : "ok", notes },
      uploadId: opts.uploadId ?? null,
      importedAt: nowIso(),
    });
    if (video && opts.normalize !== false && needsProxy(video)) asset.proxyPath = await this.makeProxy(game.gameId, dest, sha);
    await this.games.saveMedia(game.gameId, [...(await this.games.media(game.gameId)), asset]);
    await this.store.audit({ actor: "intake", action: "game.asset.import", subject: `${game.gameId}/${asset.assetId}`, detail: { kind: asset.kind, bytes: st.size } });
    return { result: "imported", asset, reason: notes.length ? notes.join("; ") : null };
  }

  /** One-time normalised proxy: CFR 30fps, 8-bit yuv420p SDR, rotation applied, AAC 48k. */
  async makeProxy(gameId: string, src: string, sha: string): Promise<string> {
    const rel = path.posix.join("games", gameId, "media", "proxy", `${sha}.mp4`);
    const out = this.store.p(rel);
    if (await fs.stat(out).catch(() => null)) return rel;
    await fs.mkdir(path.dirname(out), { recursive: true });
    const tmp = `${out}.partial.mp4`;
    const p = await probeMedia(src);
    await ffmpeg(
      [
        "-i", src,
        "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        ...(p.hasAudio ? ["-c:a", "aac", "-ar", "48000", "-ac", "2"] : ["-an"]),
        "-movflags", "+faststart", tmp,
      ],
      { timeoutMs: 60 * 60_000 },
    );
    await fs.rename(tmp, out);
    return rel;
  }

  private async writeManifest(m: z.input<typeof ImportManifest>) {
    const v = ImportManifest.parse(m);
    await writeJsonAtomic(this.games.dir(v.gameId, "uploads", v.uploadId, "import-manifest.json"), v);
    return v;
  }

  async importFiles(gameId: string, files: { path: string; originalName?: string; opts?: ImportOptions }[], source: ImportManifest["source"] = "files") {
    const uploadId = newId("upl_");
    const items: ImportManifest["items"] = [];
    const results: ImportResult[] = [];
    for (const f of files) {
      const r = await this.importFile(gameId, f.path, { ...f.opts, originalName: f.originalName ?? f.opts?.originalName, uploadId });
      results.push(r);
      items.push({ originalName: f.originalName ?? path.basename(f.path), result: r.result, assetId: r.asset?.assetId ?? null, reason: r.reason });
    }
    const manifest = await this.writeManifest({ uploadId, gameId, source, at: nowIso(), items });
    return { manifest, results };
  }

  /** Directory scan restricted to allowlisted roots (no arbitrary filesystem reads). */
  async importFolder(gameId: string, folder: string, opts: { allowedRoots: string[]; defaults?: ImportOptions; maxFiles?: number }) {
    const abs = path.resolve(folder);
    const real = await fs.realpath(abs).catch(() => abs);
    const allowed = opts.allowedRoots.map((r) => path.resolve(r)).some((r) => real === r || real.startsWith(r + path.sep));
    if (!allowed) throw new FactoryError("PATH_NOT_ALLOWED", "BLOCKED", `Thư mục ${folder} không nằm trong danh sách thư mục được phép nhập`);
    const files: { path: string; originalName: string; opts?: ImportOptions }[] = [];
    const walk = async (dir: string, rel: string) => {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (IGNORED_PATH.test(r) || e.isSymbolicLink()) continue;
        if (e.isDirectory()) await walk(path.join(dir, e.name), r);
        else if (e.isFile() && EXT_KIND[path.extname(e.name).toLowerCase()] && !/\.(json|csv|md|txt)$/i.test(e.name)) files.push({ path: path.join(dir, e.name), originalName: r, opts: { ...opts.defaults, kind: opts.defaults?.kind ?? inferKind(r) } });
        if (files.length >= (opts.maxFiles ?? 2000)) return;
      }
    };
    await walk(real, "");
    return this.importFiles(gameId, files, "folder");
  }

  /**
   * ZIP import with zip-slip / symlink / zip-bomb protection. Entries are extracted to a private
   * temp dir under a sanitised name, then imported like single files.
   */
  async importZip(gameId: string, zipFile: string, opts: { defaults?: ImportOptions; maxEntries?: number; maxTotalBytes?: number; maxRatio?: number } = {}) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ttm-zip-"));
    const rejected: ImportManifest["items"] = [];
    const extracted: { path: string; originalName: string; opts?: ImportOptions }[] = [];
    try {
      const zip = await new Promise<yauzl.ZipFile>((res, rej) => yauzl.open(zipFile, { lazyEntries: true, decodeStrings: false, validateEntrySizes: true }, (e, z) => (e || !z ? rej(e ?? new Error("zip")) : res(z))));
      let total = 0;
      let count = 0;
      await new Promise<void>((resolve, reject) => {
        zip.on("error", reject);
        zip.on("end", resolve);
        zip.on("entry", (entry: yauzl.Entry) => {
          // decodeStrings:false => we validate names ourselves (and record why) instead of aborting the whole zip
          const name = Buffer.isBuffer(entry.fileName) ? (entry.fileName as unknown as Buffer).toString("utf8") : String(entry.fileName);
          count++;
          const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
          const bad =
            path.isAbsolute(name) || /^[A-Za-z]:/.test(name) || name.split(/[\\/]/).includes("..") ? "zip-slip: đường dẫn vượt thư mục" :
            mode === 0o120000 ? "symlink trong zip bị chặn" :
            IGNORED_PATH.test(name) ? "file bị chặn (secret/mã thực thi)" :
            count > (opts.maxEntries ?? 500) ? "quá nhiều file trong zip" :
            entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > (opts.maxRatio ?? 200) ? "tỉ lệ nén bất thường (zip bomb)" :
            total + entry.uncompressedSize > (opts.maxTotalBytes ?? 8 * 1024 ** 3) ? "tổng dung lượng giải nén vượt giới hạn" : null;
          if (/\/$/.test(name)) return zip.readEntry();
          if (bad) {
            rejected.push({ originalName: name, result: "rejected", assetId: null, reason: bad });
            return zip.readEntry();
          }
          if (!EXT_KIND[path.extname(name).toLowerCase()]) {
            rejected.push({ originalName: name, result: "skipped", assetId: null, reason: "định dạng không hỗ trợ" });
            return zip.readEntry();
          }
          total += entry.uncompressedSize;
          const out = path.join(tmp, `${extracted.length}-${path.basename(name).replace(/[^\p{L}\p{N}._-]/gu, "_")}`);
          zip.openReadStream(entry, (err, rs) => {
            if (err || !rs) {
              rejected.push({ originalName: name, result: "rejected", assetId: null, reason: `không giải nén được: ${err?.message}` });
              return zip.readEntry();
            }
            fs.open(out, "w").then(async (h) => {
              const ws = h.createWriteStream();
              rs.pipe(ws);
              ws.on("finish", () => {
                extracted.push({ path: out, originalName: name, opts: { ...opts.defaults, kind: opts.defaults?.kind ?? inferKind(name) } });
                zip.readEntry();
              });
              rs.on("error", (e2) => {
                rejected.push({ originalName: name, result: "rejected", assetId: null, reason: `zip hỏng: ${e2.message}` });
                zip.readEntry();
              });
            }, reject);
          });
        });
        zip.readEntry();
      });
      const res = await this.importFiles(gameId, extracted, "zip");
      res.manifest.items.push(...rejected);
      await this.writeManifest(res.manifest);
      return res;
    } catch (e: any) {
      if (e instanceof FactoryError) throw e;
      throw new FactoryError("ZIP_INVALID", "PERMANENT", `File ZIP hỏng hoặc không hợp lệ: ${e.message}`);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }

  /**
   * JSON manifest import: `{assets:[{file,kind,buildId,annotation,flags,segments,rights}]}`, paths
   * relative to the manifest folder (safeJoin). Also accepts the legacy V3 game-manifest.json.
   */
  async importJsonManifest(gameId: string, manifestFile: string) {
    const base = path.dirname(path.resolve(manifestFile));
    const raw = JSON.parse(await fs.readFile(manifestFile, "utf8"));
    const LegacyKind: Record<string, AssetKindT> = { gameplay_capture: "gameplay", screenshot: "screenshot", render: "render", concept_art: "key_art", logo: "logo", ai_concept: "ai_concept" };
    const entries = (raw.assets ?? []) as any[];
    const files = entries.map((a) => {
      const rel = String(a.file);
      if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) throw new FactoryError("PATH_NOT_ALLOWED", "BLOCKED", `manifest trỏ ra ngoài thư mục: ${rel}`);
      const kind = (AssetKind.safeParse(a.kind).success ? a.kind : LegacyKind[a.kind]) ?? inferKind(rel);
      return { path: path.join(base, rel), originalName: rel, opts: { kind, buildId: a.buildId ?? null, annotation: a.annotation ?? "", flags: { ...(a.flags ?? {}), publishAllowed: a.publishAllowed ?? a.flags?.publishAllowed ?? true }, rights: a.rights } as ImportOptions, segments: a.segments };
    });
    const res = await this.importFiles(gameId, files, "json_manifest");
    for (const [i, r] of res.results.entries()) {
      const seg = (files[i] as any).segments;
      if (r.asset && Array.isArray(seg) && seg.length) await this.games.patchAsset(gameId, r.asset.assetId, (a) => ({ ...a, segments: seg }), "intake");
    }
    return res;
  }
}

/** Proxy needed for anything that is not already clean CFR 30/60fps 8-bit SDR H.264 upright. */
export function needsProxy(v: NonNullable<GameAsset["video"]>): boolean {
  const fpsOk = [30, 60].some((f) => Math.abs(v.fps - f) < 0.05) || Math.abs(v.fps - 29.97) < 0.02;
  return v.vfr || v.hdr || (v.bitDepth ?? 8) > 8 || !fpsOk || v.rotation !== 0 || v.videoCodec !== "h264";
}

/** CSV shot list: `asset,in,out,annotation,caption` (asset = assetId or original file name). */
export function parseShotList(csv: string, assets: GameAsset[]): { clips: z.infer<typeof ClipRef>[]; errors: string[] } {
  const clips: z.infer<typeof ClipRef>[] = [];
  const errors: string[] = [];
  const rows = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const cells = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };
  const start = /^asset\s*,/i.test(rows[0] ?? "") ? 1 : 0;
  for (const [i, line] of rows.slice(start).entries()) {
    const [ref, a, b, annotation = "", caption = ""] = cells(line);
    const asset = assets.find((x) => x.assetId === ref || x.originalName === ref || path.basename(x.originalName) === ref);
    const tin = Number(a);
    const tout = Number(b);
    if (!asset) errors.push(`dòng ${i + 1 + start}: không tìm thấy asset "${ref}"`);
    else if (!asset.video) errors.push(`dòng ${i + 1 + start}: "${ref}" không phải video`);
    else if (!(tin >= 0) || !(tout > tin) || tout > asset.video.durationSec + 0.05) errors.push(`dòng ${i + 1 + start}: in/out không hợp lệ (${a}–${b}, video dài ${asset.video.durationSec.toFixed(2)}s)`);
    else clips.push({ assetId: asset.assetId, in: tin, out: tout, annotation, caption, featureIds: [] });
  }
  return { clips, errors };
}

/** Group clips by build id then capture date (manual override always possible in the UI). */
export function groupByBuild(assets: GameAsset[]): Record<string, GameAsset[]> {
  const out: Record<string, GameAsset[]> = {};
  for (const a of assets.filter((x) => x.kind === "gameplay")) (out[a.buildId ?? "chưa-gán-build"] ??= []).push(a);
  for (const k of Object.keys(out)) out[k].sort((a, b) => (a.capturedAt ?? a.importedAt).localeCompare(b.capturedAt ?? b.importedAt));
  return out;
}
