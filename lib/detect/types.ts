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
  /**
   * This candle's own colours, measured from the screenshot. Only set when they differ from
   * the usual colours of its type (see DetectionResult.sourceStyle); used by "Original colours".
   */
  sourceColors?: CandleColors;
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
  /**
   * The screenshot is a JPEG or lossy WebP. Compression blurs the colour of 1 px lines, so a
   * border that is nearly the fill's colour is read as the fill's colour. Not a user setting.
   */
  lossySource?: boolean;
}

export const DEFAULT_SETTINGS: DetectSettings = {
  tLow: 8,
  tHigh: 40,
  uniformBodyWidth: true,
  lightBodyIsBull: true,
};

export const LOW_CONFIDENCE = 0.7;

/** The look of the screenshot itself: what "Original colours" draws with. */
export interface SourceStyle {
  /** Typical colours of the bull and bear candles. null if the image has none of that type. */
  bull: CandleColors | null;
  bear: CandleColors | null;
  /** Measured line widths in source pixels. */
  borderWidth: number;
  wickWidth: number;
  /** The chart's background colour. */
  background: string;
}

import type { CleanReport } from './clean';

export interface DetectionResult {
  candles: Candle[];
  background: Rgb;
  /** Median body width before "uniform width" is applied. */
  medianBodyWidth: number | null;
  /** Measured border thickness of hollow bodies, in source pixels. null if none were hollow. */
  sourceBorderWidth: number | null;
  /** Measured wick thickness, in source pixels. */
  sourceWickWidth: number | null;
  sourceStyle: SourceStyle;
  /** Whether the image holds only candles. Lines, shapes or text make it "not clean". */
  cleanliness: CleanReport;
}
