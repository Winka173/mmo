import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ZodTypeAny, z } from "zod";

/** Resolve `rel` under `root`, rejecting traversal, absolute paths, and Windows-reserved names. */
export function safeJoin(root: string, ...rel: string[]): string {
  const base = path.resolve(root);
  for (const r of rel) {
    if (path.isAbsolute(r) || /(^|[\\/])\.\.([\\/]|$)/.test(r)) throw new Error(`Đường dẫn không an toàn: ${r}`);
    for (const seg of r.split(/[\\/]/)) {
      if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(seg)) throw new Error(`Tên file bị Windows cấm: ${seg}`);
      if (/[<>:"|?*\x00-\x1f]/.test(seg)) throw new Error(`Tên file chứa ký tự không hợp lệ: ${seg}`);
    }
  }
  const full = path.resolve(base, ...rel);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error(`Đường dẫn vượt ra ngoài DATA_DIR: ${rel.join("/")}`);
  return full;
}

const RETRYABLE_FS = new Set(["EPERM", "EBUSY", "EACCES"]);

/** Windows antivirus/indexers briefly lock files; retry rename a few times. */
async function renameWithRetry(from: string, to: string, attempts = 6): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (e: any) {
      if (i >= attempts - 1 || !RETRYABLE_FS.has(e?.code)) throw e;
      await new Promise((r) => setTimeout(r, 50 * 2 ** i));
    }
  }
}

async function fsyncDir(dir: string): Promise<void> {
  if (process.platform === "win32") return; // directory fsync unsupported on Windows
  const h = await fs.open(dir, "r").catch(() => null);
  if (!h) return;
  try {
    await h.sync();
  } catch {
    /* some filesystems reject dir fsync */
  } finally {
    await h.close();
  }
}

/** temp file + fsync + rename; previous version kept as `<file>.bak` for corruption repair. */
export async function writeFileAtomic(file: string, data: string | Buffer, opts: { keepBackup?: boolean } = {}): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  const h = await fs.open(tmp, "wx");
  try {
    await h.writeFile(data);
    await h.sync();
  } finally {
    await h.close();
  }
  if (opts.keepBackup !== false) {
    await fs.copyFile(file, `${file}.bak`).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
  await renameWithRetry(tmp, file);
  await fsyncDir(dir);
}

export async function writeJsonAtomic(file: string, value: unknown, opts?: { keepBackup?: boolean }): Promise<void> {
  await writeFileAtomic(file, JSON.stringify(value, null, 2) + "\n", opts);
}

export class CorruptFileError extends Error {
  constructor(public readonly file: string, cause: string) {
    super(`File hỏng hoặc sai schema: ${file} (${cause})`);
  }
}

/**
 * Read + validate JSON. If the primary is corrupt, restore from `.bak` (validated) and move the
 * corrupt file to `quarantineDir`. Returns null when neither exists.
 */
export async function readJson<S extends ZodTypeAny, T = z.output<S>>(file: string, schema: S, opts: { quarantineDir?: string } = {}): Promise<T | null> {
  const attempt = async (f: string): Promise<{ ok: true; v: T } | { ok: false; missing: boolean; err: string }> => {
    let raw: string;
    try {
      raw = await fs.readFile(f, "utf8");
    } catch (e: any) {
      if (e.code === "ENOENT") return { ok: false, missing: true, err: "missing" };
      throw e;
    }
    try {
      const parsed = schema.safeParse(JSON.parse(raw.replace(/^﻿/, "")));
      return parsed.success ? { ok: true, v: parsed.data } : { ok: false, missing: false, err: parsed.error.issues[0]?.message ?? "schema" };
    } catch (e: any) {
      return { ok: false, missing: false, err: e.message };
    }
  };
  const primary = await attempt(file);
  if (primary.ok) return primary.v;
  const bak = await attempt(`${file}.bak`);
  if (primary.missing && !bak.ok) return null;
  if (bak.ok) {
    if (!primary.missing && opts.quarantineDir) await quarantine(file, opts.quarantineDir);
    await writeJsonAtomic(file, bak.v, { keepBackup: false });
    return bak.v;
  }
  if (opts.quarantineDir) await quarantine(file, opts.quarantineDir);
  throw new CorruptFileError(file, (primary as any).err);
}

export async function quarantine(file: string, quarantineDir: string): Promise<string> {
  await fs.mkdir(quarantineDir, { recursive: true });
  const dest = path.join(quarantineDir, `${Date.now()}-${path.basename(file)}`);
  await fs.copyFile(file, dest).catch(() => undefined);
  return dest;
}

export async function sha256File(file: string): Promise<string> {
  const h = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(file).on("data", (c) => h.update(c)).on("end", resolve).on("error", reject);
  });
  return h.digest("hex");
}

export const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

export async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(
    () => true,
    () => false,
  );
}

/** Append one JSON line. A crash can at worst leave a truncated last line, which readJsonl skips. */
export async function appendJsonl(file: string, record: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const h = await fs.open(file, "a");
  try {
    await h.write(JSON.stringify(record) + "\n");
    await h.sync();
  } finally {
    await h.close();
  }
}

export async function readJsonl<T = unknown>(file: string): Promise<{ records: T[]; skipped: number }> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (e: any) {
    if (e.code === "ENOENT") return { records: [], skipped: 0 };
    throw e;
  }
  const records: T[] = [];
  let skipped = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      skipped++;
    }
  }
  return { records, skipped };
}

export async function freeDiskGb(dir: string): Promise<number | null> {
  try {
    const s = await fs.statfs(dir);
    return (s.bavail * s.bsize) / 1024 ** 3;
  } catch {
    return null;
  }
}
