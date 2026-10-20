import { FileQueue } from "@ttm/automation";
import { nowIso, rightsGate } from "@ttm/core";
import { DataStore } from "@ttm/storage";
import { describe, expect, it } from "vitest";
import { SourceLicenseRegistry } from "../src/index.js";
import { tmpDir } from "../../storage/test/helpers.js";

async function setup() {
  const store = new DataStore(await tmpDir());
  await store.init();
  const t = nowIso();
  for (const id of ["proj-a", "proj-b"]) {
    await store.saveProject({ schemaVersion: 1, id, contentType: "FACT_SHORT", title: id, mode: "live", status: "READY_FOR_REVIEW", revision: 1, formats: ["short_9x16"], createdAt: t, updatedAt: t });
    await store.saveRights({ schemaVersion: 1, projectId: id, music: [], voice: null, assets: [{ assetId: "stock-clip", originUrl: "https://stock.example/clip/9", author: "Stock Co", ownershipType: "LICENSED_STOCK", licenseId: "STD-123", licenseEvidencePath: "licenses/std-123.pdf", commercialUse: true, adaptationAllowed: true, redistributionAllowed: true, platformScope: null, attribution: "Stock Co", expiresAt: id === "proj-b" ? "2026-10-10T00:00:00Z" : "2027-12-31T00:00:00Z", acquiredHow: "official_download", hash: id === "proj-b" ? "bbbb" : "aaaa", status: "VERIFIED", notes: "" }] });
    await store.saveStoryboard({ schemaVersion: 1, projectId: id, revision: 1, format: "short_9x16", template: "CuriosityFact", title: id, generatedBy: "human", scenes: [{ id: "sc-1", kind: "point", title: "x", narration: "x", bullets: [], assetId: "stock-clip", claimIds: [], minSeconds: 3, transition: "cut", sourceCaption: null, chapterTitle: null }] });
  }
  await store.savePublications("proj-a", [{ platform: "facebook", state: "PUBLISHED", idempotencyKey: "k-fb", remoteId: "1", url: "https://fb.example/1", confirmedAt: t, attempts: 1, lastError: null, isDemo: false, updatedAt: t }]);
  const queue = new FileQueue(store);
  const { job } = await queue.enqueue({ kind: "PUBLISH", idempotencyKey: "tutomo:proj-a:r1:youtube_shorts", payload: { projectId: "proj-a", platform: "youtube_shorts", format: "short_9x16" } });
  return { store, queue, job, reg: new SourceLicenseRegistry(store, queue) };
}

describe("SourceLicenseRegistry (V3)", () => {
  it("records an immutable source→proof→asset→transformation→scene→publish chain (idempotent)", async () => {
    const { reg } = await setup();
    expect(await reg.syncProject("proj-a")).toBe(6);
    expect(await reg.syncProject("proj-a")).toBe(0);
    expect((await reg.events("aaaa")).map((e) => e.type)).toEqual(["source", "rights_proof", "asset", "transformation", "scene", "publish"]);
  });

  it("licence revoked before auto-publish: queued post cancelled, manifest blocked, public post flagged for review", async () => {
    const { reg, store, queue, job } = await setup();
    await reg.syncProject("proj-a");
    const r = await reg.revoke("aaaa", "tác giả rút quyền ngày 2026-10-19", "owner");
    expect(r.projects).toEqual(["proj-a"]);
    expect(r.cancelledJobs).toEqual([job.id]);
    expect((await queue.get(job.id))?.state).toBe("failed");
    expect(r.publishedNeedingReview[0]).toMatchObject({ platform: "facebook" });
    const p = (await store.getProject("proj-a"))!;
    expect(rightsGate(p, (await store.getRights("proj-a"))!, new Date())).toMatchObject({ ok: false, hold: "HOLD_RIGHTS" });
    expect((await reg.get("aaaa"))?.status).toBe("REVOKED");
    expect((await reg.events("aaaa")).at(-1)?.type).toBe("revoke");
  });

  it("periodic audit expires licences and warns about ones expiring soon", async () => {
    const { reg } = await setup();
    await reg.syncProject("proj-a");
    await reg.syncProject("proj-b");
    const a = await reg.audit(new Date("2026-12-20T00:00:00Z"), 30);
    expect(a.expired.map((x) => x.assetKey)).toEqual(["bbbb"]);
    const b = await reg.audit(new Date("2027-12-15T00:00:00Z"), 30);
    expect(b.expiringSoon.map((x) => x.assetKey)).toEqual(["aaaa"]);
  });
});
