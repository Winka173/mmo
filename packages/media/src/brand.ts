import type { Format } from "@ttm/core";

export type BrandKit = {
  name: string;
  colors: { bg1: string; bg2: string; accent: string; text: string; muted: string; badge: string };
  fontFamily: string;
  tagline: string;
};

export const TU_TO_MO_BRAND: BrandKit = {
  name: "Tủ Tò Mò",
  colors: { bg1: "#14213D", bg2: "#0B132B", accent: "#FCA311", text: "#F5F0E6", muted: "#B8C1D9", badge: "#2EC4B6" },
  // Fonts with full Vietnamese diacritics coverage; first installed one wins (fontconfig / Windows).
  fontFamily: "'Be Vietnam Pro', 'Segoe UI', 'Noto Sans', 'DejaVu Sans', Arial, sans-serif",
  tagline: "Mở tủ — gặp điều thú vị",
};

export const MACHINE_BRIGADE_BRAND: BrandKit = {
  name: "Machine Brigade",
  colors: { bg1: "#1F2A1F", bg2: "#0E140E", accent: "#C8D44E", text: "#EEF2E3", muted: "#A9B39A", badge: "#E2702E" },
  fontFamily: TU_TO_MO_BRAND.fontFamily,
  tagline: "Devlog — đang phát triển",
};

export type FormatSpec = {
  width: number;
  height: number;
  fps: number;
  /** Platform UI overlays: keep text out of these margins. */
  safe: { top: number; bottom: number; left: number; right: number };
  subtitle: { fontSize: number; marginV: number };
  minSec: number;
  maxSec: number;
};

export const FORMAT_SPECS: Record<Format, FormatSpec> = {
  short_9x16: { width: 1080, height: 1920, fps: 30, safe: { top: 220, bottom: 480, left: 70, right: 140 }, subtitle: { fontSize: 64, marginV: 560 }, minSec: 8, maxSec: 60 },
  long_16x9: { width: 1920, height: 1080, fps: 30, safe: { top: 70, bottom: 150, left: 110, right: 110 }, subtitle: { fontSize: 52, marginV: 70 }, minSec: 60, maxSec: 12 * 60 },
};
