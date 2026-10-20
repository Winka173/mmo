import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { nowIso } from "@ttm/core";
import { DataStore, readJson, registerVerifySchema, writeJsonAtomic, LEGACY_GAME_ALIASES } from "@ttm/storage";
import { z } from "zod";
import {
  BuildManifest,
  CampaignBrief,
  CampaignKpis,
  GameAsset,
  GameProject,
  GameReview,
  GameVideoInput,
  MediaIndex,
  Roadmap,
  VerifiedFeatures,
  type GameVideoInput as GameVideoInputT,
} from "./schemas.js";

registerVerifySchema(/^games\/[^/]+\/game\.json$/, GameProject);
registerVerifySchema(/^games\/[^/]+\/verified-features\.json$/, VerifiedFeatures);
registerVerifySchema(/^games\/[^/]+\/media\/index\.json$/, MediaIndex);
registerVerifySchema(/^games\/[^/]+\/projects\/[^/]+\/input\.json$/, GameVideoInput);
registerVerifySchema(/^games\/[^/]+\/campaigns\/[^/]+\/brief\.json$/, CampaignBrief);

/**
 * File-only registry for unlimited games: data/games/<gameId>/… (spec Y4). A new game is onboarded
 * through UI/import with no code change; legacy brand ids resolve through aliases.
 */
export class GameRegistry {
  constructor(readonly store: DataStore) {}

  dir(gameId: string, ...rel: string[]) {
    return this.store.p("games", gameId, ...rel);
  }

  resolveId(idOrAlias: string): string {
    return LEGACY_GAME_ALIASES[idOrAlias] ?? idOrAlias;
  }

  async list(): Promise<GameProject[]> {
    const out: GameProject[] = [];
    for (const id of await fs.readdir(this.store.p("games")).catch(() => [] as string[])) {
      const g = await this.get(id).catch(() => null);
      if (g) out.push(g);
    }
    return out.sort((a, b) => a.publicTitle.localeCompare(b.publicTitle));
  }

  async get(gameId: string): Promise<GameProject | null> {
    return readJson(this.dir(this.resolveId(gameId), "game.json"), GameProject, { quarantineDir: this.store.p("quarantine") });
  }

  async mustGet(gameId: string): Promise<GameProject> {
    const g = await this.get(gameId);
    if (!g) throw new Error(`Không tìm thấy game ${gameId}`);
    return g;
  }

  /** Create (draft allowed with partial input) or update. gameId is immutable once created. */
  async save(input: Omit<z.input<typeof GameProject>, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }, actor: string): Promise<GameProject> {
    const prev = await this.get(input.gameId);
    const t = nowIso();
    const g = GameProject.parse({ ...input, createdAt: prev?.createdAt ?? input.createdAt ?? t, updatedAt: t });
    for (const d of ["media", "builds", "uploads", "campaigns", "projects", "analytics"]) await fs.mkdir(this.dir(g.gameId, d), { recursive: true });
    await writeJsonAtomic(this.dir(g.gameId, "game.json"), g);
    await this.store.audit({ actor, action: prev ? "game.update" : "game.create", subject: g.gameId, detail: { draft: g.draft } });
    return g;
  }

  // ------------------------------------------------------------ features / roadmap / builds
  async getFeatures(gameId: string) {
    return (await readJson(this.dir(gameId, "verified-features.json"), VerifiedFeatures)) ?? VerifiedFeatures.parse({});
  }
  async saveFeatures(gameId: string, v: z.input<typeof VerifiedFeatures>) {
    await writeJsonAtomic(this.dir(gameId, "verified-features.json"), VerifiedFeatures.parse({ ...v, updatedAt: nowIso() }));
  }
  async getRoadmap(gameId: string) {
    return (await readJson(this.dir(gameId, "roadmap.json"), Roadmap)) ?? Roadmap.parse({});
  }
  async saveRoadmap(gameId: string, v: z.input<typeof Roadmap>) {
    await writeJsonAtomic(this.dir(gameId, "roadmap.json"), Roadmap.parse(v));
  }
  async listBuilds(gameId: string): Promise<BuildManifest[]> {
    const out: BuildManifest[] = [];
    for (const b of await fs.readdir(this.dir(gameId, "builds")).catch(() => [] as string[])) {
      const m = await readJson(this.dir(gameId, "builds", b, "manifest.json"), BuildManifest).catch(() => null);
      if (m) out.push(m);
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.version.localeCompare(b.version, undefined, { numeric: true }));
  }
  async latestBuild(gameId: string): Promise<BuildManifest | null> {
    const all = await this.listBuilds(gameId);
    return all.find((b) => b.latest) ?? all.at(-1) ?? null;
  }
  async saveBuild(gameId: string, m: z.input<typeof BuildManifest>, changelog: string | null) {
    const b = BuildManifest.parse({ ...m, importedAt: m.importedAt ?? nowIso(), changelogFile: changelog ? "changelog.md" : null });
    const dir = this.dir(gameId, "builds", b.buildId);
    await fs.mkdir(dir, { recursive: true });
    if (changelog !== null) await fs.writeFile(`${dir}/changelog.md`, changelog, "utf8");
    if (b.latest) for (const o of await this.listBuilds(gameId)) if (o.buildId !== b.buildId && o.latest) await writeJsonAtomic(this.dir(gameId, "builds", o.buildId, "manifest.json"), { ...o, latest: false });
    await writeJsonAtomic(`${dir}/manifest.json`, b);
    const sums: Record<string, string> = {};
    if (changelog !== null) sums["changelog.md"] = createHash("sha256").update(changelog).digest("hex");
    await writeJsonAtomic(`${dir}/checksums.json`, sums, { keepBackup: false });
    return b;
  }
  async readChangelog(gameId: string, buildId: string): Promise<string | null> {
    return fs.readFile(this.dir(gameId, "builds", buildId, "changelog.md"), "utf8").catch(() => null);
  }

  // ------------------------------------------------------------ media index
  async media(gameId: string): Promise<GameAsset[]> {
    return (await readJson(this.dir(gameId, "media", "index.json"), MediaIndex))?.assets ?? [];
  }
  async asset(gameId: string, assetId: string): Promise<GameAsset | null> {
    return (await this.media(gameId)).find((a) => a.assetId === assetId) ?? null;
  }
  async saveMedia(gameId: string, assets: GameAsset[]) {
    await writeJsonAtomic(this.dir(gameId, "media", "index.json"), MediaIndex.parse({ assets }));
  }
  async patchAsset(gameId: string, assetId: string, patch: (a: GameAsset) => GameAsset, actor: string): Promise<GameAsset> {
    const all = await this.media(gameId);
    const i = all.findIndex((a) => a.assetId === assetId);
    if (i < 0) throw new Error(`Không có asset ${assetId} trong game ${gameId}`);
    const next = GameAsset.parse(patch(all[i]));
    // identity fields are immutable (content-addressed)
    if (next.sha256 !== all[i].sha256 || next.path !== all[i].path || next.gameId !== gameId) throw new Error("Không được đổi nội dung/đường dẫn asset đã nhập");
    all[i] = next;
    await this.saveMedia(gameId, all);
    await this.store.audit({ actor, action: "game.asset.update", subject: `${gameId}/${assetId}` });
    return next;
  }

  // ------------------------------------------------------------ campaigns
  async listCampaigns(gameId: string): Promise<CampaignBrief[]> {
    const out: CampaignBrief[] = [];
    for (const c of await fs.readdir(this.dir(gameId, "campaigns")).catch(() => [] as string[])) {
      const b = await readJson(this.dir(gameId, "campaigns", c, "brief.json"), CampaignBrief).catch(() => null);
      if (b) out.push(b);
    }
    return out;
  }
  async saveCampaign(b: Omit<z.input<typeof CampaignBrief>, "createdAt"> & { createdAt?: string }) {
    const c = CampaignBrief.parse({ ...b, createdAt: b.createdAt ?? nowIso() });
    await writeJsonAtomic(this.dir(c.gameId, "campaigns", c.campaignId, "brief.json"), c);
    const kpiFile = this.dir(c.gameId, "campaigns", c.campaignId, "kpis.json");
    if (!(await readJson(kpiFile, CampaignKpis)))
      await writeJsonAtomic(kpiFile, { campaignId: c.campaignId, metrics: [c.objective, "views", "store_clicks"].map((name) => ({ name, value: null, source: null, measuredAt: null, note: "chưa có tích hợp được cấp quyền — unknown" })) });
    return c;
  }
  async getKpis(gameId: string, campaignId: string) {
    return readJson(this.dir(gameId, "campaigns", campaignId, "kpis.json"), CampaignKpis);
  }

  // ------------------------------------------------------------ video projects (wizard)
  async listVideos(gameId: string): Promise<GameVideoInputT[]> {
    const out: GameVideoInputT[] = [];
    for (const p of await fs.readdir(this.dir(gameId, "projects")).catch(() => [] as string[])) {
      const v = await this.getVideo(gameId, p).catch(() => null);
      if (v) out.push(v);
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async getVideo(gameId: string, projectId: string) {
    return readJson(this.dir(gameId, "projects", projectId, "input.json"), GameVideoInput);
  }
  /** Saves draft; previous version kept as input.v<N>.json so "undo last edit" works. */
  async saveVideo(input: Omit<z.input<typeof GameVideoInput>, "updatedAt"> & { updatedAt?: string }, actor: string): Promise<GameVideoInputT> {
    const prev = await this.getVideo(input.gameId, input.projectId);
    const v = GameVideoInput.parse({ ...input, revision: prev ? prev.revision + 1 : 1, updatedAt: nowIso() });
    const dir = this.dir(v.gameId, "projects", v.projectId);
    if (prev) await writeJsonAtomic(`${dir}/history/input.v${prev.revision}.json`, prev, { keepBackup: false });
    await writeJsonAtomic(`${dir}/input.json`, v);
    await this.store.audit({ actor, action: "game.video.save", subject: `${v.gameId}/${v.projectId}`, detail: { revision: v.revision } });
    return v;
  }
  async undoVideo(gameId: string, projectId: string, actor: string): Promise<GameVideoInputT | null> {
    const cur = await this.getVideo(gameId, projectId);
    if (!cur || cur.revision <= 1) return null;
    const dir = this.dir(gameId, "projects", projectId);
    const prev = await readJson(`${dir}/history/input.v${cur.revision - 1}.json`, GameVideoInput);
    if (!prev) return null;
    return this.saveVideo({ ...prev }, `${actor} (undo)`);
  }
  async getReview(gameId: string, projectId: string): Promise<GameReview> {
    return (await readJson(this.dir(gameId, "projects", projectId, "review.json"), GameReview)) ?? GameReview.parse({ projectId });
  }
  async saveReview(gameId: string, r: GameReview) {
    await writeJsonAtomic(this.dir(gameId, "projects", r.projectId, "review.json"), GameReview.parse(r));
  }
  async writeProjectFile(gameId: string, projectId: string, name: "footage-map.json" | "render-plan.json" | "rights.json" | "storyboard.json" | "readiness.json", value: unknown) {
    await writeJsonAtomic(this.dir(gameId, "projects", projectId, name), value);
  }
  async readProjectFile<T>(gameId: string, projectId: string, name: string): Promise<T | null> {
    return readJson(this.dir(gameId, "projects", projectId, name), z.any()) as Promise<T | null>;
  }
}

/** Approval fingerprint: input + every referenced asset's hash. Thumbnail swap => new hash. */
export function approvalHash(input: GameVideoInputT, assets: GameAsset[]): string {
  const ids = new Set([...input.clips.map((c) => c.assetId), ...input.screenshots, input.logoAssetId, input.thumbnail.user16x9, input.thumbnail.user9x16, input.thumbnail.heroFrame?.assetId, input.musicAssetId].filter(Boolean) as string[]);
  const sums = assets.filter((a) => ids.has(a.assetId)).map((a) => `${a.assetId}:${a.sha256}`).sort();
  const { updatedAt: _u, revision: _r, status: _s, ...stable } = input;
  return createHash("sha256").update(JSON.stringify([stable, sums])).digest("hex");
}
