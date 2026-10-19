import * as fs from "node:fs/promises";
import type { Format, Scene } from "@ttm/core";
import sharp from "sharp";
import { FORMAT_SPECS, type BrandKit } from "./brand.js";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Greedy word wrap by estimated glyph width (Vietnamese diacritics don't widen glyphs). */
export function wrap(text: string, fontSize: number, maxWidth: number, maxLines = 6): string[] {
  const maxChars = Math.max(6, Math.floor(maxWidth / (fontSize * 0.56)));
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if ((cur + " " + w).trim().length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, "") + "…";
    return kept;
  }
  return lines;
}

function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** Original brand mark: a small cabinet with a question mark (no third-party artwork). */
export function logoSvg(brand: BrandKit, x: number, y: number, s: number): string {
  const c = brand.colors;
  return `<g transform="translate(${x},${y}) scale(${s / 100})">
    <rect x="0" y="0" width="100" height="100" rx="18" fill="${c.accent}"/>
    <rect x="12" y="12" width="36" height="76" rx="6" fill="${c.bg1}"/>
    <rect x="52" y="12" width="36" height="76" rx="6" fill="${c.bg1}"/>
    <circle cx="42" cy="52" r="3.5" fill="${c.accent}"/><circle cx="58" cy="52" r="3.5" fill="${c.accent}"/>
    <text x="70" y="44" font-size="30" font-weight="700" text-anchor="middle" fill="${c.accent}" font-family="${brand.fontFamily}">?</text>
  </g>`;
}

const KIND_LABEL: Record<string, string> = {
  hook: "BẠN CÓ BIẾT?",
  point: "ĐIỂM CHÍNH",
  evidence: "BẰNG CHỨNG",
  comparison: "SO SÁNH",
  cta: "THEO DÕI",
  credits: "NGUỒN & GHI CÔNG",
  chapter: "CHƯƠNG",
};

export type FrameOptions = {
  scene: Scene;
  format: Format;
  brand: BrandKit;
  /** Local image (owned/licensed) used as background; null => generated graphics. */
  backgroundImage?: string | null;
  badges?: string[];
  index: number;
  total: number;
  /** Render larger than output so the renderer can pan without upscaling. */
  overscan?: number;
};

export async function renderSceneFrame(opts: FrameOptions, outPng: string): Promise<void> {
  const spec = FORMAT_SPECS[opts.format];
  const k = opts.overscan ?? 1.08;
  const W = Math.round(spec.width * k);
  const H = Math.round(spec.height * k);
  const ox = (W - spec.width) / 2;
  const oy = (H - spec.height) / 2;
  const c = opts.brand.colors;
  const font = opts.brand.fontFamily;
  const vertical = opts.format === "short_9x16";
  const rnd = seeded(opts.scene.id);

  // decorative generated pattern
  let deco = "";
  for (let i = 0; i < 14; i++) {
    const r = 30 + rnd() * (vertical ? 180 : 140);
    deco += `<circle cx="${(rnd() * W).toFixed(0)}" cy="${(rnd() * H).toFixed(0)}" r="${r.toFixed(0)}" fill="${i % 3 === 0 ? c.accent : c.badge}" opacity="${(0.04 + rnd() * 0.08).toFixed(2)}"/>`;
  }

  const L = ox + spec.safe.left;
  const R = ox + spec.width - spec.safe.right;
  const top = oy + spec.safe.top;
  const textW = vertical ? R - L : (R - L) * 0.62;
  const titleSize = vertical ? 78 : 72;
  const titleLines = wrap(opts.scene.title, titleSize, textW, vertical ? 5 : 3);
  const label = KIND_LABEL[opts.scene.kind] ?? "";
  let y = top + (vertical ? 260 : 200);
  let body = `<text x="${L}" y="${y}" font-size="${vertical ? 40 : 34}" font-weight="700" letter-spacing="4" fill="${c.accent}" font-family="${font}">${esc(
    opts.scene.chapterTitle ? `${label} · ${opts.scene.chapterTitle}` : label,
  )}</text>`;
  y += vertical ? 110 : 95;
  for (const line of titleLines) {
    body += `<text x="${L}" y="${y}" font-size="${titleSize}" font-weight="800" fill="${c.text}" font-family="${font}">${esc(line)}</text>`;
    y += titleSize * 1.18;
  }
  y += 30;
  const bulletSize = vertical ? 46 : 40;
  for (const b of opts.scene.bullets.slice(0, 4)) {
    const lines = wrap(b, bulletSize, textW - 60, 3);
    body += `<circle cx="${L + 14}" cy="${y - bulletSize * 0.35}" r="10" fill="${c.badge}"/>`;
    for (const line of lines) {
      body += `<text x="${L + 48}" y="${y}" font-size="${bulletSize}" fill="${c.muted}" font-family="${font}">${esc(line)}</text>`;
      y += bulletSize * 1.3;
    }
    y += 18;
  }

  // illustration panel for 16:9 (generated geometry, not stock)
  let panel = "";
  if (!vertical) {
    const px = ox + spec.width * 0.68;
    const py = oy + 220;
    const pw = spec.width * 0.26;
    panel = `<rect x="${px}" y="${py}" width="${pw}" height="${pw}" rx="40" fill="${c.bg2}" stroke="${c.accent}" stroke-width="4" opacity="0.9"/>
      <circle cx="${px + pw / 2}" cy="${py + pw / 2}" r="${pw * 0.28}" fill="${c.accent}" opacity="0.85"/>
      <circle cx="${px + pw / 2 + pw * 0.12}" cy="${py + pw / 2 - pw * 0.1}" r="${pw * 0.09}" fill="${c.bg1}" opacity="0.5"/>
      <text x="${px + pw / 2}" y="${py + pw + 70}" font-size="34" text-anchor="middle" fill="${c.muted}" font-family="${font}">${opts.index + 1} / ${opts.total}</text>`;
  }

  const badges = (opts.badges ?? []).map((b, i) => {
    const bx = L + i * 0;
    const by = oy + spec.height - spec.safe.bottom + (vertical ? 0 : -110) - i * 64;
    return `<rect x="${bx}" y="${by - 42}" width="${Math.min(R - L, 30 + b.length * 22)}" height="56" rx="14" fill="${c.bg2}" opacity="0.85"/>
      <text x="${bx + 18}" y="${by - 4}" font-size="30" fill="${c.badge}" font-family="${font}">${esc(b)}</text>`;
  });
  const source = opts.scene.sourceCaption
    ? `<text x="${L}" y="${oy + spec.height - spec.safe.bottom + (vertical ? 60 : -50)}" font-size="${vertical ? 30 : 26}" fill="${c.muted}" font-family="${font}">${esc(
        "Nguồn: " + opts.scene.sourceCaption,
      ).slice(0, 160)}</text>`
    : "";
  const progress = `<rect x="${L}" y="${oy + spec.safe.top - 40}" width="${R - L}" height="8" rx="4" fill="${c.bg2}"/>
    <rect x="${L}" y="${oy + spec.safe.top - 40}" width="${((R - L) * (opts.index + 1)) / opts.total}" height="8" rx="4" fill="${c.accent}"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.bg1}"/><stop offset="1" stop-color="${c.bg2}"/></linearGradient></defs>
    ${opts.backgroundImage ? `<rect width="100%" height="100%" fill="${c.bg2}" opacity="0.62"/>` : `<rect width="100%" height="100%" fill="url(#g)"/>${deco}`}
    ${progress}
    ${logoSvg(opts.brand, L, oy + spec.safe.top + 10, vertical ? 110 : 90)}
    <text x="${L + (vertical ? 135 : 112)}" y="${oy + spec.safe.top + (vertical ? 85 : 70)}" font-size="${vertical ? 52 : 44}" font-weight="800" fill="${c.text}" font-family="${font}">${esc(opts.brand.name)}</text>
    ${body}${panel}${badges.join("")}${source}
  </svg>`;

  let img: sharp.Sharp;
  if (opts.backgroundImage) {
    const bg = await sharp(opts.backgroundImage).resize(W, H, { fit: "cover" }).blur(2).toBuffer();
    img = sharp(bg).composite([{ input: Buffer.from(svg) }]);
  } else img = sharp(Buffer.from(svg));
  await fs.writeFile(outPng, await img.png().toBuffer());
}

/** Thumbnail (16:9 1280x720 or 9:16 1080x1920) with large hook text. */
export async function renderThumbnail(opts: { title: string; format: Format; brand: BrandKit; badge?: string }, outPng: string): Promise<void> {
  const vertical = opts.format === "short_9x16";
  const W = vertical ? 1080 : 1280;
  const H = vertical ? 1920 : 720;
  const c = opts.brand.colors;
  const size = vertical ? 104 : 86;
  const lines = wrap(opts.title.toUpperCase(), size, W - 160, vertical ? 6 : 3);
  let y = vertical ? 700 : 260;
  const text = lines
    .map((l) => {
      const t = `<text x="80" y="${y}" font-size="${size}" font-weight="900" fill="${c.text}" stroke="${c.bg2}" stroke-width="6" paint-order="stroke" font-family="${opts.brand.fontFamily}">${esc(l)}</text>`;
      y += size * 1.12;
      return t;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.bg1}"/><stop offset="1" stop-color="${c.bg2}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${W * 0.85}" cy="${H * 0.25}" r="${W * 0.18}" fill="${c.accent}" opacity="0.9"/>
    <text x="${W * 0.85}" y="${H * 0.25 + W * 0.07}" font-size="${W * 0.2}" font-weight="900" text-anchor="middle" fill="${c.bg1}" font-family="${opts.brand.fontFamily}">?</text>
    ${logoSvg(opts.brand, 80, vertical ? 240 : 60, vertical ? 120 : 90)}
    ${text}
    ${opts.badge ? `<rect x="80" y="${H - (vertical ? 560 : 120)}" width="${40 + opts.badge.length * 26}" height="70" rx="16" fill="${c.badge}"/><text x="100" y="${H - (vertical ? 512 : 72)}" font-size="38" font-weight="700" fill="${c.bg2}" font-family="${opts.brand.fontFamily}">${esc(opts.badge)}</text>` : ""}
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outPng);
}
