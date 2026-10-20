import * as fs from "node:fs/promises";
import { nowIso } from "@ttm/core";
import { readJson, writeJsonAtomic, type DataStore } from "@ttm/storage";
import { z } from "zod";
import { TU_TO_MO_BRAND, type BrandKit } from "./brand.js";

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Versioned brand kit (spec U2) — one per brand AND per game. Never shared across owners. */
export const BrandKitFile = z.object({
  schemaVersion: z.literal(1).default(1),
  kitVersion: z.number().int().positive(),
  owner: z.object({ kind: z.enum(["brand", "game"]), id: z.string() }),
  name: z.string().min(1),
  tagline: z.string().default(""),
  colors: z.object({ bg1: Hex, bg2: Hex, accent: Hex, text: Hex, muted: Hex, badge: Hex }),
  fonts: z.array(z.object({ family: z.string(), license: z.string(), file: z.string().nullable().default(null) })).default([]),
  /** path relative to DATA_DIR (owned asset); null => text-only, non-deceptive fallback */
  logoPath: z.string().nullable().default(null),
  mascots: z.array(z.object({ path: z.string(), permission: z.string() })).default([]),
  overlays: z.object({ cornerLogo: z.boolean().default(true), buildLabel: z.boolean().default(true), gameName: z.boolean().default(true) }).default({}),
  intro: z.object({ enabled: z.boolean().default(false), maxSec: z.number().max(3).default(1.5) }).default({}),
  outro: z.object({ enabled: z.boolean().default(true), maxSec: z.number().max(5).default(2.5) }).default({}),
  voice: z.object({ engine: z.string().default("espeak-ng"), voice: z.string().default("vi"), speedWpm: z.number().default(165), pitch: z.number().default(45) }).default({}),
  editorialVoice: z.string().default(""),
  terms: z.array(z.string()).default([]),
  bannedPhrases: z.array(z.string()).default([]),
  pronunciation: z.array(z.object({ from: z.string(), to: z.string() })).default([]),
  ctaSurfaces: z.array(z.string()).default([]),
  music: z.object({ allowed: z.boolean().default(false), rule: z.string().default("chỉ nhạc có license thương mại cho mọi nền tảng đích") }).default({}),
  templates: z.array(z.string()).default([]),
  updatedAt: z.string(),
});
export type BrandKitFile = z.infer<typeof BrandKitFile>;

export const FONT_STACK = TU_TO_MO_BRAND.fontFamily;

export function toRenderKit(f: BrandKitFile): BrandKit {
  const family = f.fonts.length ? `${f.fonts.map((x) => `'${x.family}'`).join(", ")}, ${FONT_STACK}` : FONT_STACK;
  return { name: f.name, colors: f.colors, fontFamily: family, tagline: f.tagline };
}

export function defaultTuToMoKit(): BrandKitFile {
  return BrandKitFile.parse({ kitVersion: 1, owner: { kind: "brand", id: "tutomo" }, name: TU_TO_MO_BRAND.name, tagline: TU_TO_MO_BRAND.tagline, colors: TU_TO_MO_BRAND.colors, updatedAt: nowIso(), bannedPhrases: ["100% hiệu quả", "rẻ nhất", "chữa khỏi"], editorialVoice: "tò mò, hài hước vừa phải, hữu ích" });
}

/**
 * BrandIdentityEngine: loads/saves versioned kits (each save = new immutable version file + pointer),
 * checks scripts against banned phrases, builds pronunciation lexicon, and refuses to render a game
 * post with another owner's kit (no Tủ Tò Mò stamp on game videos unless explicitly requested).
 */
export class BrandIdentityEngine {
  constructor(private readonly store: DataStore) {}

  private dir(owner: BrandKitFile["owner"]) {
    return owner.kind === "game" ? this.store.p("games", owner.id) : this.store.p("config", "brand-kits", owner.id);
  }

  async load(owner: BrandKitFile["owner"]): Promise<BrandKitFile | null> {
    const kit = await readJson(`${this.dir(owner)}/brand-kit.json`, BrandKitFile);
    if (kit) return kit;
    return owner.kind === "brand" && owner.id === "tutomo" ? defaultTuToMoKit() : null;
  }

  async save(input: z.input<typeof BrandKitFile>, actor: string): Promise<BrandKitFile> {
    const prev = await this.load(input.owner as BrandKitFile["owner"]);
    const kit = BrandKitFile.parse({ ...input, kitVersion: (prev?.kitVersion ?? 0) + 1, updatedAt: nowIso() });
    const dir = this.dir(kit.owner);
    await fs.mkdir(`${dir}/brand-kit-versions`, { recursive: true });
    await writeJsonAtomic(`${dir}/brand-kit-versions/v${kit.kitVersion}.json`, kit, { keepBackup: false });
    await writeJsonAtomic(`${dir}/brand-kit.json`, kit);
    await this.store.audit({ actor, action: "brandkit.save", subject: `${kit.owner.kind}:${kit.owner.id}`, detail: { kitVersion: kit.kitVersion } });
    return kit;
  }

  async versions(owner: BrandKitFile["owner"]): Promise<number[]> {
    return (await fs.readdir(`${this.dir(owner)}/brand-kit-versions`).catch(() => [] as string[])).map((n) => Number(/^v(\d+)\.json$/.exec(n)?.[1])).filter(Boolean).sort((a, b) => a - b);
  }

  static bannedPhraseHits(kit: BrandKitFile, text: string): string[] {
    const t = text.toLowerCase();
    return kit.bannedPhrases.filter((p) => t.includes(p.toLowerCase()));
  }

  static lexicon(kit: BrandKitFile): [RegExp, string][] {
    return kit.pronunciation.map((p) => [new RegExp(`\\b${p.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), p.to]);
  }

  /** Hard rule: a project's kit owner must equal the project owner (spec U2 / Y1). */
  static assertOwnKit(kit: BrandKitFile, owner: { kind: "brand" | "game"; id: string }): void {
    if (kit.owner.kind !== owner.kind || kit.owner.id !== owner.id)
      throw new Error(`Brand kit ${kit.owner.kind}:${kit.owner.id} không thuộc ${owner.kind}:${owner.id} — không đóng dấu thương hiệu khác lên nội dung này`);
  }
}
