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
  /** Which of the chart's (at most two) colour groups this candle belongs to. */
  group?: number;
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

/** Anything on the chart that is not a candle, drawn as plain vector shapes. Source pixels. */
export interface LineExtra {
  kind: 'line';
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** "#RRGGBB" */
  color: string;
  width: number;
  /** [dash, gap] in pixels for dashed and dotted lines. null = solid. */
  dash: [number, number] | null;
}

export interface BoxExtra {
  kind: 'box';
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** "#RRGGBB", as it looks on the chart (already blended with the background). */
  fill: string;
}

export interface TextExtra {
  kind: 'text';
  id: string;
  /** Left edge and baseline of the text. */
  x: number;
  y: number;
  text: string;
  /** Font size in pixels. */
  size: number;
  /** Font weight (400 regular, 500 medium, 600 semi-bold, 700 bold), judged from the stems. */
  weight?: number;
  color: string;
  /** Where the label sits now (it follows the label when it is moved). */
  region: { x: number; y: number; width: number; height: number };
  /** Where its letters are in the screenshot (what OCR reads). Never changes. */
  from?: { x: number; y: number; width: number; height: number };
  /** The text could not be read: the user has to type it. */
  unread: boolean;
  /**
   * The letters as they look in the screenshot, as an SVG path (pixel squares). Exported in
   * place of the text while nothing has been typed, so the label is never lost.
   */
  trace?: string;
}

/**
 * A ring of dots (the PSP marker): one shape, never single dots. Source pixels.
 * Dot i sits at angle phase + i * 2π / dots, at distance r from the centre.
 */
export interface MarkerExtra {
  kind: 'marker';
  id: string;
  cx: number;
  cy: number;
  /** Distance from the centre to each dot's centre. */
  r: number;
  /** Radius of one dot. */
  dotR: number;
  /** Angle of the empty place in the ring, radians (0 = right, clockwise on screen). */
  phase: number;
  /** "#RRGGBB" */
  color: string;
  /** Where it is in the screenshot. Never changes; covered so the original does not show. */
  from?: { cx: number; cy: number; r: number };
}

export type Extra = LineExtra | BoxExtra | TextExtra | MarkerExtra;

/** How bull and bear were told apart: which colour group means "rising". */
export interface Direction {
  /** The two colour groups. colours is null when a group has no candles. */
  groups: Array<{ colours: CandleColors | null; count: number }>;
  /** The group that was judged to be rising. */
  upGroup: 0 | 1;
  source: 'structure' | 'colour' | 'prior' | 'remembered' | 'user';
  /** False when the chart gave no real answer: the person should be asked. */
  sure: boolean;
}

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
  /** Which colour is rising and how that was decided. */
  direction?: Direction;
  /** Lines, boxes and labels found next to the candles. */
  extras: Extra[];
  /** Whether the image holds only candles. Lines, shapes or text make it "not clean". */
  cleanliness: CleanReport;
}
