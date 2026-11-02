import { createCipheriv, createDecipheriv, randomBytes, scryptSync, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DATA_VERSION } from "@ttm/core";
import { sha256File, writeFileAtomic, safeJoin } from "./fsutil.js";
import { readDataVersion, runMigrations, type MigrationReport } from "./migrations.js";
import type { DataStore } from "./store.js";
import {z} from "zod";
import {withLock} from "./lock.js";

/** Small, metadata-only folders. Renders/media are immutable + hashed and are excluded by default. */
export const BACKUP_INCLUDE = ["config", "products", "sources", "topics", "projects", "jobs", "discovery", "game", "games", "registry", "learning", "experiments", "analytics", "state", "reports", "studio"];
export const SKIP_EXT = new Set([".mp4", ".wav", ".mp3", ".png", ".jpg", ".jpeg", ".webm", ".mov", ".tmp", ".m4a", ".webp", ".zip", ".flac", ".ogg", ".avi", ".gif", ".bmp", ".tiff", ".m4v", ".safetensors", ".onnx", ".pt", ".jit", ".bin"]);
const backupName=(name:string)=>{if(!/^[A-Za-z0-9_-]{1,180}$/.test(name))throw new Error("Invalid backup name");return name;};
const ManifestSchema=z.object({createdAt:z.string(),files:z.number().int().nonnegative(),includeMedia:z.boolean().default(false),dataVersion:z.number().int().positive().default(1),checksums:z.record(z.string().regex(/^[a-f0-9]{64}$/i)).default({}),secrets:z.enum(["none","encrypted"]).default("none")});

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
  // Never traverse directory junctions/symlinks, including a selected top-level folder.
  if((await fs.lstat(src).catch(()=>null))?.isSymbolicLink())throw new Error(`Backup refuses linked folder: ${rel}`);
  if((await fs.lstat(dest).catch(()=>null))?.isSymbolicLink())throw new Error(`Backup refuses linked destination: ${rel}`);
  const entries = await fs.readdir(src, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    const r = `${rel}/${e.name}`;
    if(e.isSymbolicLink())throw new Error(`Backup refuses linked entry: ${r}`);
    if (e.isDirectory()) n += await copyTree(s, d, skipMedia, r, sums);
    else if (e.isFile() && !(skipMedia && SKIP_EXT.has(path.extname(e.name.replace(/\.bak$/i,"")).toLowerCase())) && !e.name.endsWith(".tmp")) {
      if((await fs.lstat(d).catch(()=>null))?.isSymbolicLink())throw new Error(`Backup refuses linked destination file: ${r}`);
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
  if((await fs.lstat(store.p("backups")).catch(()=>null))?.isSymbolicLink())throw new Error("Backup directory must not be a link");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = store.p("backups", `${stamp}-${randomUUID().slice(0,8)}${opts.label ? "-" + opts.label.replace(/[^A-Za-z0-9_-]/g, "").slice(0,60) : ""}`);
  let files = 0;
  const checksums: Record<string, string> = {};
  for (const top of BACKUP_INCLUDE) files += await copyTree(store.p(top), path.join(dir, top), !opts.includeMedia, top, checksums);
  let secrets: BackupManifest["secrets"] = "none";
  if (opts.secretsPassphrase) {
    const bundle: Record<string, string> = {};
    for (const n of await fs.readdir(store.p("secrets")).catch(() => [] as string[])) bundle[n] = (await fs.readFile(store.p("secrets", n))).toString("base64");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "secrets.enc"), encryptWithPassphrase(Buffer.from(JSON.stringify(bundle)), opts.secretsPassphrase));
    checksums["secrets.enc"]=await sha256File(path.join(dir,"secrets.enc"));
    secrets = "encrypted";
  }
  const manifest: BackupManifest = { createdAt: new Date().toISOString(), files, includeMedia: !!opts.includeMedia, dataVersion: await readDataVersion(store), checksums, secrets };
  await fs.mkdir(dir, { recursive: true });
  await writeFileAtomic(path.join(dir,"BACKUP.json"),JSON.stringify(manifest,null,2),{keepBackup:false});
  await store.audit({ actor: "system", action: "backup.create", subject: dir, detail: { files, secrets } });
  return { dir, files };
}

export async function listBackups(store: DataStore): Promise<string[]> {
  const names=await fs.readdir(store.p("backups")).catch(() => [] as string[]);
  const complete=await Promise.all(names.filter(n=>/^[A-Za-z0-9_-]{1,180}$/.test(n)).map(async name=>await readBackupManifest(store,name)?name:null));
  return complete.filter((n):n is string=>n!==null).sort().reverse();
}

export async function readBackupManifest(store: DataStore, name: string): Promise<BackupManifest | null> {
  backupName(name);
  try {
    if((await fs.lstat(store.p("backups",name))).isSymbolicLink())throw new Error("Linked backup directory");
    const m = JSON.parse(await fs.readFile(store.p("backups", name, "BACKUP.json"), "utf8"));
    return ManifestSchema.parse(m);
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
  const seen=new Set<string>();
  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if(e.isSymbolicLink()){plan.integrity.corrupt.push(r);continue;}
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else if (e.isFile() && r !== "BACKUP.json" && r !== "secrets.enc") {
        seen.add(r);
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
  for(const [r,expected] of Object.entries(m.checksums)){
    safeJoin(src,r); // Reject traversal in a supplied manifest before any restore writes.
    if(r==="secrets.enc"){
      seen.add(r);if(await sha256File(path.join(src,r)).catch(()=>null)!==expected)plan.integrity.corrupt.push(r);else plan.integrity.ok++;
    }else if(!seen.has(r))plan.integrity.corrupt.push(r);
  }
  if(Object.keys(m.checksums).length&&plan.integrity.unchecked){plan.compatible=false;plan.reason="Backup contains files absent from its checksum manifest";}
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
async function restoreBackupUnlocked(
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
  // Authenticate/decode the entire secret bundle before changing current metadata.
  let secretBundle:Record<string,string>|null=null;
  if(opts.secretsPassphrase&&(await fs.stat(path.join(src,"secrets.enc")).catch(()=>null))){
    const value=JSON.parse(decryptWithPassphrase(await fs.readFile(path.join(src,"secrets.enc")),opts.secretsPassphrase).toString("utf8"));
    if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid encrypted secret bundle");
    for(const [n,b64]of Object.entries(value)){if(!/^(?:[a-z0-9._-]{2,64}\.secret(?:\.bak)?|\.keyfile(?:\.bak)?)$/i.test(n)||typeof b64!=="string"||!/^[A-Za-z0-9+/]*={0,2}$/.test(b64))throw new Error("Invalid secret bundle entry");safeJoin(store.p("secrets"),n);}
    secretBundle=value;
  }
  const safety = await createBackup(store, { label: "pre-restore",secretsPassphrase:opts.secretsPassphrase });
  let restored = 0;
  const ignored: Record<string, string> = {};
  for (const top of BACKUP_INCLUDE) restored += await copyTree(path.join(src, top), store.p(top), false, top, ignored);
  if (secretBundle) {
    for (const [n, b64] of Object.entries(secretBundle)){await writeFileAtomic(store.p("secrets", n),Buffer.from(b64,"base64"),{keepBackup:false});await fs.chmod(store.p("secrets",n),0o600).catch(()=>{});}
  }
  // Restored config carries the backup's data version; migrate forward if older.
  const migration = plan.dataVersion < DATA_VERSION ? await runMigrations(store, { backup: async () => safety }) : null;
  if(await fs.stat(path.join(src,"studio")).catch(()=>null)){
    // A historical queue/policy must never resume public actions after recovery.
    await store.updateSettings(s=>({...s,paused:true,killSwitch:true,externalPostingEnabled:false}),"backup-restore");
    await writeFileAtomic(store.p("studio","posting-policy.json"),JSON.stringify({enabled:false,scope:"RESTORE_REQUIRES_NEW_AUTHORIZATION",at:new Date().toISOString()}),{keepBackup:false});
    const autopilots=store.p("studio","autopilots");
    for(const name of await fs.readdir(autopilots).catch(()=>[] as string[]))if(name.endsWith(".json")){
      const file=path.join(autopilots,name),row=JSON.parse(await fs.readFile(file,"utf8"));await writeFileAtomic(file,JSON.stringify({...row,enabled:false,revision:Math.max(1,Number(row.revision)||1)+1,updatedAt:new Date().toISOString()}),{keepBackup:false});
    }
  }
  await store.audit({ actor: "system", action: "backup.restore", subject: name, detail: { restored, migratedFrom: plan.dataVersion } });
  return { restored, safetyBackup: safety.dir, plan, migration };
}

/** In-place restore requires the worker to be stopped, not merely paused. */
export async function restoreBackup(store:DataStore,name:string,opts:{dryRun?:boolean;secretsPassphrase?:string}={}){
 if(opts.dryRun)return restoreBackupUnlocked(store,name,opts);
 return withLock(store.p("locks","worker.lock"),()=>restoreBackupUnlocked(store,name,opts),{waitMs:1000,purpose:"Offline backup restore; prevents worker startup"});
}

export async function pruneBackups(store: DataStore, keep = 14): Promise<number> {
  const all = await listBackups(store);
  const drop = all.slice(keep);
  for (const d of drop) await fs.rm(store.p("backups", d), { recursive: true, force: true });
  return drop.length;
}
