import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Claim, Job, Product, Project, QaReport, RightsManifest, Settings, Storyboard } from "@ttm/core";
import { z, type ZodTypeAny } from "zod";
import { readJsonl, sha256File } from "./fsutil.js";
import type { DataStore } from "./store.js";

export type VerifyIssue = { severity: "error" | "warn"; file: string; problem: string; fixed?: boolean };
export type VerifyReport = { scannedJson: number; scannedJsonl: number; mediaChecked: number; issues: VerifyIssue[]; ok: boolean };

const KNOWN: [RegExp, ZodTypeAny][] = [
  [/^config\/settings\.json$/, Settings],
  [/^projects\/[^/]+\/project\.json$/, Project],
  [/^projects\/[^/]+\/claims\.json$/, z.array(Claim)],
  [/^projects\/[^/]+\/rights-manifest\.json$/, RightsManifest],
  [/^projects\/[^/]+\/storyboard\.[^/]+\.json$/, Storyboard],
  [/^projects\/[^/]+\/qa-report\.[^/]+\.json$/, QaReport],
  [/^products\/[^/]+\/product\.json$/, Product],
  [/^jobs\/[a-z_]+\/[^/]+\.json$/, Job],
];

/** Extra schemas contributed by higher-level packages (games, registry…). */
const EXTRA: [RegExp, ZodTypeAny][] = [];
export function registerVerifySchema(pattern: RegExp, schema: ZodTypeAny): void {
  if (!EXTRA.some(([p]) => p.source === pattern.source)) EXTRA.push([pattern, schema]);
}

const SKIP_DIRS = new Set(["backups", "quarantine", "work", "node_modules", "cache"]);

/**
 * `factory verify`: validates every known JSON file against its schema, flags truncated JSONL
 * lines, orphan temp files, duplicate job files, and re-hashes content-addressed media listed in
 * `.../media/index.json`. With `fix`, only safe repairs are made (stale temp files removed).
 */
export async function verifyDataDir(store: DataStore, opts: { fix?: boolean; hashMedia?: boolean; now?: Date } = {}): Promise<VerifyReport> {
  const issues: VerifyIssue[] = [];
  let scannedJson = 0;
  let scannedJsonl = 0;
  let mediaChecked = 0;
  const jobSeen = new Map<string, string>();
  const now = (opts.now ?? new Date()).getTime();

  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(full, r);
        continue;
      }
      if (!e.isFile()) continue;
      if (e.name.endsWith(".tmp")) {
        const st = await fs.stat(full);
        const stale = now - st.mtimeMs > 10 * 60_000;
        let fixed = false;
        if (stale && opts.fix) {
          await fs.rm(full, { force: true });
          fixed = true;
        }
        issues.push({ severity: "warn", file: r, problem: stale ? "file tạm còn sót sau crash" : "file tạm đang được ghi", fixed });
        continue;
      }
      if (e.name.endsWith(".jsonl")) {
        scannedJsonl++;
        const { skipped } = await readJsonl(full);
        if (skipped) issues.push({ severity: "warn", file: r, problem: `${skipped} dòng JSONL hỏng (thường là dòng cuối bị cắt do crash) — đã bỏ qua khi đọc` });
        continue;
      }
      if (!e.name.endsWith(".json")) continue;
      scannedJson++;
      let value: unknown;
      try {
        value = JSON.parse((await fs.readFile(full, "utf8")).replace(/^﻿/, ""));
      } catch (err: any) {
        issues.push({ severity: "error", file: r, problem: `JSON hỏng: ${err.message} (đọc qua DataStore sẽ tự phục hồi từ .bak nếu có)` });
        continue;
      }
      const schema = [...KNOWN, ...EXTRA].find(([re]) => re.test(r))?.[1];
      if (schema) {
        const p = schema.safeParse(value);
        if (!p.success) issues.push({ severity: "error", file: r, problem: `sai schema: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}` });
      }
      const jm = /^jobs\/([a-z_]+)\/([^/]+)\.json$/.exec(r);
      if (jm) {
        const prev = jobSeen.get(jm[2]);
        if (prev) issues.push({ severity: "warn", file: r, problem: `job trùng ở ${prev} và ${jm[1]} (worker sẽ dọn khi recover)` });
        jobSeen.set(jm[2], jm[1]);
        if ((value as any)?.state && (value as any).state !== jm[1]) issues.push({ severity: "error", file: r, problem: `state=${(value as any).state} nhưng nằm trong thư mục ${jm[1]}` });
      }
      if (opts.hashMedia !== false && /\/media\/index\.json$/.test(r)) {
        for (const a of ((value as any)?.assets ?? []) as { path?: string; sha256?: string }[]) {
          if (!a.path || !a.sha256) continue;
          mediaChecked++;
          const sum = await sha256File(store.p(a.path)).catch(() => null);
          if (sum === null) issues.push({ severity: "error", file: a.path, problem: "media được tham chiếu nhưng không tồn tại" });
          else if (sum !== a.sha256) issues.push({ severity: "error", file: a.path, problem: "media sai SHA256 (bị sửa/hỏng sau khi nhập)" });
        }
      }
    }
  };
  await walk(store.root, "");
  return { scannedJson, scannedJsonl, mediaChecked, issues, ok: !issues.some((i) => i.severity === "error") };
}
