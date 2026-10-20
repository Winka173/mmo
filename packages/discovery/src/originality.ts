import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { nowIso } from "@ttm/core";
import { DataStore, appendJsonl, readJsonl, sha256File, writeJsonAtomic } from "@ttm/storage";
import sharp from "sharp";
import { productKey } from "./duplicates.js";
import { canonicalUrl, cosine, hamming, jaccard, normalizeText } from "./similarity.js";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

function run(args: string[], timeoutMs = 10 * 60_000): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const c = spawn(FFMPEG, args, { windowsHide: true });
    const out: Buffer[] = [];
    let err = "";
    c.stdout.on("data", (d) => out.push(d));
    c.stderr.on("data", (d) => (err = (err + d.toString()).slice(-4000)));
    const t = setTimeout(() => c.kill("SIGKILL"), timeoutMs);
    c.on("error", reject);
    c.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? -1, stdout: Buffer.concat(out), stderr: err });
    });
  });
}

export type VideoFingerprint = { frames: { full: string; flipped: string; crop: string }[]; everySec: number };
export type AudioFingerprint = { envelope: number[]; hopSec: number } | null;

async function dhashBuf(buf: Buffer, flop = false, crop = false): Promise<bigint> {
  let img = sharp(buf).greyscale();
  if (crop) {
    const m = await sharp(buf).metadata();
    const w = Math.floor((m.width ?? 64) * 0.7);
    const h = Math.floor((m.height ?? 64) * 0.7);
    img = sharp(buf).extract({ left: Math.floor(((m.width ?? 64) - w) / 2), top: Math.floor(((m.height ?? 64) - h) / 2), width: w, height: h }).greyscale();
  }
  if (flop) img = img.flop();
  const px = await img.resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let h = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h = (h << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  return h;
}

/** Sampled perceptual frame hashes (full + mirrored + centre crop) — robust to re-encode/resize/crop/flip. */
export async function videoFingerprint(file: string, opts: { everySec?: number; maxFrames?: number } = {}): Promise<VideoFingerprint> {
  const every = opts.everySec ?? 1;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ttm-vfp-"));
  try {
    const r = await run(["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `fps=1/${every},scale=160:-2`, "-frames:v", String(opts.maxFrames ?? 90), path.join(tmp, "f-%04d.png")]);
    if (r.code !== 0) throw new Error(`không lấy được khung hình: ${r.stderr.slice(-200)}`);
    const frames = [];
    for (const f of (await fs.readdir(tmp)).sort()) {
      const buf = await fs.readFile(path.join(tmp, f));
      frames.push({ full: (await dhashBuf(buf)).toString(16), flipped: (await dhashBuf(buf, true)).toString(16), crop: (await dhashBuf(buf, false, true)).toString(16) });
    }
    return { frames, everySec: every };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** Coarse audio fingerprint: RMS energy envelope (100 ms hops, 8 kHz mono). Null if no audio. */
export async function audioFingerprint(file: string): Promise<AudioFingerprint> {
  const r = await run(["-hide_banner", "-loglevel", "error", "-i", file, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]);
  if (r.code !== 0 || r.stdout.length < 1600) return null;
  const hop = 800;
  const env: number[] = [];
  for (let i = 0; i + hop * 2 <= r.stdout.length; i += hop * 2) {
    let s = 0;
    for (let j = i; j < i + hop * 2; j += 2) {
      const v = r.stdout.readInt16LE(j) / 32768;
      s += v * v;
    }
    env.push(Math.round(Math.sqrt(s / hop) * 10000) / 10000);
  }
  return { envelope: env, hopSec: 0.1 };
}

/** Best alignment of two frame-hash sequences (offset search); ratio of matched frames. */
export function compareVideo(a: VideoFingerprint, b: VideoFingerprint): number {
  if (!a.frames.length || !b.frames.length) return 0;
  const A = a.frames.map((f) => [BigInt(`0x${f.full}`), BigInt(`0x${f.flipped}`), BigInt(`0x${f.crop}`)]);
  const B = b.frames.map((f) => [BigInt(`0x${f.full}`), BigInt(`0x${f.flipped}`), BigInt(`0x${f.crop}`)]);
  const close = (x: bigint[], y: bigint[]) => Math.min(hamming(x[0], y[0]), hamming(x[1], y[0]), hamming(x[0], y[1]), hamming(x[2], y[0]), hamming(x[0], y[2]), hamming(x[2], y[2])) <= 10;
  let best = 0;
  for (let off = -(B.length - 1); off < A.length; off++) {
    let m = 0;
    let n = 0;
    for (let i = 0; i < A.length; i++) {
      const j = i - off;
      if (j < 0 || j >= B.length) continue;
      n++;
      if (close(A[i], B[j])) m++;
    }
    if (n >= Math.min(3, A.length, B.length)) best = Math.max(best, m / Math.min(A.length, B.length));
  }
  return Math.round(best * 1000) / 1000;
}

/** Normalised cross-correlation of energy envelopes (max over lag); 0..1. */
export function compareAudio(a: AudioFingerprint, b: AudioFingerprint): number {
  if (!a || !b || a.envelope.length < 10 || b.envelope.length < 10) return 0;
  const norm = (x: number[]) => {
    const d = x.slice(1).map((v, i) => v - x[i]); // derivative: robust to gain changes
    const m = d.reduce((s, v) => s + v, 0) / d.length;
    const sd = Math.sqrt(d.reduce((s, v) => s + (v - m) ** 2, 0) / d.length) || 1;
    return d.map((v) => (v - m) / sd);
  };
  const A = norm(a.envelope);
  const B = norm(b.envelope);
  let best = 0;
  const maxLag = Math.min(150, Math.max(A.length, B.length));
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let s = 0;
    let n = 0;
    for (let i = 0; i < A.length; i++) {
      const j = i + lag;
      if (j < 0 || j >= B.length) continue;
      s += A[i] * B[j];
      n++;
    }
    if (n >= 20) best = Math.max(best, s / n);
  }
  return Math.round(Math.max(0, best) * 1000) / 1000;
}

/** Longest common subsequence ratio of scene-kind sequences ("storyline structure"). */
export function structureSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length] / Math.max(a.length, b.length);
}

/** Language-agnostic anchors (numbers, latin names, units) — help cross-language matching without a translator. */
export function anchors(text: string): Set<string> {
  const t = text.normalize("NFKC").toLowerCase();
  const out = new Set<string>();
  for (const m of t.matchAll(/\d+([.,]\d+)?/g)) out.add(m[0].replace(",", "."));
  for (const m of t.matchAll(/[a-z][a-z0-9-]{2,}/g)) out.add(m[0]);
  return out;
}

export type OriginalityEntry = {
  id: string;
  kind: "owned_post" | "draft" | "source" | "market";
  projectId: string | null;
  lineageId: string | null;
  owner: string;
  sha256: string | null;
  video: VideoFingerprint | null;
  audio: AudioFingerprint;
  title: string;
  hook: string;
  /** transcript/script, plus the Vietnamese concept for foreign sources */
  text: string;
  conceptVi: string | null;
  language: string;
  structure: string[];
  productKeys: string[];
  urls: string[];
  /** media rights proven for this entry (owned/licensed) — separate from novelty */
  ownedOrLicensed: boolean;
  at: string;
};

export type OriginalityMatch = { against: string; againstKind: OriginalityEntry["kind"]; level: string; score: number; evidence: string };

export type OriginalityReport = {
  projectId: string;
  checkedAt: string;
  checkedAgainst: number;
  matches: OriginalityMatch[];
  maxScore: number;
  novelty: number;
  decision: "ORIGINAL" | "OWN_CONTENT_DISTRIBUTION" | "NEEDS_REVIEW" | "DUPLICATE_BLOCK";
  reasons: string[];
  rightsNote: string;
  override: { by: string; reason: string; at: string } | null;
  limitation: string;
};

const THRESHOLDS = { exact: 1, video: 0.6, audio: 0.75, text: 0.55, hook: 0.8, structure: 0.95, anchors: 0.6 };

/**
 * CrossPlatformOriginalityEngine (spec V1). Compares a project against owned posts, drafts, the
 * local source library and lawfully-collected public metadata at several levels. Novelty is kept
 * SEPARATE from copyright permission: an obscure account's video is never "free to use". The
 * user's OWN content across platforms (same lineage) is legitimate distribution, not a duplicate.
 */
export class OriginalityEngine {
  constructor(private readonly store: DataStore, private readonly thresholds = THRESHOLDS) {}

  private file() {
    return this.store.p("registry", "originality", "index.jsonl");
  }

  async entries(): Promise<OriginalityEntry[]> {
    const { records } = await readJsonl<OriginalityEntry>(this.file());
    const byId = new Map<string, OriginalityEntry>();
    for (const r of records) byId.set(r.id, r); // last write wins (append-only log)
    return [...byId.values()];
  }

  async add(e: OriginalityEntry): Promise<void> {
    await appendJsonl(this.file(), e);
  }

  /** Build an entry from media + text (fingerprints computed locally). */
  async fingerprint(x: Omit<OriginalityEntry, "sha256" | "video" | "audio" | "at"> & { file?: string | null }): Promise<OriginalityEntry> {
    const { file, ...rest } = x;
    return {
      ...rest,
      sha256: file ? await sha256File(file) : null,
      video: file ? await videoFingerprint(file).catch(() => null) : null,
      audio: file ? await audioFingerprint(file).catch(() => null) : null,
      at: nowIso(),
    };
  }

  compare(cand: OriginalityEntry, others: OriginalityEntry[]): OriginalityMatch[] {
    const m: OriginalityMatch[] = [];
    const ct = normalizeText(cand.conceptVi ?? cand.text);
    const ca = anchors(`${cand.title} ${cand.text} ${cand.conceptVi ?? ""}`);
    for (const o of others) {
      if (o.id === cand.id) continue;
      const push = (level: string, score: number, evidence: string) => m.push({ against: o.id, againstKind: o.kind, level, score: Math.round(score * 1000) / 1000, evidence });
      if (cand.sha256 && o.sha256 === cand.sha256) push("sha256", 1, "file giống hệt (SHA256)");
      if (cand.video && o.video) {
        const v = compareVideo(cand.video, o.video);
        if (v >= this.thresholds.video) push("video_phash", v, `${Math.round(v * 100)}% khung hình khớp (chống crop/lật/nén lại)`);
      }
      if (cand.audio && o.audio) {
        const a = compareAudio(cand.audio, o.audio);
        if (a >= this.thresholds.audio) push("audio_envelope", a, `đường năng lượng âm thanh tương quan ${Math.round(a * 100)}%`);
      }
      const ot = normalizeText(o.conceptVi ?? o.text);
      const txt = Math.max(jaccard(ct, ot), cosine(ct, ot));
      if (txt >= this.thresholds.text) push(cand.language !== o.language ? "cross_language_concept" : "script_text", txt, `kịch bản/khái niệm giống ${Math.round(txt * 100)}%${cand.language !== o.language ? ` (${o.language}→${cand.language})` : ""}`);
      const hook = Math.max(jaccard(cand.hook, o.hook), cosine(cand.hook, o.hook));
      if (cand.hook && o.hook && hook >= this.thresholds.hook) push("reused_hook", hook, `hook lặp lại: “${o.hook.slice(0, 60)}”`);
      const head = Math.max(jaccard(cand.title, o.title), cosine(cand.title, o.title));
      if (head >= this.thresholds.text) push("headline", head, `tiêu đề giống: “${o.title.slice(0, 60)}”`);
      if (cand.structure.length >= 4 && o.structure.length >= 4) {
        const st = structureSimilarity(cand.structure, o.structure);
        if (st >= this.thresholds.structure && txt >= 0.3) push("storyline_structure", st * 0.7, "cấu trúc cảnh + nội dung gần như giống");
      }
      const oa = anchors(`${o.title} ${o.text} ${o.conceptVi ?? ""}`);
      const inter = [...ca].filter((x) => oa.has(x));
      if (ca.size >= 3 && inter.length / Math.min(ca.size, oa.size || 1) >= this.thresholds.anchors && inter.length >= 3) push("anchors_numbers_names", 0.6, `trùng mốc số/tên: ${inter.slice(0, 6).join(", ")}`);
      for (const p of cand.productKeys) if (o.productKeys.includes(p)) push("product_id", 0.9, `cùng sản phẩm ${p}`);
      for (const u of cand.urls) if (o.urls.includes(u)) push("canonical_url", 1, `cùng nguồn ${u}`);
    }
    return m.sort((a, b) => b.score - a.score);
  }

  /**
   * Decide. Same lineage/project => own multi-platform distribution (allowed). Matches against a
   * non-owned source/market item with media/script copying => block/review even if the source
   * account is small. Overrides need a human reason and are recorded.
   */
  async check(cand: OriginalityEntry, opts: { minNovelty?: number } = {}): Promise<OriginalityReport> {
    const all = await this.entries();
    const matches = this.compare(cand, all);
    const prev = await this.read(cand.projectId ?? cand.id);
    const own = (o: OriginalityEntry | undefined) => !!o && ((cand.lineageId && o.lineageId === cand.lineageId) || (cand.projectId && o.projectId === cand.projectId));
    const byId = new Map(all.map((e) => [e.id, e]));
    const foreign = matches.filter((x) => !own(byId.get(x.against)));
    const mediaCopy = foreign.filter((x) => ["sha256", "video_phash", "audio_envelope"].includes(x.level));
    const maxScore = foreign.reduce((a, x) => Math.max(a, x.score), 0);
    const novelty = Math.round((1 - maxScore) * 100) / 100;
    const reasons: string[] = [];
    let decision: OriginalityReport["decision"];
    if (!matches.length) decision = "ORIGINAL";
    else if (!foreign.length) {
      decision = "OWN_CONTENT_DISTRIBUTION";
      reasons.push("chỉ trùng với nội dung của chính bạn cùng lineage (phân phối đa nền tảng hợp lệ)");
    } else if (mediaCopy.some((x) => byId.get(x.against)?.kind !== "owned_post" && byId.get(x.against)?.kind !== "draft" && !byId.get(x.against)?.ownedOrLicensed)) {
      decision = "DUPLICATE_BLOCK";
      reasons.push("media trùng với nguồn KHÔNG thuộc quyền sở hữu — tài khoản ít người biết không có nghĩa là được dùng");
    } else if (mediaCopy.length) {
      decision = "NEEDS_REVIEW";
      reasons.push("media trùng với bài/bản nháp khác của kênh (có thể đăng trùng) — xác nhận đây là bản phái sinh có chủ đích");
    } else if (novelty < (opts.minNovelty ?? 0.4)) {
      decision = "NEEDS_REVIEW";
      reasons.push(`độ mới ${novelty} thấp: ý tưởng/kịch bản gần với ${foreign[0].against} — cần góc nhìn mới thật sự (không chỉ dịch + lồng tiếng)`);
    } else decision = "ORIGINAL";
    const report: OriginalityReport = {
      projectId: cand.projectId ?? cand.id,
      checkedAt: nowIso(),
      checkedAgainst: all.length,
      matches,
      maxScore,
      novelty,
      decision,
      reasons,
      rightsNote: "Độ mới ≠ quyền sử dụng. Quyền media được kiểm tra riêng ở rights gate.",
      override: prev?.override && prev.decision === decision ? prev.override : null,
      limitation: "Kết quả chỉ là 'không thấy trong các nguồn đã kiểm tra' — không đảm bảo không ai từng đăng.",
    };
    if (cand.projectId) await writeJsonAtomic(this.store.p("projects", cand.projectId, "originality-report.json"), report);
    return report;
  }

  async read(projectId: string): Promise<OriginalityReport | null> {
    return fs.readFile(this.store.p("projects", projectId, "originality-report.json"), "utf8").then((s) => JSON.parse(s), () => null);
  }

  /** False-positive override with reason (recorded, audited). Never applies to DUPLICATE_BLOCK of foreign media. */
  async override(projectId: string, by: string, reason: string): Promise<OriginalityReport> {
    const r = await this.read(projectId);
    if (!r) throw new Error("chưa có báo cáo originality");
    if (r.decision === "DUPLICATE_BLOCK") throw new Error("Không thể bỏ qua: media trùng nguồn không thuộc quyền — cần bằng chứng quyền (rights gate), không phải override originality");
    if (reason.trim().length < 10) throw new Error("Cần lý do cụ thể (≥10 ký tự)");
    r.override = { by, reason, at: nowIso() };
    await writeJsonAtomic(this.store.p("projects", projectId, "originality-report.json"), r);
    await this.store.audit({ actor: by, action: "originality.override", subject: projectId, detail: { reason, decision: r.decision } });
    return r;
  }
}

export function originalityGate(r: OriginalityReport | null): { ok: boolean; hold: "HOLD_POLICY" | "HOLD_RIGHTS" | null; reasons: string[] } {
  if (!r) return { ok: true, hold: null, reasons: [] };
  if (r.decision === "DUPLICATE_BLOCK") return { ok: false, hold: "HOLD_RIGHTS", reasons: r.reasons };
  if (r.decision === "NEEDS_REVIEW" && !r.override) return { ok: false, hold: "HOLD_POLICY", reasons: r.reasons };
  return { ok: true, hold: null, reasons: [] };
}

export const productKeysOf = (titles: string[]) => titles.map(productKey);
export const canonicalUrls = (urls: string[]) => urls.flatMap((u) => {
  try {
    return [canonicalUrl(u)];
  } catch {
    return [];
  }
});
