import sharp from "sharp";

const TRACKING = /^(utm_|spm|scm|share|sharer|from|fbclid|gclid|igshid|si|is_from_webapp|sender_device|_t|_r|ttclid|xsec_|vd_source)/i;

/** Canonical URL: lowercase host, drop www/m., drop tracking params & fragment, sort the rest. */
export function canonicalUrl(raw: string): string {
  const u = new URL(raw.trim());
  u.hostname = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  u.hash = "";
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = new URLSearchParams(keep).toString();
  u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  return u.toString();
}

/** Remove Vietnamese diacritics + punctuation for fuzzy text matching. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shingles(s: string, n = 3): Set<string> {
  const t = normalizeText(s);
  // CJK has no spaces: use character n-grams; otherwise word bigrams + char trigrams
  const out = new Set<string>();
  const compact = t.replace(/\s/g, "");
  for (let i = 0; i + n <= compact.length; i++) out.add(compact.slice(i, i + n));
  const words = t.split(" ");
  for (let i = 0; i + 1 < words.length; i++) out.add(`${words[i]}_${words[i + 1]}`);
  return out;
}

export function jaccard(a: string, b: string): number {
  const A = shingles(a);
  const B = shingles(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Bag-of-words cosine — cheap local "semantic-ish" similarity; an embedding provider can replace it. */
export function cosine(a: string, b: string): number {
  const vec = (s: string) => {
    const m = new Map<string, number>();
    for (const w of normalizeText(s).split(" ").filter((w) => w.length > 1)) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  };
  const A = vec(a);
  const B = vec(b);
  let dot = 0;
  for (const [k, v] of A) dot += v * (B.get(k) ?? 0);
  const na = Math.sqrt([...A.values()].reduce((x, v) => x + v * v, 0));
  const nb = Math.sqrt([...B.values()].reduce((x, v) => x + v * v, 0));
  return na && nb ? dot / (na * nb) : 0;
}

/**
 * Perceptual difference hash (64-bit) — robust to re-encode/resize; mirrored variant also returned
 * so horizontal flips are caught.
 */
export async function dHash(image: Buffer | string): Promise<{ hash: bigint; flipped: bigint }> {
  const calc = async (flop: boolean) => {
    let img = sharp(image).greyscale();
    if (flop) img = img.flop();
    const px = await img.resize(9, 8, { fit: "fill" }).raw().toBuffer();
    let h = 0n;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h = (h << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
    return h;
  };
  return { hash: await calc(false), flipped: await calc(true) };
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Centre-crop tolerant comparison: compare hashes of the full frame and a 80% centre crop. */
export async function imageSimilarity(a: Buffer | string, b: Buffer | string): Promise<number> {
  const crop = async (src: Buffer | string) => {
    const m = await sharp(src).metadata();
    const w = Math.floor((m.width ?? 100) * 0.8);
    const h = Math.floor((m.height ?? 100) * 0.8);
    return sharp(src)
      .extract({ left: Math.floor(((m.width ?? 100) - w) / 2), top: Math.floor(((m.height ?? 100) - h) / 2), width: w, height: h })
      .toBuffer();
  };
  const [ha, hb, hac, hbc] = await Promise.all([dHash(a), dHash(b), dHash(await crop(a)), dHash(await crop(b))]);
  const best = Math.min(
    hamming(ha.hash, hb.hash),
    hamming(ha.hash, hb.flipped),
    hamming(hac.hash, hb.hash),
    hamming(ha.hash, hbc.hash),
    hamming(hac.hash, hbc.hash),
    hamming(hac.hash, hbc.flipped),
  );
  return 1 - best / 64;
}
