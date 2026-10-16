import type { Candle } from '@/lib/detect/types';
import type { Preset } from '@/lib/presets/types';

export interface WickShape {
  id: 'Upper wick' | 'Lower wick';
  x: number;
  y1: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
}

export interface BodyShape {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Solid bar for flat candles: filled with the border colour, no stroke. */
  bar: boolean;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface CandleShape {
  name: string;
  wicks: WickShape[];
  body: BodyShape;
}

/** "Candle 01", "Candle 02", ... Figma uses SVG ids as layer names. */
export function candleName(index: number): string {
  return `Candle ${String(index + 1).padStart(2, '0')}`;
}

/**
 * The shapes for one candle, shared by the live overlay and the SVG export so they always
 * match. All values are in source pixels.
 *
 * The body rect is inset by half the border width so the outer edge of the border lands on
 * the measured edge. Wicks are two separate segments that stop at the body's outer edge,
 * never one line through the body.
 */
export function candleShape(c: Candle, index: number, preset: Preset): CandleShape {
  const colors = preset[c.type];
  const body = c.colorOverride?.body ?? colors.body;
  const border = c.colorOverride?.border ?? colors.border;
  const wick = c.colorOverride?.wick ?? colors.wick;
  const bw = preset.borderWidth;
  const width = c.bodyRight - c.bodyLeft;
  const height = c.bodyBottom - c.bodyTop;

  let shape: BodyShape;
  if (c.isDoji || height - bw <= 0 || width - bw <= 0) {
    // Flat candle: a minimum-height bar, as thick as the border, at the measured position.
    const mid = (c.bodyTop + c.bodyBottom) / 2;
    shape = {
      x: c.bodyLeft,
      y: mid - bw / 2,
      width,
      height: bw,
      bar: true,
      fill: border,
      stroke: border,
      strokeWidth: 0,
    };
  } else {
    shape = {
      x: c.bodyLeft + bw / 2,
      y: c.bodyTop + bw / 2,
      width: width - bw,
      height: height - bw,
      bar: false,
      fill: body,
      stroke: border,
      strokeWidth: bw,
    };
  }

  const outerTop = shape.bar ? shape.y : c.bodyTop;
  const outerBottom = shape.bar ? shape.y + shape.height : c.bodyBottom;
  const wicks: WickShape[] = [];
  if (c.wickTop !== null && outerTop - c.wickTop > 0) {
    wicks.push({
      id: 'Upper wick',
      x: c.centerX,
      y1: c.wickTop,
      y2: outerTop,
      stroke: wick,
      strokeWidth: preset.wickWidth,
    });
  }
  if (c.wickBottom !== null && c.wickBottom - outerBottom > 0) {
    wicks.push({
      id: 'Lower wick',
      x: c.centerX,
      y1: outerBottom,
      y2: c.wickBottom,
      stroke: wick,
      strokeWidth: preset.wickWidth,
    });
  }
  return { name: candleName(index), wicks, body: shape };
}
