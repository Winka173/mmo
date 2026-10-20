import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DATA_VERSION } from "@ttm/core";
import { sha256File } from "./fsutil.js";
import { readDataVersion, runMigrations, type MigrationReport } from "./migrations.js";
import type { DataStore } from "./store.js";

/** Small, metadata-only folders. Renders/media are immutable + hashed and are excluded by default. */
const BACKUP_INCLUDE = ["config", "products", "sources", "topics", "projects", "jobs", "discovery", "game", "games", "registry", "learning", "experiments", "analytics", "state", "reports"];
const SKIP_EXT = new Set([".mp4", ".wav", ".mp3", ".png", ".jpg", ".jpeg", ".webm", ".mov", ".tmp", ".m4a", ".webp", ".zip"]);

export type BackupManifest = {
  createdAt: string;
  files: number;
  includeMedia: boolean;
  dataVersion: number;
  /** relative path -> sha256 (integrity check before restore) */
  checksums: Record<string, string>;
  secrets: "none" | "encrypted";
};

async function copyTree(src: string, dest: string, skipMedia: boolean, rel: string, sums: Record<string, string>): Promise<number> {
  let n = 0;
  const entries = await fs.readdir(src, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) n += await copyTree(s, d, skipMedia, r, sums);
    else if (e.isFile() && !(skipMedia && SKIP_EXT.has(path.extname(e.name).toLowerCase())) && !e.name.endsWith(".tmp")) {
      await fs.mkdir(path.dirname(d), { recursive: true });
      await fs.copyFile(s, d);
      sums[r.replace(/^\//, "")] = await sha256File(d);
      n++;
    }
  }
  return n;
}

function encryptWithPassphrase(data: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(data), c.final()]);
  return Buffer.from(JSON.stringify({ v: 1, kdf: "scrypt", salt: salt.toString("base64"), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: enc.toString("base64") }));
}

function decryptWithPassphrase(blob: Buffer, passphrase: string): Buffer {
  const j = JSON.parse(blob.toString("utf8"));
  const key = scryptSync(passphrase, Buffer.from(j.salt, "base64"), 32);
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(j.iv, "base64"));
  d.setAuthTag(Buffer.from(j.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(j.data, "base64")), d.final()]);
}

/**
 * Metadata backup with per-file SHA256 manifest. Secrets are only included when a passphrase is
 * given, and then only as one AES-256-GCM (scrypt KDF) encrypted bundle — never plaintext.
 */
export async function createBackup(
  store: DataStore,
  opts: { includeMedia?: boolean; label?: string; secretsPassphrase?: string } = {},
): Promise<{ dir: string; files: number }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = store.p("backups", `${stamp}${opts.label ? "-" + opts.label.replace(/[^A-Za-z0-9_-]/g, "") : ""}`);
  let files = 0;
  const checksums: Record<string, string> = {};
  for (const top of BACKUP_INCLUDE) files += await copyTree(store.p(top), path.join(dir, top), !opts.includeMedia, top, checksums);
  let secrets: BackupManifest["secrets"] = "none";
  if (opts.secretsPassphrase) {
    const bundle: Record<string, string> = {};
    for (const n of await fs.readdir(store.p("secrets")).catch(() => [] as string[])) bundle[n] = (await fs.readFile(store.p("secrets", n))).toString("base64");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "secrets.enc"), encryptWithPassphrase(Buffer.from(JSON.stringify(bundle)), opts.secretsPassphrase));
    secrets = "encrypted";
  }
  const manifest: BackupManifest = { createdAt: new Date().toISOString(), files, includeMedia: !!opts.includeMedia, dataVersion: await readDataVersion(store), checksums, secrets };
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "BACKUP.json"), JSON.stringify(manifest, null, 2));
  await store.audit({ actor: "system", action: "backup.create", subject: dir, detail: { files, secrets } });
  return { dir, files };
}

export async function listBackups(store: DataStore): Promise<string[]> {
  return (await fs.readdir(store.p("backups")).catch(() => [] as string[])).sort().reverse();
}

export async function readBackupManifest(store: DataStore, name: string): Promise<BackupManifest | null> {
  try {
    const m = JSON.parse(await fs.readFile(store.p("backups", name, "BACKUP.json"), "utf8"));
    return { checksums: {}, dataVersion: 1, secrets: "none", ...m };
  } catch {
    return null;
  }
}

export type RestorePlan = {
  backup: string;
  dataVersion: number;
  compatible: boolean;
  reason: string | null;
  integrity: { ok: number; corrupt: string[]; unchecked: number };
  willAdd: number;
  willOverwrite: number;
  unchanged: number;
  migration: MigrationReport | null;
};

/** Dry-run restore: integrity + compatibility + diff, without writing anything. */
export async function planRestore(store: DataStore, name: string): Promise<RestorePlan> {
  const m = await readBackupManifest(store, name);
  if (!m) throw new Error(`Bản sao lưu ${name} không có BACKUP.json hợp lệ`);
  const src = store.p("backups", name);
  const plan: RestorePlan = { backup: name, dataVersion: m.dataVersion, compatible: true, reason: null, integrity: { ok: 0, corrupt: [], unchecked: 0 }, willAdd: 0, willOverwrite: 0, unchanged: 0, migration: null };
  if (m.dataVersion > DATA_VERSION) {
    plan.compatible = false;
    plan.reason = `Bản sao lưu có dataVersion ${m.dataVersion} mới hơn ứng dụng (${DATA_VERSION}) — cập nhật ứng dụng trước khi khôi phục`;
  }
  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else if (e.isFile() && r !== "BACKUP.json" && r !== "secrets.enc") {
        const f = path.join(dir, e.name);
        const sum = await sha256File(f);
        if (m.checksums[r] === undefined) plan.integrity.unchecked++;
        else if (m.checksums[r] !== sum) plan.integrity.corrupt.push(r);
        else plan.integrity.ok++;
        const cur = await sha256File(store.p(r)).catch(() => null);
        if (cur === null) plan.willAdd++;
        else if (cur !== sum) plan.willOverwrite++;
        else plan.unchanged++;
      }
    }
  };
  await walk(src, "");
  if (plan.integrity.corrupt.length) {
    plan.compatible = false;
    plan.reason = `${plan.integrity.corrupt.length} file trong bản sao lưu sai checksum`;
  }
  return plan;
}

/**
 * Restore copies backup files over current data (current state is first backed up itself).
 * Refuses corrupt/newer backups; older backups are migrated forward after copy.
 */
export async function restoreBackup(
  store: DataStore,
  name: string,
  opts: { dryRun?: boolean; secretsPassphrase?: string } = {},
): Promise<{ restored: number; safetyBackup: string | null; plan: RestorePlan; migration: MigrationReport | null }> {
  const plan = await planRestore(store, name);
  if (opts.dryRun || !plan.compatible) {
    if (!plan.compatible && !opts.dryRun) throw new Error(`Không khôi phục: ${plan.reason}`);
    return { restored: 0, safetyBackup: null, plan, migration: null };
  }
  const src = store.p("backups", name);
  const safety = await createBackup(store, { label: "pre-restore" });
  let restored = 0;
  const ignored: Record<string, string> = {};
  for (const top of BACKUP_INCLUDE) restored += await copyTree(path.join(src, top), store.p(top), false, top, ignored);
  if (opts.secretsPassphrase && (await fs.stat(path.join(src, "secrets.enc")).catch(() => null))) {
    const bundle = JSON.parse(decryptWithPassphrase(await fs.readFile(path.join(src, "secrets.enc")), opts.secretsPassphrase).toString("utf8")) as Record<string, string>;
    for (const [n, b64] of Object.entries(bundle)) await fs.writeFile(store.p("secrets", n), Buffer.from(b64, "base64"), { mode: 0o600 });
  }
  // Restored config carries the backup's data version; migrate forward if older.
  const migration = plan.dataVersion < DATA_VERSION ? await runMigrations(store, { backup: async () => safety }) : null;
  await store.audit({ actor: "system", action: "backup.restore", subject: name, detail: { restored, migratedFrom: plan.dataVersion } });
  return { restored, safetyBackup: safety.dir, plan, migration };
}

export async function pruneBackups(store: DataStore, keep = 14): Promise<number> {
  const all = await listBackups(store);
  const drop = all.slice(keep);
  for (const d of drop) await fs.rm(store.p("backups", d), { recursive: true, force: true });
  return drop.length;
}
