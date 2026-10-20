import * as fs from "node:fs/promises";
import { nowIso, type MediaRights } from "@ttm/core";
import type { FileQueue } from "@ttm/automation";
import { DataStore, appendJsonl, readJson, readJsonl, writeJsonAtomic } from "@ttm/storage";
import { z } from "zod";

export const ProvenanceEvent = z.object({
  at: z.string(),
  type: z.enum(["source", "rights_proof", "asset", "transformation", "scene", "publish", "revoke", "expire", "audit"]),
  assetKey: z.string(),
  projectId: z.string().nullable().default(null),
  detail: z.record(z.unknown()).default({}),
  /** de-dup key so re-syncing a project never duplicates history */
  key: z.string(),
});
export type ProvenanceEvent = z.infer<typeof ProvenanceEvent>;

export const RightsRecord = z.object({
  assetKey: z.string(),
  assetIds: z.array(z.string()),
  owner: z.string().nullable(),
  ownershipType: z.string(),
  licenseId: z.string().nullable(),
  licenseEvidencePath: z.string().nullable(),
  commercialUse: z.boolean().nullable(),
  derivativeAllowed: z.boolean().nullable(),
  redistributionAllowed: z.boolean().nullable(),
  platforms: z.array(z.string()).nullable(),
  attribution: z.string().nullable(),
  geography: z.array(z.string()).nullable().default(null),
  expiresAt: z.string().nullable(),
  status: z.enum(["ACTIVE", "REVOKED", "EXPIRED", "REVIEW"]),
  statusReason: z.string().nullable().default(null),
  updatedAt: z.string(),
});
export type RightsRecord = z.infer<typeof RightsRecord>;

export type RevocationResult = { assetKey: string; projects: string[]; cancelledJobs: string[]; publishedNeedingReview: { projectId: string; platform: string; url: string | null }[] };

const keyOf = (projectId: string, a: MediaRights) => a.hash ?? `${projectId}/${a.assetId}`;

/**
 * SourceLicenseRegistry (spec V3): source -> rights proof -> asset -> transformation -> scene ->
 * publish, as an append-only chain. Revocation/expiry immediately makes every dependent manifest
 * non-publishable, cancels queued posts, and flags already-public posts for correction/takedown
 * review (only where the platform API allows — never done silently).
 */
export class SourceLicenseRegistry {
  constructor(private readonly store: DataStore, private readonly queue?: FileQueue) {}

  private recFile(k: string) {
    return this.store.p("registry", "rights", `${k.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120)}.json`);
  }
  private chainFile() {
    return this.store.p("registry", "provenance.jsonl");
  }

  async events(assetKey?: string): Promise<ProvenanceEvent[]> {
    const { records } = await readJsonl<ProvenanceEvent>(this.chainFile());
    return assetKey ? records.filter((e) => e.assetKey === assetKey) : records;
  }

  private async emit(e: Omit<ProvenanceEvent, "at">, seen: Set<string>) {
    if (seen.has(e.key)) return;
    seen.add(e.key);
    await appendJsonl(this.chainFile(), ProvenanceEvent.parse({ ...e, at: nowIso() }));
  }

  async get(assetKey: string): Promise<RightsRecord | null> {
    return readJson(this.recFile(assetKey), RightsRecord);
  }

  async list(): Promise<RightsRecord[]> {
    const out: RightsRecord[] = [];
    for (const n of await fs.readdir(this.store.p("registry", "rights")).catch(() => [] as string[])) {
      if (!n.endsWith(".json")) continue;
      const r = await readJson(this.store.p("registry", "rights", n), RightsRecord).catch(() => null);
      if (r) out.push(r);
    }
    return out;
  }

  /** Idempotent: records rights + the full provenance chain for one project. */
  async syncProject(projectId: string): Promise<number> {
    const m = await this.store.getRights(projectId);
    if (!m) return 0;
    const seen = new Set((await this.events()).map((e) => e.key));
    const before = seen.size;
    const prov = await readJson(this.store.p("projects", projectId, "provenance.json"), z.record(z.unknown())).catch(() => null);
    const project = await this.store.getProject(projectId);
    const sbs = project ? (await Promise.all(project.formats.map((f) => this.store.getStoryboard(projectId, f, project.revision)))).filter(Boolean) : [];
    const pubs = await this.store.getPublications(projectId);
    for (const a of [...m.assets, ...m.music]) {
      const k = keyOf(projectId, a);
      const prev = await this.get(k);
      const status: RightsRecord["status"] = prev?.status === "REVOKED" || prev?.status === "EXPIRED" ? prev.status : a.status === "VERIFIED" ? "ACTIVE" : a.status === "REVOKED" ? "REVOKED" : a.status === "EXPIRED" ? "EXPIRED" : "REVIEW";
      await writeJsonAtomic(this.recFile(k), RightsRecord.parse({ assetKey: k, assetIds: [...new Set([...(prev?.assetIds ?? []), a.assetId])], owner: a.author, ownershipType: a.ownershipType, licenseId: a.licenseId, licenseEvidencePath: a.licenseEvidencePath, commercialUse: a.commercialUse, derivativeAllowed: a.adaptationAllowed, redistributionAllowed: a.redistributionAllowed, platforms: a.platformScope, attribution: a.attribution, geography: prev?.geography ?? null, expiresAt: a.expiresAt, status, statusReason: prev?.statusReason ?? null, updatedAt: nowIso() }));
      await this.emit({ type: "source", assetKey: k, projectId, detail: { originUrl: a.originUrl, acquiredHow: a.acquiredHow, inspiredBy: (prov as any)?.inspiredBy ?? null }, key: `source:${k}` }, seen);
      await this.emit({ type: "rights_proof", assetKey: k, projectId, detail: { licenseId: a.licenseId, evidence: a.licenseEvidencePath, ownership: a.ownershipType }, key: `proof:${k}:${a.licenseId}` }, seen);
      await this.emit({ type: "asset", assetKey: k, projectId, detail: { assetId: a.assetId, hash: a.hash }, key: `asset:${k}:${projectId}:${a.assetId}` }, seen);
      for (const sb of sbs)
        for (const s of sb!.scenes.filter((x) => x.assetId === a.assetId)) {
          await this.emit({ type: "transformation", assetKey: k, projectId, detail: { format: sb!.format, template: sb!.template }, key: `tr:${k}:${projectId}:${sb!.format}:r${sb!.revision}` }, seen);
          await this.emit({ type: "scene", assetKey: k, projectId, detail: { sceneId: s.id, format: sb!.format }, key: `scene:${k}:${projectId}:${sb!.format}:${s.id}` }, seen);
        }
      for (const p of pubs.filter((x) => x.state === "PUBLISHED")) await this.emit({ type: "publish", assetKey: k, projectId, detail: { platform: p.platform, url: p.url, remoteId: p.remoteId }, key: `pub:${k}:${p.idempotencyKey}` }, seen);
    }
    return seen.size - before;
  }

  async dependents(assetKey: string): Promise<string[]> {
    const out: string[] = [];
    for (const p of await this.store.listProjects()) {
      const m = await this.store.getRights(p.id);
      if (m && [...m.assets, ...m.music].some((a) => keyOf(p.id, a) === assetKey || a.assetId === assetKey)) out.push(p.id);
    }
    return out;
  }

  async revoke(assetKey: string, reason: string, actor: string, kind: "REVOKED" | "EXPIRED" = "REVOKED"): Promise<RevocationResult> {
    const rec = await this.get(assetKey);
    if (rec) await writeJsonAtomic(this.recFile(assetKey), { ...rec, status: kind, statusReason: reason, updatedAt: nowIso() });
    const res: RevocationResult = { assetKey, projects: await this.dependents(assetKey), cancelledJobs: [], publishedNeedingReview: [] };
    for (const pid of res.projects) {
      const m = (await this.store.getRights(pid))!;
      const mark = (a: MediaRights) => (keyOf(pid, a) === assetKey || a.assetId === assetKey ? { ...a, status: kind, notes: `${a.notes} [${kind} ${nowIso()}: ${reason}]`.trim() } : a);
      await this.store.saveRights({ ...m, assets: m.assets.map(mark), music: m.music.map(mark) });
      if (this.queue)
        for (const st of ["queued", "needs_review", "manual_action"] as const)
          for (const j of await this.queue.list(st))
            if (j.kind === "PUBLISH" && j.payload.projectId === pid) {
              await this.queue.transition(j.id, "failed", `rights ${kind}: ${reason}`.slice(0, 200));
              res.cancelledJobs.push(j.id);
            }
      for (const p of await this.store.getPublications(pid)) if (p.state === "PUBLISHED") res.publishedNeedingReview.push({ projectId: pid, platform: p.platform, url: p.url });
      const lf = this.store.p("projects", pid, "lifecycle.json");
      const cur = ((await readJson(lf, z.object({ flags: z.array(z.any()) }).passthrough())) ?? { flags: [] }) as { flags: unknown[] };
      cur.flags.push({ at: nowIso(), type: "RIGHTS_" + kind, assetKey, reason, action: res.publishedNeedingReview.some((x) => x.projectId === pid) ? "xem xét gỡ/sửa bài đã đăng (nếu nền tảng cho phép)" : "đã dừng đăng" });
      await writeJsonAtomic(lf, cur);
    }
    const seen = new Set<string>();
    await this.emit({ type: kind === "REVOKED" ? "revoke" : "expire", assetKey, projectId: null, detail: { reason, actor, ...res }, key: `${kind}:${assetKey}:${Date.now()}` }, seen);
    await this.store.audit({ actor, action: `rights.${kind.toLowerCase()}`, subject: assetKey, detail: { reason, projects: res.projects, cancelled: res.cancelledJobs.length } });
    return res;
  }

  /** Periodic audit (RIGHTS_AUDIT job): expired => EXPIRED + holds; expiring soon => alert list. */
  async audit(now = new Date(), warnDays = 14): Promise<{ expired: RevocationResult[]; expiringSoon: RightsRecord[] }> {
    const expired: RevocationResult[] = [];
    const expiringSoon: RightsRecord[] = [];
    for (const r of await this.list()) {
      if (r.status !== "ACTIVE" || !r.expiresAt) continue;
      const t = new Date(r.expiresAt).getTime();
      if (t <= now.getTime()) expired.push(await this.revoke(r.assetKey, `giấy phép hết hạn ${r.expiresAt}`, "rights-audit", "EXPIRED"));
      else if (t - now.getTime() < warnDays * 86400_000) expiringSoon.push(r);
    }
    return { expired, expiringSoon };
  }
}
