import { z } from "zod";

/** Bump when a persisted file shape changes; see packages/storage/src/migrations.ts. */
export const SCHEMA_VERSION = 1;
/**
 * Data-directory layout version (config/schema-version.json). v2 = V4 multi-game layout
 * (`games/<gameId>/`), accounts, registry. Migrations: packages/storage/src/migrations.ts.
 */
export const DATA_VERSION = 2;

export const Id = z.string().regex(/^[A-Za-z0-9_-]{3,80}$/, "ID chỉ gồm chữ, số, '_' hoặc '-' (3–80 ký tự)");
export const IsoDate = z.string().datetime({ offset: true });

export const ContentType = z.enum([
  "AFFILIATE_REVIEW",
  "FACT_SHORT",
  "EXPLAINER_SHORT",
  "NEWS_SUMMARY",
  "TRANSLATED_ADAPTATION",
  "LICENSED_REPOST",
  "CHINA_INSPIRED_ORIGINAL",
  "GAME_DEVLOG",
  "GAMEPLAY_HIGHLIGHT",
  "GAME_VEHICLE_SPOTLIGHT",
  "GAME_TACTIC",
  "GAME_TRAILER",
  "GAME_PATCH_UPDATE",
  "YOUTUBE_LONG",
  // V4 generic multi-game types (no unit/vehicle assumption)
  "GAME_MECHANIC",
  "GAME_CHARACTER",
  "GAME_UNIT",
  "GAME_VEHICLE",
  "GAME_CRAFTING",
  "GAME_ART_SHOWCASE",
  "GAME_TEASER",
  "GAME_ANNOUNCEMENT",
  "GAME_TUTORIAL",
  "GAME_COMPARISON",
  "GAME_LAUNCH",
  "GAME_SHORT",
  "GAME_LONG",
]);
export type ContentType = z.infer<typeof ContentType>;

export const Platform = z.enum(["youtube_shorts", "youtube_long", "facebook", "instagram", "tiktok"]);
export type Platform = z.infer<typeof Platform>;

export const AutomationMode = z.enum(["OFF", "REVIEW_REQUIRED", "AUTO_SAFE"]);
export type AutomationMode = z.infer<typeof AutomationMode>;

export const RiskTier = z.enum(["LOW", "MEDIUM", "HIGH"]);
/** Topics never eligible for unattended AUTO_SAFE (spec D3). */
export const SensitiveCategory = z.enum([
  "medical",
  "investing",
  "legal",
  "politics",
  "crisis",
  "personal_safety",
  "accusation",
]);

// ---------------------------------------------------------------- Claims / sources

export const SourceRef = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  publisher: z.string().min(1),
  /** primary = official/peer-reviewed/agency; secondary = reputable press; tertiary = encyclopedia/blog */
  tier: z.enum(["primary", "secondary", "tertiary"]),
  /** null when never fetched by the system — must not be invented. */
  fetchedAt: IsoDate.nullable(),
  /** Short excerpt actually seen in the fetched page (<= 300 chars). */
  excerpt: z.string().max(300).nullable(),
  contentSha256: z.string().nullable().default(null),
});
export type SourceRef = z.infer<typeof SourceRef>;

export const ClaimStatus = z.enum([
  "UNVERIFIED",
  /** Source URLs recorded by an editor but not fetched/checked by the system yet. */
  "SOURCED_UNFETCHED",
  "VERIFIED",
  "CONTRADICTED",
  "STALE",
]);

export const Claim = z.object({
  id: Id,
  text: z.string().min(1),
  sources: z.array(SourceRef),
  riskTier: RiskTier,
  status: ClaimStatus,
  /** Time-sensitive claims (news, prices) must be re-checked before publish. */
  timeSensitive: z.boolean().default(false),
  checkedAt: IsoDate.nullable().default(null),
  contradictionNotes: z.array(z.string()).default([]),
  categories: z.array(SensitiveCategory).default([]),
});
export type Claim = z.infer<typeof Claim>;

// ---------------------------------------------------------------- Rights

export const OwnershipType = z.enum([
  "OWNED",
  "GENERATED_LOCAL",
  "PUBLIC_DOMAIN",
  "CREATIVE_COMMONS",
  "LICENSED_STOCK",
  "AUTHOR_PERMISSION",
  "PLATFORM_API_PERMITTED",
  "UNKNOWN",
]);
export type OwnershipType = z.infer<typeof OwnershipType>;

export const RightsStatus = z.enum(["VERIFIED", "RIGHTS_REVIEW", "IDEA_ONLY", "REVOKED", "EXPIRED", "BLOCKED"]);
export type RightsStatus = z.infer<typeof RightsStatus>;

export const MediaRights = z.object({
  assetId: Id,
  originUrl: z.string().nullable(),
  author: z.string().nullable(),
  ownershipType: OwnershipType,
  licenseId: z.string().nullable(),
  licenseEvidencePath: z.string().nullable(),
  commercialUse: z.boolean().nullable(),
  adaptationAllowed: z.boolean().nullable(),
  redistributionAllowed: z.boolean().nullable(),
  platformScope: z.array(Platform).nullable(),
  attribution: z.string().nullable().default(null),
  expiresAt: IsoDate.nullable(),
  acquiredHow: z.enum(["local_import", "generated", "official_download", "official_api", "user_export", "metadata_only"]),
  hash: z.string().nullable(),
  status: RightsStatus,
  notes: z.string().default(""),
});
export type MediaRights = z.infer<typeof MediaRights>;

export const RightsManifest = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  projectId: Id,
  assets: z.array(MediaRights),
  music: z.array(MediaRights).default([]),
  voice: z
    .object({ engine: z.string(), voice: z.string(), license: z.string(), commercialUseOk: z.boolean() })
    .nullable(),
});
export type RightsManifest = z.infer<typeof RightsManifest>;

// ---------------------------------------------------------------- Affiliate

export const Product = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: Id,
  title: z.string().min(1),
  isDemo: z.boolean(),
  shopeeUrl: z.string().url().nullable(),
  affiliateLink: z
    .object({ url: z.string().url(), createdAt: IsoDate, expiresAt: IsoDate.nullable(), verifiedAt: IsoDate.nullable() })
    .nullable(),
  /** Never asserted unless verified with timestamp. */
  price: z.object({ amountVnd: z.number().int().positive(), verifiedAt: IsoDate.nullable() }).nullable(),
  features: z.array(z.object({ text: z.string(), claimId: Id.nullable() })),
  disclosure: z.string().default("Video có chứa link tiếp thị liên kết (affiliate). Tủ Tò Mò có thể nhận hoa hồng."),
});
export type Product = z.infer<typeof Product>;

// ---------------------------------------------------------------- Storyboard

export const SceneKind = z.enum(["hook", "point", "evidence", "comparison", "cta", "credits", "chapter"]);

export const Scene = z.object({
  id: Id,
  kind: SceneKind,
  /** On-screen headline (short). */
  title: z.string().min(1),
  /** Narration text spoken by TTS (also subtitles). */
  narration: z.string().min(1),
  /** Optional body bullets on screen. */
  bullets: z.array(z.string()).default([]),
  /** Asset id from rights manifest used as background, or null for generated graphics. */
  assetId: Id.nullable().default(null),
  claimIds: z.array(Id).default([]),
  /** Minimum seconds; real length follows TTS duration. */
  minSeconds: z.number().positive().default(3),
  transition: z.enum(["cut", "fade"]).default("fade"),
  sourceCaption: z.string().nullable().default(null),
  chapterTitle: z.string().nullable().default(null),
});
export type Scene = z.infer<typeof Scene>;

export const Format = z.enum(["short_9x16", "long_16x9"]);
export type Format = z.infer<typeof Format>;

export const Storyboard = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  projectId: Id,
  revision: z.number().int().positive(),
  format: Format,
  template: z.enum([
    "CuriosityFact",
    "MiniExplainer",
    "ProductSpotlight",
    "Comparison",
    "LicensedAdaptation",
    "StoryExplainer",
    "TopNWithProof",
    "DeepDive",
    "GameDevlog",
    "GameplayHighlight",
    "GameTrailer",
  ]),
  title: z.string().min(1),
  scenes: z.array(Scene).min(1),
  generatedBy: z.enum(["deterministic_template", "llm", "human"]),
});
export type Storyboard = z.infer<typeof Storyboard>;

// ---------------------------------------------------------------- Project

export const PublicationState = z.enum([
  "NOT_CONFIGURED",
  "READY",
  "QUEUED",
  "UPLOADING",
  "PROCESSING",
  "PUBLISHED",
  "MANUAL_ACTION_REQUIRED",
  "BLOCKED_RIGHTS",
  "NEEDS_REVIEW",
  "FAILED",
  "SKIPPED",
]);
export type PublicationState = z.infer<typeof PublicationState>;

export const Publication = z.object({
  platform: Platform,
  state: PublicationState,
  idempotencyKey: z.string(),
  remoteId: z.string().nullable(),
  url: z.string().nullable(),
  /** Remote confirmation timestamp — only set when the platform API confirmed. */
  confirmedAt: IsoDate.nullable(),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  isDemo: z.boolean(),
  updatedAt: IsoDate,
  /** MultiAccountManager account used (V4); null for legacy single-account publications. */
  accountId: z.string().nullable().default(null),
});
export type Publication = z.infer<typeof Publication>;

export const ProjectStatus = z.enum([
  "DISCOVERED",
  "ELIGIBILITY_CHECK",
  "CANDIDATE",
  "SOURCING",
  "SCRIPT",
  "ASSETS",
  "TTS",
  "RENDER",
  "QA",
  "READY_FOR_REVIEW",
  "AUTO_SAFE",
  "PUBLISHING",
  "VERIFYING",
  "PUBLISHED",
  "PARTIAL",
  "HOLD_RIGHTS",
  "HOLD_FACTS",
  "HOLD_AFFILIATE",
  "HOLD_POLICY",
  "NEEDS_USER",
  "FAILED_PERMANENT",
]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const Project = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: Id,
  brand: z.string().default("tutomo"),
  /** Owning game project (V4 multi-game); null for Tủ Tò Mò brand content. */
  gameId: z.string().nullable().default(null),
  /** Shared provenance lineage (long video + derived Shorts share it). */
  lineageId: z.string().nullable().default(null),
  language: z.string().default("vi"),
  contentType: ContentType,
  title: z.string().min(1),
  /** demo = fixture/synthetic content, never eligible for live publish. */
  mode: z.enum(["demo", "live"]),
  status: ProjectStatus,
  revision: z.number().int().positive(),
  topicId: Id.nullable().default(null),
  productId: Id.nullable().default(null),
  formats: z.array(Format).min(1),
  categories: z.array(SensitiveCategory).default([]),
  /** Documented original value for adaptations (spec D3). */
  originalityChecklist: z
    .object({
      newNarration: z.boolean(),
      originalLayout: z.boolean(),
      substantialEditing: z.boolean(),
      uniqueValueNote: z.string(),
    })
    .nullable()
    .default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Project = z.infer<typeof Project>;

// ---------------------------------------------------------------- QA

export const QaCheck = z.object({ name: z.string(), ok: z.boolean(), detail: z.string() });
export const QaReport = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  projectId: Id,
  format: Format,
  file: z.string(),
  sha256: z.string(),
  ffprobe: z.object({
    width: z.number(),
    height: z.number(),
    durationSec: z.number(),
    videoCodec: z.string(),
    audioCodec: z.string().nullable(),
    fps: z.number(),
  }),
  checks: z.array(QaCheck),
  passed: z.boolean(),
  createdAt: IsoDate,
});
export type QaReport = z.infer<typeof QaReport>;

// ---------------------------------------------------------------- Settings

export const Settings = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  timezone: z.string().default("Asia/Ho_Chi_Minh"),
  killSwitch: z.boolean().default(false),
  paused: z.boolean().default(false),
  /** External posting is disabled until explicitly enabled per channel (spec B12). */
  externalPostingEnabled: z.boolean().default(false),
  defaultMode: AutomationMode.default("REVIEW_REQUIRED"),
  /** AUTO_SAFE opt-in per `${platform}:${contentType}`. */
  autoSafeOptIns: z.array(z.string()).default([]),
  dailyCaps: z
    .object({ shorts: z.number().int().nonnegative().default(1), longPerWeek: z.number().int().nonnegative().default(1), commentsPerDay: z.number().int().nonnegative().default(5) })
    .default({}),
  budgets: z
    .object({ monthlyUsdCap: z.number().nonnegative().default(0), perVideoUsdCap: z.number().nonnegative().default(0), alertAtRatio: z.number().min(0).max(1).default(0.8) })
    .default({}),
  ratios: z
    .object({ knowledgeFact: z.number().default(0.4), affiliate: z.number().default(0.3), adaptation: z.number().default(0.2), longForm: z.number().default(0.1) })
    .default({}),
  schedules: z
    .object({ dailyPlanCron: z.string().default("0 7 * * *"), dailyReportCron: z.string().default("0 19 * * *"), weeklyLongCron: z.string().default("0 9 * * 6") })
    .default({}),
  concurrency: z.object({ jobs: z.number().int().positive().default(2), gpu: z.number().int().nonnegative().default(1) }).default({}),
  telegram: z
    .object({ allowedChatIds: z.array(z.string()).default([]), enabled: z.boolean().default(false), notify: z.record(z.boolean()).default({}) })
    .default({}),
  retentionDays: z.object({ audit: z.number().int().default(365), renders: z.number().int().default(90) }).default({}),
  minFreeDiskGb: z.number().default(10),
  // ------------------------------------------------------------ V4 additions (all defaulted = safe)
  /** Phase feature flags; risky automation defaults OFF. */
  features: z
    .object({
      qualityJudge: z.boolean().default(true),
      autoRepair: z.boolean().default(true),
      originalityGate: z.boolean().default(true),
      learningAutoAdjust: z.boolean().default(false),
      abTesting: z.boolean().default(false),
      commentAutoReply: z.boolean().default(false),
      multilingual: z.boolean().default(false),
      trendRadar: z.boolean().default(true),
      lifecycleAudit: z.boolean().default(true),
    })
    .default({}),
  quality: z
    .object({
      mode: z.enum(["FAST_QA", "STANDARD_QA", "PREMIUM_QA"]).default("FAST_QA"),
      maxRepairIterations: z.number().int().min(0).max(5).default(2),
      minEditorialScore: z.number().min(0).max(100).default(55),
    })
    .default({}),
  /** BudgetRouter caps (USD). 0 = paid calls blocked. */
  spend: z
    .object({
      dailyUsdCap: z.number().nonnegative().default(0),
      weeklyUsdCap: z.number().nonnegative().default(0),
      paidProviderAllowlist: z.array(z.string()).default([]),
      electricityUsdPerKwh: z.number().nonnegative().nullable().default(null),
    })
    .default({}),
  learning: z
    .object({
      explorationRatio: z.number().min(0).max(1).default(0.3),
      minSamplePerArm: z.number().int().positive().default(5),
      maxCadenceShiftPerWeek: z.number().min(0).max(1).default(0.2),
      frozen: z.boolean().default(false),
    })
    .default({}),
  languages: z.array(z.string()).default(["vi"]),
  gpu: z
    .object({ profile: z.enum(["auto", "cpu-only", "rtx-16gb"]).default("auto"), maxTempC: z.number().default(83), minFreeVramMb: z.number().default(1500) })
    .default({}),
  comments: z.object({ maxRepliesPerDay: z.number().int().nonnegative().default(10), cooldownMinutes: z.number().int().nonnegative().default(30) }).default({}),
});
export type Settings = z.infer<typeof Settings>;
