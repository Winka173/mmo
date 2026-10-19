import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { DataStore } from "./store.js";

/** Small, metadata-only folders. Renders/media are immutable + hashed and are excluded by default. */
const BACKUP_INCLUDE = ["config", "products", "sources", "topics", "projects", "jobs", "discovery", "game", "state", "reports"];
const SKIP_EXT = new Set([".mp4", ".wav", ".mp3", ".png", ".jpg", ".jpeg", ".webm", ".mov", ".tmp"]);

async function copyTree(src: string, dest: string, skipMedia: boolean): Promise<number> {
  let n = 0;
  const entries = await fs.readdir(src, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) n += await copyTree(s, d, skipMedia);
    else if (e.isFile() && !(skipMedia && SKIP_EXT.has(path.extname(e.name).toLowerCase()))) {
      await fs.mkdir(path.dirname(d), { recursive: true });
      await fs.copyFile(s, d);
      n++;
    }
  }
  return n;
}

export async function createBackup(store: DataStore, opts: { includeMedia?: boolean; label?: string } = {}): Promise<{ dir: string; files: number }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = store.p("backups", `${stamp}${opts.label ? "-" + opts.label.replace(/[^A-Za-z0-9_-]/g, "") : ""}`);
  let files = 0;
  for (const top of BACKUP_INCLUDE) files += await copyTree(store.p(top), path.join(dir, top), !opts.includeMedia);
  await fs.writeFile(path.join(dir, "BACKUP.json"), JSON.stringify({ createdAt: new Date().toISOString(), files, includeMedia: !!opts.includeMedia }, null, 2));
  await store.audit({ actor: "system", action: "backup.create", subject: dir, detail: { files } });
  return { dir, files };
}

export async function listBackups(store: DataStore): Promise<string[]> {
  return (await fs.readdir(store.p("backups")).catch(() => [] as string[])).sort().reverse();
}

/** Restore copies backup files over current data (current state is first backed up itself). */
export async function restoreBackup(store: DataStore, name: string): Promise<{ restored: number; safetyBackup: string }> {
  const src = store.p("backups", name);
  const safety = await createBackup(store, { label: "pre-restore" });
  let restored = 0;
  for (const top of BACKUP_INCLUDE) restored += await copyTree(path.join(src, top), store.p(top), false);
  await store.audit({ actor: "system", action: "backup.restore", subject: name, detail: { restored } });
  return { restored, safetyBackup: safety.dir };
}

export async function pruneBackups(store: DataStore, keep = 14): Promise<number> {
  const all = await listBackups(store);
  const drop = all.slice(keep);
  for (const d of drop) await fs.rm(store.p("backups", d), { recursive: true, force: true });
  return drop.length;
}
