import * as fs from "node:fs/promises";
import * as os from "node:os";
import { FactoryError, JOB_TRANSITIONS, Job, JobState, backoffMs, newId, nowIso, type JobError, type JobKind } from "@ttm/core";
import { DataStore, readJson, withLock, writeJsonAtomic } from "@ttm/storage";
import { z } from "zod";

const STATES = JobState.options;
const IdemIndex = z.record(z.string());

export type EnqueueInput = {
  kind: JobKind;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  notBefore?: Date | null;
  dependsOn?: string[];
  usesGpu?: boolean;
  budgetUsd?: number;
};

/**
 * Single-machine durable queue: one JSON file per job, moved between state folders.
 * Mutations happen under one cross-process lock; each write is atomic (temp+fsync+rename).
 * Write order on a move is "write destination, then delete source", so a crash leaves at most a
 * duplicate which `recover()` resolves — never a lost job.
 */
export class FileQueue {
  constructor(
    private readonly store: DataStore,
    private readonly opts: { staleMs?: number; now?: () => Date } = {},
  ) {}

  private now() {
    return this.opts.now?.() ?? new Date();
  }
  private file(state: JobState, id: string) {
    return this.store.p("jobs", state, `${id}.json`);
  }
  private lock<T>(fn: () => Promise<T>) {
    return withLock(this.store.p("locks", "queue.lock"), fn, { waitMs: 30_000, ttlMs: 30_000, purpose: "queue" });
  }
  private idemFile() {
    return this.store.p("state", "idempotency.json");
  }

  async list(state: JobState): Promise<Job[]> {
    const names = await fs.readdir(this.store.p("jobs", state)).catch(() => [] as string[]);
    const jobs: Job[] = [];
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      try {
        const j = await readJson(this.store.p("jobs", state, n), Job, { quarantineDir: this.store.p("quarantine") });
        if (j) jobs.push(j);
      } catch {
        /* quarantined by readJson */
      }
    }
    return jobs;
  }

  async get(id: string): Promise<Job | null> {
    for (const s of STATES) {
      const j = await readJson(this.file(s, id), Job, { quarantineDir: this.store.p("quarantine") }).catch(() => null);
      if (j) return j;
    }
    return null;
  }

  async findByKey(key: string): Promise<Job | null> {
    const idx = (await readJson(this.idemFile(), IdemIndex)) ?? {};
    return idx[key] ? this.get(idx[key]) : null;
  }

  /** Returns the existing job when the idempotency key was already used (never duplicates). */
  async enqueue(input: EnqueueInput): Promise<{ job: Job; created: boolean }> {
    return this.lock(async () => {
      const idx = (await readJson(this.idemFile(), IdemIndex)) ?? {};
      const existingId = idx[input.idempotencyKey];
      if (existingId) {
        const existing = await this.get(existingId);
        if (existing) return { job: existing, created: false };
      }
      const t = nowIso(this.now());
      const job = Job.parse({
        schemaVersion: 1,
        id: newId("job_"),
        kind: input.kind,
        state: "queued",
        idempotencyKey: input.idempotencyKey,
        priority: input.priority ?? 5,
        payload: input.payload,
        maxAttempts: input.maxAttempts ?? 4,
        notBefore: input.notBefore ? input.notBefore.toISOString() : null,
        dependsOn: input.dependsOn ?? [],
        usesGpu: input.usesGpu ?? false,
        budgetUsd: input.budgetUsd ?? 0,
        history: [{ at: t, from: null, to: "queued", note: "enqueue" }],
        createdAt: t,
        updatedAt: t,
      });
      // Persist the key before the job so a crash can't produce a second job for the same key.
      idx[input.idempotencyKey] = job.id;
      await writeJsonAtomic(this.idemFile(), idx);
      await writeJsonAtomic(this.file("queued", job.id), job);
      await this.store.audit({ actor: "queue", action: "job.enqueue", subject: job.id, detail: { kind: job.kind, key: job.idempotencyKey } });
      return { job, created: true };
    });
  }

  private async moveUnlocked(job: Job, to: JobState, note: string, mutate: (j: Job) => Job = (j) => j): Promise<Job> {
    const from = job.state;
    if (from !== to && !JOB_TRANSITIONS[from].includes(to)) throw new Error(`Chuyển trạng thái job không hợp lệ: ${from} -> ${to}`);
    const t = nowIso(this.now());
    const next = Job.parse(mutate({ ...job, state: to, updatedAt: t, history: [...job.history, { at: t, from, to, note }] }));
    await writeJsonAtomic(this.file(to, job.id), next);
    if (from !== to) {
      await fs.rm(this.file(from, job.id), { force: true });
      await fs.rm(`${this.file(from, job.id)}.bak`, { force: true });
    }
    await this.store.audit({ actor: "queue", action: `job.${to}`, subject: job.id, detail: { from, note } });
    return next;
  }

  /** Claim the next runnable job honouring priority, notBefore, dependencies, concurrency and GPU semaphore. */
  async claim(opts: { maxConcurrent: number; gpuSlots: number; kinds?: JobKind[] }): Promise<Job | null> {
    return this.lock(async () => {
      const running = await this.list("running");
      if (running.length >= opts.maxConcurrent) return null;
      const gpuBusy = running.filter((j) => j.usesGpu).length;
      const succeeded = new Set((await this.list("succeeded")).map((j) => j.id));
      const now = this.now().getTime();
      const candidates = (await this.list("queued"))
        .filter((j) => !opts.kinds || opts.kinds.includes(j.kind))
        .filter((j) => !j.notBefore || new Date(j.notBefore).getTime() <= now)
        .filter((j) => j.dependsOn.every((d) => succeeded.has(d)))
        .filter((j) => !j.usesGpu || gpuBusy < opts.gpuSlots)
        .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
      const job = candidates[0];
      if (!job) return null;
      return this.moveUnlocked(job, "running", "claim", (j) => ({
        ...j,
        attempts: j.attempts + 1,
        heartbeatAt: nowIso(this.now()),
        owner: { pid: process.pid, host: os.hostname() },
      }));
    });
  }

  async heartbeat(id: string): Promise<void> {
    await this.lock(async () => {
      const j = await readJson(this.file("running", id), Job);
      if (j) await writeJsonAtomic(this.file("running", id), { ...j, heartbeatAt: nowIso(this.now()) }, { keepBackup: false });
    });
  }

  /** Persist partial progress without changing state (e.g. remote upload id before confirmation). */
  async patchRunning(id: string, mutate: (j: Job) => Job): Promise<Job> {
    return this.lock(async () => {
      const j = await readJson(this.file("running", id), Job);
      if (!j) throw new Error(`Job ${id} không ở trạng thái running`);
      const next = Job.parse({ ...mutate(j), updatedAt: nowIso(this.now()) });
      await writeJsonAtomic(this.file("running", id), next);
      return next;
    });
  }

  async complete(id: string, result: Record<string, unknown>): Promise<Job> {
    return this.lock(async () => {
      const j = await this.mustGet(id, "running");
      return this.moveUnlocked(j, "succeeded", "complete", (x) => ({ ...x, result, owner: null }));
    });
  }

  /** Classify failure: RETRYABLE -> requeue with backoff (bounded); BLOCKED -> needs_review; HUMAN_REQUIRED -> manual_action. */
  async fail(id: string, err: unknown, stage: string): Promise<Job> {
    return this.lock(async () => {
      const j = await this.mustGet(id, "running");
      const fe = err instanceof FactoryError ? err : new FactoryError("UNEXPECTED", "RETRYABLE", (err as Error)?.message ?? String(err));
      const now = this.now();
      const retryAt = fe.extra.retryAfter ? new Date(fe.extra.retryAfter) : new Date(now.getTime() + backoffMs(j.attempts));
      const retryable = fe.errorClass === "RETRYABLE" && j.attempts < j.maxAttempts;
      const jobError: JobError = {
        errorCode: fe.code,
        errorClass: fe.errorClass,
        message: fe.message,
        stage,
        provider: fe.extra.provider ?? null,
        candidateId: fe.extra.candidateId ?? null,
        attempt: j.attempts,
        lastSuccess: fe.extra.lastSuccess ?? null,
        impact: fe.extra.impact ?? "",
        retryAfter: retryable ? retryAt.toISOString() : null,
        nextAction: fe.extra.nextAction ?? (retryable ? "Tự động thử lại sau" : "Cần xem xét"),
        userActionRequired: fe.errorClass === "HUMAN_REQUIRED" || fe.errorClass === "BLOCKED",
        telegramAlertId: null,
        manualFallback: fe.extra.manualFallback ?? null,
        at: now.toISOString(),
      };
      const to: JobState = retryable
        ? "queued"
        : fe.errorClass === "BLOCKED"
          ? "needs_review"
          : fe.errorClass === "HUMAN_REQUIRED"
            ? "manual_action"
            : "failed";
      return this.moveUnlocked(j, to, `${fe.code}: ${fe.message}`.slice(0, 300), (x) => ({
        ...x,
        lastError: jobError,
        notBefore: retryable ? retryAt.toISOString() : x.notBefore,
        owner: null,
      }));
    });
  }

  /** Human/Telegram actions: approve (needs_review|manual_action -> queued), reject (-> failed), retry (failed -> queued). */
  async transition(id: string, to: JobState, note: string, mutate?: (j: Job) => Job): Promise<Job> {
    return this.lock(async () => {
      const j = await this.get(id);
      if (!j) throw new Error(`Không tìm thấy job ${id}`);
      return this.moveUnlocked(j, to, note, (x) => {
        const m = mutate ? mutate(x) : x;
        return to === "queued" && x.state === "failed" ? { ...m, attempts: 0, notBefore: null } : m;
      });
    });
  }

  private async mustGet(id: string, state: JobState): Promise<Job> {
    const j = await readJson(this.file(state, id), Job);
    if (!j) throw new Error(`Job ${id} không ở trạng thái ${state}`);
    return j;
  }

  /**
   * Crash recovery: resolve duplicate files left by an interrupted move, and requeue stale
   * running jobs. Publish jobs are flagged `needsReconcile` so the publisher checks the remote
   * side before any retry (never blind repost).
   */
  async recover(): Promise<{ deduped: number; requeued: number; failed: number }> {
    return this.lock(async () => {
      const staleMs = this.opts.staleMs ?? 5 * 60_000;
      let deduped = 0;
      let requeued = 0;
      let failed = 0;
      const seen = new Map<string, Job>();
      for (const s of STATES) {
        for (const j of await this.list(s)) {
          const prev = seen.get(j.id);
          if (!prev) {
            seen.set(j.id, j);
            continue;
          }
          // keep the newer copy (the move destination), drop the other
          const [keep, drop] = prev.updatedAt >= j.updatedAt ? [prev, j] : [j, prev];
          await fs.rm(this.file(drop.state, drop.id), { force: true });
          seen.set(j.id, keep);
          deduped++;
        }
      }
      const now = this.now().getTime();
      for (const j of await this.list("running")) {
        const hb = j.heartbeatAt ? new Date(j.heartbeatAt).getTime() : 0;
        const ownerGone = j.owner?.host === os.hostname() && !alive(j.owner.pid);
        if (now - hb < staleMs && !ownerGone) continue;
        const needsReconcile = j.kind === "PUBLISH" || j.kind === "OWN_COMMENT";
        if (j.attempts >= j.maxAttempts) {
          await this.moveUnlocked(j, "failed", "stale: hết số lần thử", (x) => ({ ...x, owner: null }));
          failed++;
        } else {
          await this.moveUnlocked(j, "queued", "stale: worker dừng đột ngột, đưa lại hàng đợi", (x) => ({
            ...x,
            owner: null,
            payload: needsReconcile ? { ...x.payload, needsReconcile: true } : x.payload,
          }));
          requeued++;
        }
      }
      // rebuild idempotency index from job files (index is derived data)
      const idx: Record<string, string> = (await readJson(this.idemFile(), IdemIndex)) ?? {};
      for (const j of seen.values()) idx[j.idempotencyKey] ??= j.id;
      await writeJsonAtomic(this.idemFile(), idx);
      if (deduped || requeued || failed) await this.store.audit({ actor: "queue", action: "queue.recover", subject: "jobs", detail: { deduped, requeued, failed } });
      return { deduped, requeued, failed };
    });
  }

  async counts(): Promise<Record<JobState, number>> {
    const out = {} as Record<JobState, number>;
    for (const s of STATES) out[s] = (await fs.readdir(this.store.p("jobs", s)).catch(() => [])).filter((n) => n.endsWith(".json")).length;
    return out;
  }
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === "EPERM";
  }
}
