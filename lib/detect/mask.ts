import type { CandleExtent } from './clean';

export interface CandleMask {
  /** 1 = inside a candle's body or wick, plus a margin for blur. */
  area: Uint8Array;
  /** 1 = inside a candle's body rectangle itself (no margin). */
  body: Uint8Array;
}

/** Marks where the candles are, so that whatever is outside can be looked at on its own. */
export function candleMask(
  candles: CandleExtent[],
  width: number,
  height: number,
  margin: number,
): CandleMask {
  const area = new Uint8Array(width * height);
  const body = new Uint8Array(width * height);
  const fill = (target: Uint8Array, x0: number, x1: number, y0: number, y1: number) => {
    const a = Math.max(0, Math.floor(x0));
    const b = Math.min(width - 1, Math.ceil(x1) - 1);
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(height - 1, Math.ceil(y1) - 1); y++) {
      if (b >= a) target.fill(1, y * width + a, y * width + b + 1);
    }
  };
  for (const c of candles) {
    fill(
      area,
      c.bodyLeft - margin,
      c.bodyRight + margin,
      c.bodyTop - margin,
      c.bodyBottom + margin,
    );
    fill(
      area,
      c.centerX - 1.5 - margin,
      c.centerX + 1.5 + margin,
      (c.wickTop ?? c.bodyTop) - margin,
      (c.wickBottom ?? c.bodyBottom) + margin,
    );
    fill(body, c.bodyLeft, c.bodyRight, c.bodyTop, c.bodyBottom);
  }
  return { area, body };
}
