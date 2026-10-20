import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FactoryError } from "@ttm/core";
import { audioDuration, ffmpeg, runProcess } from "./exec.js";

export type TtsLicense = { engine: string; voice: string; license: string; commercialUseOk: boolean; notes: string };

export interface TtsProvider {
  readonly id: string;
  readonly costPerCharUsd: number;
  available(): Promise<boolean>;
  license(): TtsLicense;
  /** Writes a 48 kHz mono WAV; returns seconds. */
  synthesize(text: string, outWav: string): Promise<number>;
}

/** Pronunciation lexicon: brand names, abbreviations, units. Applied before every TTS call. */
export const DEFAULT_LEXICON: [RegExp, string][] = [
  [/\bTủ Tò Mò\b/g, "Tủ Tò Mò"],
  [/\bShopee\b/gi, "Sốp pi"],
  [/\bYouTube\b/gi, "Diu túp"],
  [/\bTikTok\b/gi, "Tíc tốc"],
  [/\bAI\b/g, "ây ai"],
  [/\bNASA\b/g, "Na sa"],
  [/\bESA\b/g, "Ê sa"],
  [/\bkm\b/g, "ki lô mét"],
  [/\bkg\b/g, "ki lô gam"],
  [/°C/g, " độ xê"],
  [/%/g, " phần trăm"],
  [/\bMachine Brigade\b/g, "Mơ sin Bri gết"],
];

export function applyLexicon(text: string, lexicon = DEFAULT_LEXICON): string {
  return lexicon.reduce((t, [re, rep]) => t.replace(re, rep), text).replace(/\s+/g, " ").trim();
}

/**
 * Offline Vietnamese TTS via eSpeak NG. Engine is GPL-3.0; synthesized audio output is not a
 * derivative of the program, so commercial use of the WAV is permitted. Voice quality is robotic —
 * it is the guaranteed-offline fallback, not the recommended production voice.
 */
export class EspeakNgTts implements TtsProvider {
  readonly costPerCharUsd = 0;
  constructor(private readonly opts: { bin?: string; voice?: string; speedWpm?: number; pitch?: number; lexicon?: [RegExp, string][] } = {}) {}
  /** id includes voice settings so cached narration never leaks between brands/narrators */
  get id() {
    const v = this.opts;
    return v.voice || v.speedWpm || v.pitch ? `espeak-ng:${v.voice ?? "vi"}:${v.speedWpm ?? 165}:${v.pitch ?? 45}` : "espeak-ng";
  }
  private get bin() {
    return this.opts.bin ?? process.env.ESPEAK_PATH ?? "espeak-ng";
  }
  async available() {
    try {
      return (await runProcess(this.bin, ["--version"], { timeoutMs: 10_000 })).code === 0;
    } catch {
      return false;
    }
  }
  license(): TtsLicense {
    return {
      engine: "eSpeak NG",
      voice: this.opts.voice ?? "vi",
      license: "GPL-3.0-or-later (engine); generated audio not covered by GPL",
      commercialUseOk: true,
      notes: "Giọng tổng hợp formant, chất lượng thấp. Khuyến nghị nâng cấp giọng Piper/cloud có license thương mại rõ ràng.",
    };
  }
  async synthesize(text: string, outWav: string): Promise<number> {
    const raw = `${outWav}.raw.wav`;
    const r = await runProcess(this.bin, ["-v", this.opts.voice ?? "vi", "-s", String(this.opts.speedWpm ?? 165), "-p", String(this.opts.pitch ?? 45), "-w", raw, applyLexicon(text, [...(this.opts.lexicon ?? []), ...DEFAULT_LEXICON])], {
      timeoutMs: 120_000,
    });
    if (r.code !== 0) throw new FactoryError("TTS_FAILED", "RETRYABLE", `eSpeak NG lỗi: ${r.stderr.slice(-300)}`, { provider: this.id });
    await ffmpeg(["-i", raw, "-ar", "48000", "-ac", "1", "-af", "highpass=f=80,lowpass=f=9000", outWav]);
    await fs.rm(raw, { force: true });
    return audioDuration(outWav);
  }
}

/**
 * Piper (MIT engine) — local neural TTS. Each voice model has its own license in its MODEL_CARD;
 * set `voiceLicense` after reading it. Unknown license => commercialUseOk=false => rights gate holds.
 */
export class PiperTts implements TtsProvider {
  readonly id = "piper";
  readonly costPerCharUsd = 0;
  constructor(private readonly opts: { bin?: string; model: string; voiceLicense?: string; commercialUseOk?: boolean }) {}
  async available() {
    try {
      await fs.access(this.opts.model);
      return (await runProcess(this.opts.bin ?? "piper", ["--help"], { timeoutMs: 10_000 })).code === 0;
    } catch {
      return false;
    }
  }
  license(): TtsLicense {
    return {
      engine: "Piper",
      voice: path.basename(this.opts.model),
      license: this.opts.voiceLicense ?? "UNKNOWN — đọc MODEL_CARD của voice",
      commercialUseOk: this.opts.commercialUseOk ?? false,
      notes: "",
    };
  }
  async synthesize(text: string, outWav: string): Promise<number> {
    const raw = `${outWav}.raw.wav`;
    const r = await runProcess(this.opts.bin ?? "piper", ["--model", this.opts.model, "--output_file", raw], { input: applyLexicon(text), timeoutMs: 180_000 });
    if (r.code !== 0) throw new FactoryError("TTS_FAILED", "RETRYABLE", `Piper lỗi: ${r.stderr.slice(-300)}`, { provider: this.id });
    await ffmpeg(["-i", raw, "-ar", "48000", "-ac", "1", outWav]);
    await fs.rm(raw, { force: true });
    return audioDuration(outWav);
  }
}

/** Pick the first available provider; none => NEEDS_PROVIDER (never a fake silent voice). */
export async function pickTts(providers: TtsProvider[]): Promise<TtsProvider> {
  for (const p of providers) if (await p.available()) return p;
  throw new FactoryError("NEEDS_PROVIDER", "HUMAN_REQUIRED", "Chưa có TTS tiếng Việt khả dụng. Cài eSpeak NG hoặc cấu hình Piper (xem RUNBOOK.md).", {
    stage: "TTS",
    nextAction: "Cài espeak-ng (winget/choco) hoặc cấu hình giọng Piper",
  } as any);
}
