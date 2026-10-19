import { FactoryError } from "@ttm/core";
import { DataStore, writeJsonAtomic } from "@ttm/storage";
import { describe, expect, it } from "vitest";
import { FileQueue } from "../src/index.js";
import { tmpDir } from "../../storage/test/helpers.js";

async function setup() {
  const store = new DataStore(await tmpDir());
  await store.init();
  return { store, q: new FileQueue(store, { staleMs: 1000 }) };
}
const claimOpts = { maxConcurrent: 2, gpuSlots: 1 };

describe("FileQueue", () => {
  it("enqueue is idempotent by key (no duplicate jobs, e.g. duplicate schedule)", async () => {
    const { q } = await setup();
    const a = await q.enqueue({ kind: "PUBLISH", idempotencyKey: "tutomo:p1:r1:youtube_shorts", payload: {} });
    const b = await q.enqueue({ kind: "PUBLISH", idempotencyKey: "tutomo:p1:r1:youtube_shorts", payload: {} });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    expect((await q.counts()).queued).toBe(1);
  });

  it("claims by priority, completes, and enforces valid transitions", async () => {
    const { q } = await setup();
    await q.enqueue({ kind: "BACKUP", idempotencyKey: "k-low", payload: {}, priority: 9 });
    const hi = await q.enqueue({ kind: "DAILY_REPORT", idempotencyKey: "k-hi", payload: {}, priority: 1 });
    const j = await q.claim(claimOpts);
    expect(j?.id).toBe(hi.job.id);
    expect(j?.attempts).toBe(1);
    await q.complete(j!.id, { ok: true });
    await expect(q.transition(j!.id, "running", "bad")).rejects.toThrow(/không hợp lệ/);
  });

  it("retries RETRYABLE with backoff, bounded by maxAttempts (no infinite retries)", async () => {
    const { q } = await setup();
    await q.enqueue({ kind: "RENDER", idempotencyKey: "rk-1", payload: {}, maxAttempts: 2 });
    const j = await q.fail((await q.claim(claimOpts))!.id, new FactoryError("GPU_OOM", "RETRYABLE", "oom"), "RENDER");
    expect(j.state).toBe("queued");
    expect(new Date(j.notBefore!).getTime()).toBeGreaterThan(Date.now());
    expect(await q.claim(claimOpts)).toBeNull(); // still backing off
    await q.enqueue({ kind: "RENDER", idempotencyKey: "rk-2", payload: {}, maxAttempts: 1 });
    const k = await q.fail((await q.claim(claimOpts))!.id, new FactoryError("GPU_OOM", "RETRYABLE", "oom"), "RENDER");
    expect(k.state).toBe("failed");
  });

  it("routes BLOCKED to needs_review and HUMAN_REQUIRED to manual_action with structured error", async () => {
    const { q } = await setup();
    await q.enqueue({ kind: "PUBLISH", idempotencyKey: "key-a", payload: {} });
    await q.enqueue({ kind: "PUBLISH", idempotencyKey: "key-b", payload: {} });
    const a = await q.claim(claimOpts);
    const b = await q.claim(claimOpts);
    const ra = await q.fail(a!.id, new FactoryError("BLOCKED_RIGHTS", "BLOCKED", "no license"), "PUBLISHING");
    const rb = await q.fail(b!.id, new FactoryError("MANUAL_ACTION_REQUIRED", "HUMAN_REQUIRED", "tiktok"), "PUBLISHING");
    expect(ra.state).toBe("needs_review");
    expect(ra.lastError).toMatchObject({ errorCode: "BLOCKED_RIGHTS", stage: "PUBLISHING", userActionRequired: true });
    expect(rb.state).toBe("manual_action");
  });

  it("honours concurrency, GPU semaphore and dependencies", async () => {
    const { q } = await setup();
    const g1 = await q.enqueue({ kind: "RENDER", idempotencyKey: "gpu-1", payload: {}, usesGpu: true });
    await q.enqueue({ kind: "RENDER", idempotencyKey: "gpu-2", payload: {}, usesGpu: true });
    await q.enqueue({ kind: "PUBLISH", idempotencyKey: "dep", payload: {}, dependsOn: [g1.job.id] });
    const first = await q.claim(claimOpts);
    expect(first?.id).toBe(g1.job.id);
    expect(await q.claim(claimOpts)).toBeNull(); // g2 waits for GPU slot, dep waits for g1
    await q.complete(first!.id, {});
    const next = await q.claim({ maxConcurrent: 1, gpuSlots: 1 });
    expect(next).not.toBeNull();
  });

  it("recovers after a crash: duplicate files from a half-done move, and stale running jobs", async () => {
    const { store, q } = await setup();
    const { job } = await q.enqueue({ kind: "PUBLISH", idempotencyKey: "pub", payload: { projectId: "p" } });
    const running = await q.claim(claimOpts);
    // crash between "write destination" and "delete source": copy left in queued/
    await writeJsonAtomic(store.p("jobs", "queued", `${job.id}.json`), job);
    // and the owning worker died long ago
    await writeJsonAtomic(store.p("jobs", "running", `${job.id}.json`), { ...running, heartbeatAt: "2020-01-01T00:00:00.000Z", owner: { pid: 999999, host: "gone" } });
    const r = await q.recover();
    expect(r.deduped).toBe(1);
    expect(r.requeued).toBe(1);
    const after = await q.get(job.id);
    expect(after?.state).toBe("queued");
    expect(after?.payload.needsReconcile).toBe(true);
    expect((await q.counts()).running).toBe(0);
  });
});
