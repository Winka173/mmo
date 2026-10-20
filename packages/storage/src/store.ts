import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  Claim,
  DATA_VERSION,
  Product,
  Project,
  Publication as PublicationSchema,
  QaReport,
  RightsManifest,
  SCHEMA_VERSION,
  Settings,
  Storyboard,
  nowIso,
  type Publication,
} from "@ttm/core";
import { z } from "zod";
import { createBackup } from "./backup.js";
import { appendJsonl, exists, readJson, readJsonl, safeJoin, writeJsonAtomic } from "./fsutil.js";
import { runMigrations, type MigrationReport } from "./migrations.js";

export function defaultDataDir(): string {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "TuToMoFactory", "data");
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "TuToMoFactory", "data");
}

const LAYOUT_DIRS = [
  "config",
  "secrets",
  "products",
  "sources",
  "topics",
  "projects",
  "jobs/queued",
  "jobs/running",
  "jobs/succeeded",
  "jobs/failed",
  "jobs/needs_review",
  "jobs/manual_action",
  "reports/daily",
  "reports/weekly",
  "reports/monthly",
  "analytics",
  "audit",
  "costs",
  "index",
  "backups",
  "discovery/sources",
  "discovery/candidates",
  "discovery/checksums",
  "discovery/permissions",
  "discovery/review",
  "game/machine-brigade/builds",
  "game/machine-brigade/campaigns",
  "browser/profiles-metadata",
  "browser/sessions-health",
  "browser/run-reports",
  "quarantine",
  "locks",
  "telegram/outbox",
  "telegram/sent",
  "state",
  // V4
  "games",
  "registry",
  "analytics/snapshots",
  "learning",
  "experiments",
  "config/brand-kits",
  "comments",
];

const Publications = z.array(PublicationSchema);
const ClaimList = z.array(Claim);

export type AuditEvent = { at?: string; actor: string; action: string; subject: string; detail?: Record<string, unknown> };

/** File-only source of truth (spec G). Every write is atomic; every event appended to audit JSONL. */
export class DataStore {
  readonly root: string;
  constructor(root: string = defaultDataDir()) {
    this.root = path.resolve(root);
  }

  p(...rel: string[]): string {
    return safeJoin(this.root, ...rel);
  }

  /** Set by init() when an older data directory was migrated forward. */
  lastMigration: MigrationReport | null = null;

  async init(): Promise<void> {
    const fresh = !(await exists(this.p("config/schema-version.json")));
    for (const d of LAYOUT_DIRS) await fs.mkdir(this.p(d), { recursive: true });
    if (!(await exists(this.p("config/settings.json")))) {
      await writeJsonAtomic(this.p("config/settings.json"), Settings.parse({ schemaVersion: SCHEMA_VERSION }));
    }
    if (fresh) {
      await writeJsonAtomic(this.p("config/schema-version.json"), { schemaVersion: SCHEMA_VERSION, dataVersion: DATA_VERSION, createdAt: nowIso() });
    } else {
      // Additive, non-destructive migrations run automatically (backup first); newer data is refused.
      const r = await runMigrations(this, { backup: (label) => createBackup(this, { label }) });
      if (r.steps.length) this.lastMigration = r;
    }
  }

  private q() {
    return { quarantineDir: this.p("quarantine") };
  }

  // ------------------------------------------------------------- settings
  async getSettings(): Promise<Settings> {
    return (await readJson(this.p("config/settings.json"), Settings, this.q())) ?? Settings.parse({ schemaVersion: SCHEMA_VERSION });
  }
  async updateSettings(patch: (s: Settings) => Settings, actor: string): Promise<Settings> {
    const next = Settings.parse(patch(await this.getSettings()));
    await writeJsonAtomic(this.p("config/settings.json"), next);
    await this.audit({ actor, action: "settings.update", subject: "settings", detail: { killSwitch: next.killSwitch, paused: next.paused } });
    return next;
  }

  // ------------------------------------------------------------- projects
  async saveProject(p: z.input<typeof Project>): Promise<void> {
    await writeJsonAtomic(this.p("projects", p.id, "project.json"), Project.parse({ ...p, updatedAt: nowIso() }));
  }
  getProject(id: string) {
    return readJson(this.p("projects", id, "project.json"), Project, this.q());
  }
  async listProjects(): Promise<Project[]> {
    const ids = await fs.readdir(this.p("projects")).catch(() => [] as string[]);
    const out: Project[] = [];
    for (const id of ids) {
      try {
        const p = await this.getProject(id);
        if (p) out.push(p);
      } catch {
        /* corrupt project already quarantined; skipped from listing */
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async saveStoryboard(sb: Storyboard): Promise<string> {
    const file = this.p("projects", sb.projectId, `storyboard.${sb.format}.v${sb.revision}.json`);
    await writeJsonAtomic(file, Storyboard.parse(sb));
    return file;
  }
  getStoryboard(projectId: string, format: string, revision: number) {
    return readJson(this.p("projects", projectId, `storyboard.${format}.v${revision}.json`), Storyboard, this.q());
  }
  saveRights(m: RightsManifest) {
    return writeJsonAtomic(this.p("projects", m.projectId, "rights-manifest.json"), RightsManifest.parse(m));
  }
  getRights(projectId: string) {
    return readJson(this.p("projects", projectId, "rights-manifest.json"), RightsManifest, this.q());
  }
  saveClaims(projectId: string, claims: Claim[]) {
    return writeJsonAtomic(this.p("projects", projectId, "claims.json"), ClaimList.parse(claims));
  }
  async getClaims(projectId: string): Promise<Claim[]> {
    return (await readJson(this.p("projects", projectId, "claims.json"), ClaimList, this.q())) ?? [];
  }
  saveQa(r: QaReport) {
    return writeJsonAtomic(this.p("projects", r.projectId, `qa-report.${r.format}.json`), QaReport.parse(r));
  }
  getQa(projectId: string, format: string) {
    return readJson(this.p("projects", projectId, `qa-report.${format}.json`), QaReport, this.q());
  }
  async getPublications(projectId: string): Promise<Publication[]> {
    return ((await readJson(this.p("projects", projectId, "publications.json"), Publications, this.q())) ?? []) as Publication[];
  }
  savePublications(projectId: string, pubs: z.input<typeof PublicationSchema>[]) {
    return writeJsonAtomic(this.p("projects", projectId, "publications.json"), pubs.map((x) => PublicationSchema.parse(x)));
  }

  // ------------------------------------------------------------- products
  saveProduct(prod: Product) {
    return writeJsonAtomic(this.p("products", prod.id, "product.json"), Product.parse(prod));
  }
  getProduct(id: string) {
    return readJson(this.p("products", id, "product.json"), Product, this.q());
  }

  // ------------------------------------------------------------- append-only logs
  private day(d = new Date(), tz = "Asia/Ho_Chi_Minh") {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  }
  async audit(e: AuditEvent): Promise<void> {
    await appendJsonl(this.p("audit", `${this.day()}.jsonl`), { at: e.at ?? nowIso(), ...e });
  }
  async readAudit(day: string) {
    return readJsonl<AuditEvent & { at: string }>(this.p("audit", `${day}.jsonl`));
  }
  async recordCost(entry: {
    provider: string;
    usd: number;
    projectId?: string;
    note?: string;
    estimated: boolean;
    category?: string;
    units?: number;
    unit?: string;
    /** original currency + rate source/timestamp when billed in another currency */
    fx?: { currency: string; amount: number; rate: number; source: string; at: string } | null;
    ticketId?: string;
    kind?: "reservation" | "receipt";
  }): Promise<void> {
    const month = this.day().slice(0, 7);
    await appendJsonl(this.p("costs", `${month}.jsonl`), { at: nowIso(), ...entry });
  }
  async monthCostUsd(month = this.day().slice(0, 7)): Promise<number> {
    const { records } = await readJsonl<{ usd: number; estimated?: boolean; kind?: string }>(this.p("costs", `${month}.jsonl`));
    // estimate reservations are tracked separately by BudgetRouter; spend = receipts + legacy rows
    return records.filter((r) => r.kind !== "reservation").reduce((a, r) => a + (Number(r.usd) || 0), 0);
  }
  today(tz?: string) {
    return this.day(new Date(), tz);
  }

  // ------------------------------------------------------------- derived index (rebuildable)
  async rebuildIndex(): Promise<{ projects: number }> {
    const projects = await this.listProjects();
    await writeJsonAtomic(
      this.p("index", "projects.json"),
      projects.map((p) => ({ id: p.id, title: p.title, type: p.contentType, status: p.status, mode: p.mode, createdAt: p.createdAt })),
      { keepBackup: false },
    );
    const posts: unknown[] = [];
    for (const p of projects) for (const pub of await this.getPublications(p.id)) posts.push({ projectId: p.id, ...pub });
    await writeJsonAtomic(this.p("index", "posts.json"), posts, { keepBackup: false });
    return { projects: projects.length };
  }
}
