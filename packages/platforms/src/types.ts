import type { Platform } from "@ttm/core";

export type Capabilities = {
  platform: Platform;
  configured: boolean;
  canPublish: boolean;
  canSchedule: boolean;
  canOwnComment: boolean;
  /** No platform API used here supports auto-pinning; never assume it. */
  canPin: false;
  accountId: string | null;
  accountName: string | null;
  scopes: string[];
  tokenExpiresAt: string | null;
  /** Human-readable blockers in Vietnamese. */
  blockers: string[];
  /** What we do instead when blocked. */
  fallback: "MANUAL_ACTION_REQUIRED" | "NOT_CONFIGURED" | null;
};

export type LinkSurface = { surface: string; clickable: boolean | "unknown"; note: string };

export type PublishPackage = {
  projectId: string;
  idempotencyKey: string;
  videoFile: string;
  videoSha256: string;
  thumbnailFile: string | null;
  title: string;
  description: string;
  tags: string[];
  privacy: "private" | "unlisted" | "public";
  publishAt: string | null;
  containsSyntheticMedia: boolean;
  madeForKids: false;
  categoryId?: string;
};

export type UploadState = {
  /** Persist this BEFORE sending bytes; used to reconcile after a crash. */
  sessionUri?: string;
  remoteId?: string;
};

export type UploadResult =
  | { status: "PUBLISHED" | "PROCESSING"; remoteId: string; url: string; confirmedAt: string; raw?: unknown }
  | { status: "MANUAL_ACTION_REQUIRED"; reason: string; kitDir?: string }
  | { status: "NOT_CONFIGURED"; reason: string };

export interface PlatformPublisher {
  readonly platform: Platform;
  validateCapabilities(): Promise<Capabilities>;
  authenticate(): Promise<{ ok: boolean; detail: string }>;
  /** `persist` must durably store UploadState before network side effects. */
  upload(pkg: PublishPackage, persist: (s: UploadState) => Promise<void>, prior?: UploadState): Promise<UploadResult>;
  pollStatus(remoteId: string): Promise<{ state: "PROCESSING" | "PUBLISHED" | "FAILED" | "UNKNOWN"; detail: string }>;
  getUrl(remoteId: string): string;
  tryOwnComment(remoteId: string, text: string): Promise<{ ok: boolean; commentId?: string; reason?: string }>;
  fetchMetrics(remoteId: string): Promise<Record<string, number | null> | null>;
  getSupportedLinkSurfaces(): LinkSurface[];
  /** Check remote side for a previous attempt (resumable session / known id). Never re-upload blindly. */
  reconcile(prior: UploadState, pkg: PublishPackage): Promise<UploadResult | null>;
}
