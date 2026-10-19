import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FactoryError } from "@ttm/core";
import { safeJoin, sha256File } from "@ttm/storage";
import { z } from "zod";

export const FeatureStatus = z.enum(["implemented", "prototype", "planned", "deprecated"]);

export const GameManifest = z.object({
  game: z.string(),
  buildId: z.string(),
  buildDate: z.string(),
  version: z.string(),
  platforms: z.array(z.object({ name: z.string(), status: FeatureStatus })),
  vehicles: z.array(z.object({ id: z.string(), name: z.string(), role: z.string(), status: FeatureStatus, stats: z.record(z.number()).default({}) })),
  features: z.array(z.object({ id: z.string(), text: z.string(), status: FeatureStatus })),
  assets: z.array(
    z.object({
      id: z.string(),
      file: z.string(),
      kind: z.enum(["gameplay_capture", "screenshot", "render", "concept_art", "logo", "ai_concept"]),
      buildId: z.string().nullable(),
      ownership: z.literal("OWNED"),
      publishAllowed: z.boolean(),
    }),
  ),
  officialLinks: z.array(z.object({ label: z.string(), url: z.string().url() })).default([]),
});
export type GameManifest = z.infer<typeof GameManifest>;

export type GameClaim = { id: string; text: string; status: z.infer<typeof FeatureStatus>; buildId: string; source: string };

const IGNORED = /(^|[\\/])(\.git|\.env.*|.*\.pem|.*\.key|secrets?|node_modules|Library|Temp|obj)([\\/]|$)/i;
const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".mp4", ".mov", ".json", ".md"]);

/** Wording that never presents planned/prototype features as released (spec P1). */
export function phraseByStatus(text: string, status: z.infer<typeof FeatureStatus>): string {
  switch (status) {
    case "implemented":
      return text;
    case "prototype":
      return `${text} (đang thử nghiệm, có thể thay đổi)`;
    case "planned":
      return `Dự kiến: ${text} (chưa có trong game)`;
    case "deprecated":
      return `${text} (đã loại bỏ)`;
  }
}

/**
 * Read-only provider for a user-chosen local game folder. Whitelists extensions, ignores secrets
 * and VCS metadata, never uploads anything to cloud services.
 */
export class GameProjectProvider {
  constructor(private readonly root: string) {}

  async load(): Promise<{ manifest: GameManifest; ledger: GameClaim[]; assetFiles: Record<string, string>; missing: string[]; hashes: Record<string, string> }> {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(this.root, "game-manifest.json"), "utf8");
    } catch {
      throw new FactoryError("GAME_MANIFEST_MISSING", "HUMAN_REQUIRED", "Không tìm thấy game-manifest.json trong thư mục game đã chọn");
    }
    const manifest = GameManifest.parse(JSON.parse(raw));
    const assetFiles: Record<string, string> = {};
    const hashes: Record<string, string> = {};
    const missing: string[] = [];
    for (const a of manifest.assets) {
      if (IGNORED.test(a.file) || !ALLOWED_EXT.has(path.extname(a.file).toLowerCase())) {
        missing.push(`${a.id}: loại file không nằm trong whitelist`);
        continue;
      }
      const full = safeJoin(this.root, a.file);
      try {
        await fs.access(full);
        assetFiles[a.id] = full;
        hashes[a.id] = await sha256File(full);
      } catch {
        missing.push(`${a.id}: thiếu file ${a.file}`);
      }
    }
    const ledger: GameClaim[] = [
      ...manifest.vehicles.map((v) => ({ id: `veh-${v.id}`, text: `${v.name} — ${v.role}`, status: v.status, buildId: manifest.buildId, source: "game-manifest.json#vehicles" })),
      ...manifest.features.map((f) => ({ id: `feat-${f.id}`, text: f.text, status: f.status, buildId: manifest.buildId, source: "game-manifest.json#features" })),
      ...manifest.platforms.map((p) => ({ id: `plat-${p.name}`, text: `Nền tảng ${p.name}`, status: p.status, buildId: manifest.buildId, source: "game-manifest.json#platforms" })),
    ];
    return { manifest, ledger, assetFiles, missing, hashes };
  }

  /** Readiness for a gameplay-type video: real capture of the current build is required. */
  static gameplayReadiness(m: GameManifest, assetFiles: Record<string, string>): { ready: boolean; state: "READY" | "WAITING_FOR_CAPTURE"; reason: string } {
    const captures = m.assets.filter((a) => a.kind === "gameplay_capture" && a.publishAllowed && assetFiles[a.id]);
    const current = captures.filter((a) => a.buildId === m.buildId);
    if (!captures.length) return { ready: false, state: "WAITING_FOR_CAPTURE", reason: "Chưa có footage gameplay thật — không dựng trailer gameplay giả" };
    if (!current.length) return { ready: false, state: "WAITING_FOR_CAPTURE", reason: `Footage thuộc build cũ, build hiện tại ${m.buildId} chưa có capture` };
    return { ready: true, state: "READY", reason: `${current.length} clip gameplay của build ${m.buildId}` };
  }
}
