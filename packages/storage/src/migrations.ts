import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DATA_VERSION, nowIso } from "@ttm/core";
import { z } from "zod";
import { exists, readJson, writeJsonAtomic } from "./fsutil.js";
import type { DataStore } from "./store.js";

export const VersionFile = z.object({ schemaVersion: z.number().int().optional(), dataVersion: z.number().int().optional(), createdAt: z.string().optional(), migratedAt: z.string().optional() }).passthrough();

export type Migration = {
  from: number;
  to: number;
  describe: string;
  /** Returns human-readable change list. In dry-run nothing is written. */
  run(store: DataStore, dryRun: boolean): Promise<string[]>;
};

export async function readDataVersion(store: DataStore): Promise<number> {
  const v = await readJson(store.p("config", "schema-version.json"), VersionFile);
  return v?.dataVersion ?? v?.schemaVersion ?? DATA_VERSION;
}

async function listDirs(dir: string): Promise<string[]> {
  return (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory()).map((e) => e.name);
}

async function copyDir(src: string, dest: string): Promise<number> {
  let n = 0;
  for (const e of await fs.readdir(src, { withFileTypes: true }).catch(() => [])) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) n += await copyDir(s, d);
    else if (e.isFile() && !(await exists(d))) {
      await fs.mkdir(path.dirname(d), { recursive: true });
      await fs.copyFile(s, d);
      n++;
    }
  }
  return n;
}

/** Old single-game brand ids that map to a V4 gameId (aliases kept forever). */
export const LEGACY_GAME_ALIASES: Record<string, string> = { "machine-brigade": "machine-brigade", machinebrigade: "machine-brigade", mb: "machine-brigade" };

/**
 * v1 -> v2: generic multi-game layout. Non-destructive: old `game/<slug>/` folders are copied
 * (never moved) to `games/<slug>/legacy/`; projects whose brand was a game get `gameId`.
 */
export const MIGRATION_V1_V2: Migration = {
  from: 1,
  to: 2,
  describe: "V4: games/<gameId>/ generic layout, gameId on projects, registry/analytics/learning dirs",
  async run(store, dryRun) {
    const changes: string[] = [];
    for (const d of ["games", "registry", "analytics/snapshots", "learning", "experiments", "config/brand-kits"]) {
      if (!(await exists(store.p(d)))) {
        changes.push(`tạo thư mục ${d}/`);
        if (!dryRun) await fs.mkdir(store.p(d), { recursive: true });
      }
    }
    for (const slug of await listDirs(store.p("game"))) {
      const gameId = LEGACY_GAME_ALIASES[slug] ?? slug;
      if (!/^[a-z0-9-]{3,60}$/.test(gameId)) continue;
      changes.push(`sao chép game/${slug}/ → games/${gameId}/legacy/ (giữ nguyên bản gốc)`);
      if (!dryRun) await copyDir(store.p("game", slug), store.p("games", gameId, "legacy"));
    }
    for (const id of await listDirs(store.p("projects"))) {
      const pf = store.p("projects", id, "project.json");
      const raw = await fs.readFile(pf, "utf8").catch(() => null);
      if (!raw) continue;
      let p: any;
      try {
        p = JSON.parse(raw);
      } catch {
        continue; // corrupt files are handled by readJson/.bak repair, not by migrations
      }
      const gameId = LEGACY_GAME_ALIASES[p.brand];
      if (gameId && !p.gameId) {
        changes.push(`projects/${id}: gameId=${gameId}`);
        if (!dryRun) await writeJsonAtomic(pf, { ...p, gameId });
      }
    }
    return changes;
  },
};

export const CORE_MIGRATIONS: Migration[] = [MIGRATION_V1_V2];

export type MigrationReport = { from: number; to: number; dryRun: boolean; steps: { describe: string; changes: string[] }[]; backup: string | null };

/**
 * Applies migrations from the current data version up to `target`. A metadata backup is taken
 * before any write. Data newer than the code is refused (never silently downgraded).
 */
export async function runMigrations(
  store: DataStore,
  opts: { dryRun?: boolean; target?: number; migrations?: Migration[]; backup?: (label: string) => Promise<{ dir: string }> } = {},
): Promise<MigrationReport> {
  const target = opts.target ?? DATA_VERSION;
  const from = await readDataVersion(store);
  const dryRun = !!opts.dryRun;
  if (from > target) throw new Error(`Dữ liệu ở phiên bản ${from} mới hơn mã nguồn (${target}). Hãy cập nhật ứng dụng; không hạ cấp dữ liệu.`);
  const report: MigrationReport = { from, to: from, dryRun, steps: [], backup: null };
  if (from === target) return report;
  if (!dryRun && opts.backup) report.backup = (await opts.backup(`pre-migrate-v${from}`)).dir;
  let v = from;
  for (const m of (opts.migrations ?? CORE_MIGRATIONS).sort((a, b) => a.from - b.from)) {
    if (m.from !== v || m.to > target) continue;
    report.steps.push({ describe: m.describe, changes: await m.run(store, dryRun) });
    v = m.to;
  }
  if (v !== target) throw new Error(`Không có đường migration từ v${v} lên v${target}`);
  report.to = v;
  if (!dryRun) {
    const cur = (await readJson(store.p("config", "schema-version.json"), VersionFile)) ?? {};
    await writeJsonAtomic(store.p("config", "schema-version.json"), { ...cur, schemaVersion: 1, dataVersion: v, migratedAt: nowIso() });
    await store.audit({ actor: "system", action: "data.migrate", subject: `v${from}->v${v}`, detail: { steps: report.steps.map((s) => s.describe), backup: report.backup } });
  }
  return report;
}
