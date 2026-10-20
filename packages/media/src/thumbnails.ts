import * as fs from "node:fs/promises";
import sharp from "sharp";
import type { BrandKit } from "./brand.js";
import { runProcess } from "./exec.js";
import { esc, wrap } from "./frames.js";

export type ThumbAspect = "16x9" | "9x16";
const DIM: Record<ThumbAspect, [number, number]> = { "16x9": [1280, 720], "9x16": [1080, 1920] };
/** YouTube custom thumbnail limit is 2 MB (re-verify against current docs before changing). */
export const THUMB_MAX_BYTES = 2 * 1024 * 1024;

/**
 * LOCK_USER_THUMBNAIL: format-safe re-encode only — resize to the platform size; if the aspect
 * differs, the user's image is contained over a blurred copy of itself (never cropped, never
 * re-designed). Output stays under the size limit by lowering JPEG quality only.
 */
export async function reencodeLockedThumbnail(src: string, aspect: ThumbAspect, out: string): Promise<{ out: string; width: number; height: number; bytes: number; mode: "resize" | "contain_blur"; quality: number }> {
  const [W, H] = DIM[aspect];
  const m = await sharp(src).metadata();
  const sa = (m.width ?? W) / (m.height ?? H);
  const mode = Math.abs(sa - W / H) / (W / H) < 0.02 ? "resize" : "contain_blur";
  let img: Buffer;
  if (mode === "resize") img = await sharp(src).resize(W, H, { fit: "fill" }).toBuffer();
  else {
    const bg = await sharp(src).resize(W, H, { fit: "cover" }).blur(24).modulate({ brightness: 0.75 }).toBuffer();
    const fg = await sharp(src).resize(W, H, { fit: "inside" }).toBuffer();
    img = await sharp(bg).composite([{ input: fg, gravity: "center" }]).toBuffer();
  }
  let q = 92;
  let buf = await sharp(img).jpeg({ quality: q, mozjpeg: true }).toBuffer();
  while (buf.length > THUMB_MAX_BYTES && q > 50) {
    q -= 8;
    buf = await sharp(img).jpeg({ quality: q, mozjpeg: true }).toBuffer();
  }
  await fs.writeFile(out, buf);
  return { out, width: W, height: H, bytes: buf.length, mode, quality: q };
}

export type ThumbLayout = "left-text" | "bottom-band" | "clean-logo";
export type ThumbCandidate = { file: string; layout: ThumbLayout; textBox: { x: number; y: number; w: number; h: number } | null; textColor: string; fontPx: number; words: number };

/** Truthful candidates from a real frame/owned art (or brand gradient when none). */
export async function renderThumbnailCandidates(o: { frame: string | null; title: string; brand: BrandKit; logo: Buffer | null; aspect: ThumbAspect; outPrefix: string; layouts?: ThumbLayout[]; badge?: string | null }): Promise<ThumbCandidate[]> {
  const [W, H] = DIM[o.aspect];
  const c = o.brand.colors;
  const v = o.aspect === "9x16";
  const base = o.frame
    ? await sharp(o.frame).resize(W, H, { fit: "cover", position: "attention" }).modulate({ saturation: 1.12 }).toBuffer()
    : await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.bg1}"/><stop offset="1" stop-color="${c.bg2}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`)).png().toBuffer();
  const out: ThumbCandidate[] = [];
  for (const layout of o.layouts ?? (["left-text", "bottom-band", "clean-logo"] as ThumbLayout[])) {
    const size = layout === "clean-logo" ? 0 : v ? 110 : 92;
    const words = o.title.split(/\s+/).filter(Boolean).length;
    let svg = "";
    let box: ThumbCandidate["textBox"] = null;
    if (layout === "left-text") {
      const lines = wrap(o.title.toUpperCase(), size, W * (v ? 0.84 : 0.58), v ? 5 : 3);
      const x = v ? 70 : 60;
      const y0 = v ? H * 0.3 : H * 0.3;
      box = { x: x - 20, y: y0 - size, w: W * (v ? 0.88 : 0.62), h: lines.length * size * 1.12 + 40 };
      svg += `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="26" fill="${c.bg2}" opacity="0.72"/>`;
      lines.forEach((l, i) => (svg += `<text x="${x}" y="${y0 + i * size * 1.12}" font-size="${size}" font-weight="900" fill="${c.text}" stroke="${c.bg2}" stroke-width="8" paint-order="stroke" font-family="${o.brand.fontFamily}">${esc(l)}</text>`));
    } else if (layout === "bottom-band") {
      const lines = wrap(o.title, size, W * 0.9, v ? 4 : 2);
      const bandH = lines.length * size * 1.15 + 60;
      box = { x: 0, y: H - bandH - (v ? 380 : 0), w: W, h: bandH };
      svg += `<rect x="0" y="${box.y}" width="${W}" height="${bandH}" fill="${c.accent}"/>`;
      lines.forEach((l, i) => (svg += `<text x="${W / 2}" y="${box!.y + 40 + size * 0.85 + i * size * 1.15}" text-anchor="middle" font-size="${size}" font-weight="900" fill="${c.bg2}" font-family="${o.brand.fontFamily}">${esc(l)}</text>`));
    }
    if (o.badge) svg += `<rect x="${W - 40 - o.badge.length * 22}" y="40" width="${20 + o.badge.length * 22}" height="58" rx="14" fill="${c.badge}"/><text x="${W - 30 - o.badge.length * 22}" y="80" font-size="32" font-weight="700" fill="${c.bg2}" font-family="${o.brand.fontFamily}">${esc(o.badge)}</text>`;
    const comps: sharp.OverlayOptions[] = [{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`), top: 0, left: 0 }];
    if (o.logo) {
      const ls = layout === "clean-logo" ? (v ? 300 : 220) : v ? 150 : 120;
      comps.push({ input: await sharp(o.logo).resize(ls, ls, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(), top: layout === "clean-logo" ? H - ls - (v ? 420 : 40) : v ? 200 : 40, left: layout === "clean-logo" ? Math.round(W / 2 - ls / 2) : W - ls - (v ? 60 : 40) - (o.badge ? 0 : 0) });
    }
    const file = `${o.outPrefix}.${layout}.png`;
    await sharp(base).composite(comps).png().toFile(file);
    out.push({ file, layout, textBox: box, textColor: layout === "bottom-band" ? c.bg2 : c.text, fontPx: size, words: layout === "clean-logo" ? 0 : words });
  }
  return out;
}

const lum = (r: number, g: number, b: number) => {
  const f = (x: number) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

let viFontCache: boolean | null = null;
/** Is a font with Vietnamese coverage installed (fontconfig)? null = cannot determine (e.g. Windows w/o fc-list). */
export async function vietnameseFontAvailable(): Promise<boolean | null> {
  if (viFontCache !== null) return viFontCache;
  const r = await runProcess("fc-list", [":lang=vi", "family"], { timeoutMs: 10_000 }).catch(() => null);
  if (!r || r.code !== 0) return null;
  viFontCache = r.stdout.trim().length > 0;
  return viFontCache;
}

async function dhash(file: string | Buffer): Promise<bigint> {
  const px = await sharp(file).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let h = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h = (h << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  return h;
}
const hamming = (a: bigint, b: bigint) => {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
};

export type ThumbScore = { file: string; score: number; checks: { name: string; ok: boolean; detail: string; weight: number }[]; hash: string };

/**
 * Heuristic ThumbnailOptimizer score (0-100) — legibility at mobile size, WCAG contrast of the
 * text against its real background, word count, Vietnamese font coverage, safe crop, repetition vs
 * previous thumbnails, brand colour presence. It ranks candidates; it does not predict CTR.
 */
export async function scoreThumbnail(c: { file: string; textBox: ThumbCandidate["textBox"]; textColor: string; fontPx: number; words: number; aspect: ThumbAspect }, ctx: { brand: BrandKit; previousHashes?: string[] }): Promise<ThumbScore> {
  const [W, H] = DIM[c.aspect];
  const checks: ThumbScore["checks"] = [];
  const add = (name: string, ok: boolean, detail: string, weight: number) => checks.push({ name, ok, detail, weight });
  const meta = await sharp(c.file).metadata();
  add("kích thước đúng nền tảng", meta.width === W && meta.height === H, `${meta.width}x${meta.height}`, 15);
  if (c.textBox) {
    const bx = { left: Math.max(0, Math.round(c.textBox.x)), top: Math.max(0, Math.round(c.textBox.y)), width: Math.min(W - Math.max(0, Math.round(c.textBox.x)), Math.round(c.textBox.w)), height: Math.min(H - Math.max(0, Math.round(c.textBox.y)), Math.round(c.textBox.h)) };
    const st = await sharp(c.file).extract(bx).stats();
    const bgL = lum(st.channels[0].mean, st.channels[1].mean, st.channels[2].mean);
    const tL = lum(...hex(c.textColor));
    const ratio = (Math.max(bgL, tL) + 0.05) / (Math.min(bgL, tL) + 0.05);
    add("tương phản chữ (WCAG ≥ 4.5)", ratio >= 4.5, `${ratio.toFixed(1)}:1`, 20);
    const mobilePx = (c.fontPx * (c.aspect === "16x9" ? 246 : 180)) / W; // YouTube mobile list ≈246px wide
    add("chữ đọc được trên điện thoại (≥ 14px)", mobilePx >= 14, `${mobilePx.toFixed(1)}px khi thu nhỏ`, 15);
    add("ít chữ (≤ 7 từ)", c.words <= 7, `${c.words} từ`, 10);
    if (c.aspect === "9x16") {
      // feeds crop covers to ~4:5 / 1:1 around the centre — the text block should stay inside
      const top = (H - W * 1.25) / 2;
      add("an toàn khi crop 4:5", c.textBox.y >= top && c.textBox.y + c.textBox.h <= top + W * 1.25, `vùng chữ y=${Math.round(c.textBox.y)}–${Math.round(c.textBox.y + c.textBox.h)}`, 10);
    }
  } else add("không có chữ (dựa vào hình + logo)", true, "bố cục sạch", 5);
  const vi = await vietnameseFontAvailable();
  add("font hỗ trợ dấu tiếng Việt", vi !== false, vi === null ? "không kiểm tra được (không có fc-list) — xem trước bằng mắt" : vi ? "fontconfig có font :lang=vi" : "KHÔNG có font tiếng Việt — dấu có thể lỗi", 10);
  const h = await dhash(c.file);
  const sims = (ctx.previousHashes ?? []).map((p) => 1 - hamming(h, BigInt(p)) / 64);
  const maxSim = sims.length ? Math.max(...sims) : 0;
  add("không lặp thumbnail cũ", maxSim < 0.9, sims.length ? `giống nhất ${(maxSim * 100).toFixed(0)}%` : "chưa có lịch sử", 10);
  const { data, info } = await sharp(c.file).resize(64, 36, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const [ar, ag, ab] = hex(ctx.brand.colors.accent);
  let near = 0;
  for (let i = 0; i < data.length; i += info.channels) if (Math.abs(data[i] - ar) + Math.abs(data[i + 1] - ag) + Math.abs(data[i + 2] - ab) < 90) near++;
  const ratio = near / (info.width * info.height);
  add("có màu nhận diện thương hiệu", ratio > 0.01, `${(ratio * 100).toFixed(1)}% điểm ảnh gần màu accent`, 10);
  const total = checks.reduce((a, x) => a + x.weight, 0);
  const got = checks.filter((x) => x.ok).reduce((a, x) => a + x.weight, 0);
  return { file: c.file, score: Math.round((got / total) * 100), checks, hash: h.toString() };
}
