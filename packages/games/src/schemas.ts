import { Platform } from "@ttm/core";
import { z } from "zod";

export const GameId = z.string().regex(/^[a-z0-9][a-z0-9-]{2,59}$/, "gameId: chữ thường, số, '-' (3–60 ký tự)");

export const GameStatus = z.enum(["prototype", "pre_alpha", "alpha", "beta", "early_access", "released"]);
export const StoreLinkKind = z.enum(["steam", "app_store", "google_play", "landing", "wishlist", "waitlist", "discord", "demo", "playtest", "itch", "other"]);

export const StoreLink = z.object({
  label: z.string().min(1),
  kind: StoreLinkKind,
  url: z.string().url().refine((u) => u.startsWith("https://"), "chỉ chấp nhận https"),
  /** owner confirmed this is a real, official link (never invented by the system) */
  confirmedByOwner: z.boolean().default(false),
  /** last automatic reachability check (HEAD) — null if never checked */
  checkedAt: z.string().nullable().default(null),
  checkOk: z.boolean().nullable().default(null),
});
export type StoreLink = z.infer<typeof StoreLink>;

export const CtaGoal = z.enum(["follow", "wishlist", "waitlist", "demo", "install", "store_click", "community", "playtest"]);

/** games/<gameId>/game.json — no defaults assert a particular game, genre or release date. */
export const GameProject = z.object({
  schemaVersion: z.literal(1).default(1),
  gameId: GameId,
  internalName: z.string().min(1),
  publicTitle: z.string().min(1),
  localizedTitles: z.record(z.string()).default({}),
  aliases: z.array(z.string()).default([]),
  tagline: z.string().default(""),
  description: z.string().default(""),
  studio: z.string().default(""),
  publisher: z.string().default(""),
  genres: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  gameplayModes: z.array(z.string()).default([]),
  style: z.enum(["2D", "2.5D", "3D", "other"]).nullable().default(null),
  platforms: z.array(z.object({ name: z.string(), status: z.enum(["released", "in_development", "planned"]) })).default([]),
  engine: z.string().nullable().default(null),
  status: GameStatus.nullable().default(null),
  audience: z.string().default(""),
  regions: z.array(z.string()).default([]),
  ageRating: z.string().nullable().default(null),
  marketingGoals: z.array(z.string()).default([]),
  languages: z.array(z.string()).default(["vi"]),
  /** Only a CONFIRMED date may ever appear in content (countdowns, "ra mắt ngày…"). */
  releaseDate: z.object({ date: z.string(), confirmed: z.boolean() }).nullable().default(null),
  /** No public posting before this instant. */
  embargoUntil: z.string().nullable().default(null),
  storeLinks: z.array(StoreLink).default([]),
  utm: z.object({ source: z.string(), medium: z.string(), campaign: z.string() }).nullable().default(null),
  ctaGoal: CtaGoal.default("follow"),
  /** Account ids (MultiAccountManager) this game may publish to. Empty = nowhere. */
  destinationAllowlist: z.array(z.string()).default([]),
  schedule: z.object({ postsPerWeek: z.number().int().min(0).max(21).default(3), preferredHours: z.array(z.number().int().min(0).max(23)).default([18, 20]) }).default({}),
  ownerRights: z.object({ owner: z.string().min(1), statement: z.string().min(1), evidencePath: z.string().nullable().default(null) }).nullable().default(null),
  /** Optional read-only repo/folder integration (explicitly configured; secrets excluded). */
  repoFolder: z.string().nullable().default(null),
  allowCloudUpload: z.boolean().default(false),
  draft: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GameProject = z.infer<typeof GameProject>;

export const FeatureStatusV4 = z.enum(["confirmed", "in_development", "planned", "deprecated"]);
export type FeatureStatusV4 = z.infer<typeof FeatureStatusV4>;

export const VerifiedFeature = z.object({
  id: z.string().regex(/^[a-z0-9_-]{2,60}$/),
  name: z.string().min(1),
  /** alternative spellings used for claim detection in scripts */
  keywords: z.array(z.string()).default([]),
  description: z.string().default(""),
  status: FeatureStatusV4,
  buildId: z.string().nullable().default(null),
  evidence: z.array(z.string()).default([]),
  spoiler: z.boolean().default(false),
  /** roadmap items may only be mentioned in marketing when explicitly approved */
  marketingApproved: z.boolean().default(false),
});
export const VerifiedFeatures = z.object({ schemaVersion: z.literal(1).default(1), features: z.array(VerifiedFeature).default([]), updatedAt: z.string().nullable().default(null) });
export type VerifiedFeature = z.infer<typeof VerifiedFeature>;

export const Roadmap = z.object({
  schemaVersion: z.literal(1).default(1),
  items: z.array(z.object({ id: z.string(), text: z.string(), stage: z.enum(["idea", "planned", "in_development"]), targetWindow: z.string().nullable().default(null), publicApproved: z.boolean().default(false) })).default([]),
});

export const BuildManifest = z.object({
  schemaVersion: z.literal(1).default(1),
  buildId: z.string().regex(/^[A-Za-z0-9._-]{1,60}$/),
  version: z.string(),
  date: z.string(),
  platforms: z.array(z.string()).default([]),
  knownLimitations: z.array(z.string()).default([]),
  changelogFile: z.string().nullable().default(null),
  latest: z.boolean().default(false),
  importedAt: z.string(),
});
export type BuildManifest = z.infer<typeof BuildManifest>;

export const AssetKind = z.enum(["gameplay", "screenshot", "thumbnail", "key_art", "character", "logo", "icon", "render", "audio", "music", "trailer", "ai_concept", "before_after", "document"]);
export type AssetKind = z.infer<typeof AssetKind>;

export const AssetRights = z.object({
  owner: z.string(),
  ownershipType: z.enum(["OWNED", "LICENSED_STOCK", "CREATIVE_COMMONS", "AUTHOR_PERMISSION", "GENERATED_LOCAL", "UNKNOWN"]),
  licenseId: z.string().nullable().default(null),
  licenseEvidencePath: z.string().nullable().default(null),
  commercialUse: z.boolean().nullable().default(null),
  platformScope: z.array(Platform).nullable().default(null),
  expiresAt: z.string().nullable().default(null),
  attribution: z.string().nullable().default(null),
});

export const GameAsset = z.object({
  assetId: z.string(),
  gameId: GameId,
  kind: AssetKind,
  /** content-addressed path relative to DATA_DIR (games/<id>/media/<kind>/<sha256>.<ext>) */
  path: z.string(),
  originalName: z.string(),
  sha256: z.string().length(64),
  bytes: z.number().int().positive(),
  mime: z.string(),
  video: z
    .object({ durationSec: z.number(), width: z.number(), height: z.number(), fps: z.number(), vfr: z.boolean(), hdr: z.boolean(), bitDepth: z.number().nullable(), videoCodec: z.string(), audioCodec: z.string().nullable(), rotation: z.number(), hasAudio: z.boolean() })
    .nullable()
    .default(null),
  image: z.object({ width: z.number(), height: z.number(), hasAlpha: z.boolean() }).nullable().default(null),
  /** normalised 30fps 8-bit SDR proxy (source never modified) */
  proxyPath: z.string().nullable().default(null),
  buildId: z.string().nullable().default(null),
  capturedAt: z.string().nullable().default(null),
  rights: AssetRights,
  flags: z
    .object({
      /** true ONLY for real captures of the game — never for AI/concept/renders */
      isGameplayCapture: z.boolean().default(false),
      aiGenerated: z.boolean().default(false),
      spoiler: z.boolean().default(false),
      bugVisible: z.boolean().default(false),
      debugOverlay: z.boolean().nullable().default(null),
      includeAudio: z.boolean().default(true),
      publishAllowed: z.boolean().default(true),
      /** user-supplied thumbnail must never be auto-overridden */
      lockedThumbnail: z.boolean().default(false),
    })
    .default({}),
  annotation: z.string().default(""),
  segments: z.array(z.object({ name: z.string(), in: z.number(), out: z.number() })).default([]),
  qa: z.object({ status: z.enum(["unchecked", "ok", "warn", "rejected"]).default("unchecked"), notes: z.array(z.string()).default([]) }).default({}),
  uploadId: z.string().nullable().default(null),
  importedAt: z.string(),
});
export type GameAsset = z.infer<typeof GameAsset>;

export const MediaIndex = z.object({ schemaVersion: z.literal(1).default(1), assets: z.array(GameAsset).default([]) });

export const ImportManifest = z.object({
  uploadId: z.string(),
  gameId: GameId,
  source: z.enum(["files", "folder", "zip", "json_manifest", "csv_shotlist", "repo"]),
  at: z.string(),
  items: z.array(z.object({ originalName: z.string(), result: z.enum(["imported", "duplicate", "rejected", "skipped"]), assetId: z.string().nullable().default(null), reason: z.string().nullable().default(null) })),
});
export type ImportManifest = z.infer<typeof ImportManifest>;

export const CampaignKind = z.enum(["awareness", "community", "devlog", "prelaunch", "launch", "update", "feature_drop", "patch", "playtest", "countdown"]);
export const CampaignBrief = z.object({
  schemaVersion: z.literal(1).default(1),
  campaignId: z.string().regex(/^[a-z0-9-]{3,60}$/),
  gameId: GameId,
  name: z.string().min(1),
  kind: CampaignKind,
  objective: CtaGoal,
  pillars: z.array(z.string()).default([]),
  messages: z.array(z.string()).default([]),
  personas: z.array(z.string()).default([]),
  narrativeArc: z.array(z.string()).default([]),
  creativeBriefs: z.array(z.object({ title: z.string(), contentType: z.string(), notes: z.string().default("") })).default([]),
  targetAccounts: z.array(z.string()).default([]),
  startDate: z.string().nullable().default(null),
  endDate: z.string().nullable().default(null),
  countdownTo: z.string().nullable().default(null),
  status: z.enum(["draft", "active", "paused", "done"]).default("draft"),
  createdAt: z.string(),
});
export type CampaignBrief = z.infer<typeof CampaignBrief>;

export const CampaignKpis = z.object({
  campaignId: z.string(),
  /** value null = unknown (no authorised integration) — never 0 by default */
  metrics: z.array(z.object({ name: z.string(), value: z.number().nullable(), source: z.string().nullable(), measuredAt: z.string().nullable(), note: z.string().default("") })),
});

export const GAMEPLAY_REQUIRED_TYPES = new Set(["GAMEPLAY_HIGHLIGHT", "GAME_TRAILER", "GAME_TACTIC", "GAME_MECHANIC", "GAME_TUTORIAL", "GAME_LAUNCH", "GAME_SHORT", "GAME_LONG", "GAME_PATCH_UPDATE", "GAME_COMPARISON", "GAME_CRAFTING"]);

export const GameVideoType = z.enum([
  "GAME_DEVLOG",
  "GAMEPLAY_HIGHLIGHT",
  "GAME_MECHANIC",
  "GAME_CHARACTER",
  "GAME_UNIT",
  "GAME_VEHICLE",
  "GAME_TACTIC",
  "GAME_CRAFTING",
  "GAME_ART_SHOWCASE",
  "GAME_TRAILER",
  "GAME_TEASER",
  "GAME_PATCH_UPDATE",
  "GAME_ANNOUNCEMENT",
  "GAME_TUTORIAL",
  "GAME_COMPARISON",
  "GAME_LAUNCH",
  "GAME_SHORT",
  "GAME_LONG",
]);

export const ThumbnailMode = z.enum(["LOCK_USER_THUMBNAIL", "AUTO_ENHANCE", "GENERATE_CANDIDATES"]);

export const ClipRef = z.object({
  assetId: z.string(),
  in: z.number().min(0),
  out: z.number().positive(),
  /** what TRULY happens in this clip (used for captions/narration, never invented) */
  annotation: z.string().default(""),
  caption: z.string().default(""),
  featureIds: z.array(z.string()).default([]),
});

/** games/<gameId>/projects/<projectId>/input.json — the Create Game Video wizard state. */
export const GameVideoInput = z.object({
  schemaVersion: z.literal(1).default(1),
  projectId: z.string().regex(/^[A-Za-z0-9_-]{3,80}$/),
  gameId: GameId,
  contentType: GameVideoType,
  title: z.string().min(1),
  topic: z.string().default(""),
  hook: z.string().default(""),
  scriptNotes: z.string().default(""),
  /** optional narration lines; each maps 1:1 to clips in order (empty => captions only) */
  narration: z.array(z.string()).default([]),
  language: z.string().default("vi"),
  voice: z.object({ enabled: z.boolean().default(true) }).default({}),
  targets: z.array(Platform).default([]),
  formats: z.array(z.enum(["short_9x16", "long_16x9"])).min(1),
  clips: z.array(ClipRef).default([]),
  screenshots: z.array(z.string()).default([]),
  logoAssetId: z.string().nullable().default(null),
  thumbnail: z
    .object({
      mode: ThumbnailMode.default("GENERATE_CANDIDATES"),
      user16x9: z.string().nullable().default(null),
      user9x16: z.string().nullable().default(null),
      heroFrame: z.object({ assetId: z.string(), t: z.number() }).nullable().default(null),
      textOverlay: z.string().nullable().default(null),
    })
    .default({}),
  buildId: z.string().nullable().default(null),
  featureIds: z.array(z.string()).default([]),
  cta: z.object({ text: z.string().default(""), linkLabel: z.string().nullable().default(null) }).default({}),
  accounts: z.record(z.string()).default({}),
  campaignId: z.string().nullable().default(null),
  musicAssetId: z.string().nullable().default(null),
  keepGameAudio: z.boolean().default(true),
  /** concept/AI cinematic shots allowed only with visible label (never as gameplay) */
  allowConceptShots: z.boolean().default(false),
  releaseWindow: z.object({ from: z.string(), to: z.string() }).nullable().default(null),
  priority: z.number().int().min(1).max(9).default(5),
  autoMode: z.enum(["REVIEW_REQUIRED", "AUTO_SAFE"]).default("REVIEW_REQUIRED"),
  revision: z.number().int().positive().default(1),
  status: z.enum(["draft", "ready", "rendering", "rendered", "held"]).default("draft"),
  updatedAt: z.string(),
});
export type GameVideoInput = z.infer<typeof GameVideoInput>;

export const GameReview = z.object({
  projectId: z.string(),
  /** hash of input.json + thumbnail asset hashes at approval time; any change invalidates */
  approvedInputHash: z.string().nullable().default(null),
  approvedBy: z.string().nullable().default(null),
  approvedAt: z.string().nullable().default(null),
  roadmapMentionApproved: z.boolean().default(false),
  confirmedDestinations: z.array(z.string()).default([]),
  history: z.array(z.object({ at: z.string(), by: z.string(), action: z.string(), note: z.string().default("") })).default([]),
});
export type GameReview = z.infer<typeof GameReview>;
