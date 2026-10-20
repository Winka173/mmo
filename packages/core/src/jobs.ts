import { z } from "zod";
import { Id, IsoDate, SCHEMA_VERSION } from "./schemas.js";

export const JobKind = z.enum([
  "DAILY_PLAN",
  "DISCOVER",
  "PRODUCE",
  "RENDER",
  "PUBLISH",
  "VERIFY_PUBLICATION",
  "OWN_COMMENT",
  "DAILY_REPORT",
  "BACKUP",
  "TELEGRAM_SEND",
  // V4
  "GAME_PRODUCE",
  "RIGHTS_AUDIT",
  "LIFECYCLE_AUDIT",
  "AFFILIATE_RECHECK",
  "METRICS_SNAPSHOT",
  "COMMENT_POLL",
  "LEARNING_UPDATE",
  "TREND_SCAN",
]);
export type JobKind = z.infer<typeof JobKind>;

/** Each state maps 1:1 to a queue folder under jobs/. */
export const JobState = z.enum(["queued", "running", "succeeded", "failed", "needs_review", "manual_action"]);
export type JobState = z.infer<typeof JobState>;

/** Allowed queue transitions (spec C: "job state transitions validated"). */
export const JOB_TRANSITIONS: Record<JobState, JobState[]> = {
  queued: ["running", "failed"],
  running: ["succeeded", "failed", "needs_review", "manual_action", "queued"],
  needs_review: ["queued", "failed"],
  manual_action: ["succeeded", "failed", "queued"],
  failed: ["queued"],
  succeeded: [],
};

export const ErrorClass = z.enum(["RETRYABLE", "BLOCKED", "HUMAN_REQUIRED", "PERMANENT"]);
export type ErrorClass = z.infer<typeof ErrorClass>;

/** Structured failure record (spec Q general rule). */
export const JobError = z.object({
  errorCode: z.string(),
  errorClass: ErrorClass,
  message: z.string(),
  stage: z.string(),
  provider: z.string().nullable().default(null),
  candidateId: z.string().nullable().default(null),
  attempt: z.number().int(),
  lastSuccess: IsoDate.nullable().default(null),
  impact: z.string().default(""),
  retryAfter: IsoDate.nullable().default(null),
  nextAction: z.string().default(""),
  userActionRequired: z.boolean().default(false),
  telegramAlertId: z.string().nullable().default(null),
  manualFallback: z.string().nullable().default(null),
  at: IsoDate,
});
export type JobError = z.infer<typeof JobError>;

export const Job = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: Id,
  kind: JobKind,
  state: JobState,
  /** Stable key; a second job with the same key is rejected (spec C / Q1). */
  idempotencyKey: z.string().min(3),
  priority: z.number().int().default(5),
  payload: z.record(z.unknown()),
  attempts: z.number().int().nonnegative().default(0),
  maxAttempts: z.number().int().positive().default(4),
  notBefore: IsoDate.nullable().default(null),
  lastError: JobError.nullable().default(null),
  history: z.array(z.object({ at: IsoDate, from: JobState.nullable(), to: JobState, note: z.string() })).default([]),
  heartbeatAt: IsoDate.nullable().default(null),
  owner: z.object({ pid: z.number(), host: z.string() }).nullable().default(null),
  dependsOn: z.array(Id).default([]),
  usesGpu: z.boolean().default(false),
  budgetUsd: z.number().nonnegative().default(0),
  result: z.record(z.unknown()).nullable().default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Job = z.infer<typeof Job>;

/** Idempotency key: brand + contentId + revision + destination (spec Q1). */
export function idempotencyKey(parts: { brand: string; contentId: string; revision: number; destination: string }): string {
  return [parts.brand, parts.contentId, `r${parts.revision}`, parts.destination].map((p) => String(p).replace(/[^A-Za-z0-9_.-]/g, "_")).join(":");
}

export class FactoryError extends Error {
  constructor(
    public readonly code: string,
    public readonly errorClass: ErrorClass,
    message: string,
    public readonly extra: Partial<Omit<JobError, "errorCode" | "errorClass" | "message">> = {},
  ) {
    super(message);
    this.name = "FactoryError";
  }
}

/** Exponential backoff with full jitter, capped. `rand` injectable for tests. */
export function backoffMs(attempt: number, baseMs = 30_000, capMs = 60 * 60_000, rand: () => number = Math.random): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + rand() * (exp / 2));
}
