import type { Rgb } from '@/lib/color/lab';

export type CandleType = 'bull' | 'bear';

export interface CandleColors {
  body: string;
  border: string;
  wick: string;
}

/**
 * All geometry is in source-image pixels. Pixel i covers [i, i + 1], so a pixel centre
 * is i + 0.5 and an edge that "starts at pixel i" sits at x = i.
 */
export interface Candle {
  id: string;
  centerX: number;
  bodyLeft: number;
  bodyRight: number;
  bodyTop: number;
  bodyBottom: number;
  /** null = no upper wick */
  wickTop: number | null;
  /** null = no lower wick */
  wickBottom: number | null;
  type: CandleType;
  isDoji: boolean;
  /** 0..1. Below 0.7 is flagged for review. */
  confidence: number;
  colorOverride?: Partial<CandleColors>;
}

/** RGBA pixels, row-major, 4 bytes per pixel. Same shape as the browser's ImageData. */
export interface PixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface DetectSettings {
  /** ΔE where coverage starts (default 8). */
  tLow: number;
  /** ΔE where coverage is full (default 40). */
  tHigh: number;
  uniformBodyWidth: boolean;
  lightBodyIsBull: boolean;
}

export const DEFAULT_SETTINGS: DetectSettings = {
  tLow: 8,
  tHigh: 40,
  uniformBodyWidth: true,
  lightBodyIsBull: true,
};

export const LOW_CONFIDENCE = 0.7;

export interface DetectionResult {
  candles: Candle[];
  background: Rgb;
  /** Median body width before "uniform width" is applied. */
  medianBodyWidth: number | null;
  /** Measured border thickness of hollow bodies, in source pixels. null if none were hollow. */
  sourceBorderWidth: number | null;
  /** Measured wick thickness, in source pixels. */
  sourceWickWidth: number | null;
}
