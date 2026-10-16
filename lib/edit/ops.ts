import type { Candle, CandleColors } from '@/lib/detect/types';

/** Edge values the user can change. */
export type EdgeKey =
  'bodyTop' | 'bodyBottom' | 'bodyLeft' | 'bodyRight' | 'wickTop' | 'wickBottom';

/** Smallest width a body can have after an edit or a split. */
const MIN_BODY_WIDTH = 1;
/** A manually edited candle is one the user has reviewed, so its review flag goes away. */
const REVIEWED = 1;

let counter = 0;
/** Unique candle id. */
export function newCandleId(): string {
  counter += 1;
  return `candle-m${Date.now().toString(36)}${counter}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Changing type drops the candle's own measured colours: it now looks like its new type. */
function withType(c: Candle, type: Candle['type']): Candle {
  const { sourceColors: _dropped, ...rest } = c;
  void _dropped;
  return { ...rest, type, confidence: REVIEWED };
}

export function flipType(c: Candle): Candle {
  return withType(c, c.type === 'bull' ? 'bear' : 'bull');
}

export function setType(c: Candle, type: Candle['type']): Candle {
  return c.type === type ? c : withType(c, type);
}

/**
 * Moves one edge, keeping the shape valid: top above bottom, wicks outside the body.
 * Setting a wick edge that does not exist yet creates the wick. Pass null to remove a wick.
 */
export function setEdge(c: Candle, key: EdgeKey, value: number | null): Candle {
  const next: Candle = { ...c, confidence: REVIEWED };
  if (key === 'wickTop' || key === 'wickBottom') {
    if (value === null) {
      next[key] = null;
    } else {
      const v = round2(value);
      next[key] = key === 'wickTop' ? Math.min(v, c.bodyTop) : Math.max(v, c.bodyBottom);
    }
    return next;
  }
  if (value === null || !Number.isFinite(value)) return c;
  const v = round2(value);
  switch (key) {
    case 'bodyTop':
      next.bodyTop = Math.min(v, c.bodyBottom);
      if (next.wickTop !== null) next.wickTop = Math.min(next.wickTop, next.bodyTop);
      break;
    case 'bodyBottom':
      next.bodyBottom = Math.max(v, c.bodyTop);
      if (next.wickBottom !== null) next.wickBottom = Math.max(next.wickBottom, next.bodyBottom);
      break;
    case 'bodyLeft':
      next.bodyLeft = Math.min(v, c.bodyRight - MIN_BODY_WIDTH);
      next.centerX = round2((next.bodyLeft + next.bodyRight) / 2);
      break;
    case 'bodyRight':
      next.bodyRight = Math.max(v, c.bodyLeft + MIN_BODY_WIDTH);
      next.centerX = round2((next.bodyLeft + next.bodyRight) / 2);
      break;
  }
  next.isDoji = next.bodyBottom - next.bodyTop < 2;
  return next;
}

/** Sets or clears one colour override. Pass null to drop that single override. */
export function setColorOverride(c: Candle, key: keyof CandleColors, value: string | null): Candle {
  const override: Partial<CandleColors> = { ...c.colorOverride };
  if (value === null) delete override[key];
  else override[key] = value;
  const next: Candle = { ...c };
  if (Object.keys(override).length === 0) delete next.colorOverride;
  else next.colorOverride = override;
  return next;
}

/** "Reset to preset": removes every override from the candle. */
export function resetOverride(c: Candle): Candle {
  if (!c.colorOverride) return c;
  const next: Candle = { ...c };
  delete next.colorOverride;
  return next;
}

/**
 * Splits a wrongly merged candle at source x. Both halves keep the vertical shape and type;
 * the user then adjusts them. Returns null if x is too close to either edge.
 */
export function splitCandle(c: Candle, x: number): [Candle, Candle] | null {
  const margin = MIN_BODY_WIDTH + 1;
  if (x < c.bodyLeft + margin || x > c.bodyRight - margin) return null;
  const make = (left: number, right: number): Candle => ({
    ...c,
    id: newCandleId(),
    bodyLeft: round2(left),
    bodyRight: round2(right),
    centerX: round2((left + right) / 2),
    confidence: REVIEWED,
  });
  return [make(c.bodyLeft, x), make(x, c.bodyRight)];
}

/** Merges a wrongly split candle: the union of both shapes. Type follows the wider one. */
export function mergeCandles(a: Candle, b: Candle): Candle {
  const left = Math.min(a.bodyLeft, b.bodyLeft);
  const right = Math.max(a.bodyRight, b.bodyRight);
  const wider = a.bodyRight - a.bodyLeft >= b.bodyRight - b.bodyLeft ? a : b;
  const tops = [a.wickTop, b.wickTop].filter((v): v is number => v !== null);
  const bottoms = [a.wickBottom, b.wickBottom].filter((v): v is number => v !== null);
  const bodyTop = Math.min(a.bodyTop, b.bodyTop);
  const bodyBottom = Math.max(a.bodyBottom, b.bodyBottom);
  const merged: Candle = {
    ...wider,
    id: newCandleId(),
    centerX: round2((left + right) / 2),
    bodyLeft: round2(left),
    bodyRight: round2(right),
    bodyTop,
    bodyBottom,
    wickTop: tops.length ? Math.min(...tops, bodyTop) : null,
    wickBottom: bottoms.length ? Math.max(...bottoms, bodyBottom) : null,
    isDoji: bodyBottom - bodyTop < 2,
    confidence: REVIEWED,
  };
  return merged;
}

/** Candles sorted left to right. */
export function sortByX(candles: Candle[]): Candle[] {
  return [...candles].sort((p, q) => p.centerX - q.centerX);
}
