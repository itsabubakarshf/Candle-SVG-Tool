import { deltaE, rgbToHueSat, rgbToLab, type Lab, type Rgb } from '@/lib/color/lab';
import { overWhite } from './background';
import type { Measured } from './measure';
import type { CandleType, DetectSettings, PixelImage } from './types';

const SATURATED_CHROMA = 25;
const NEUTRAL_CHROMA = 12;
const LIGHT_L = 55;

/**
 * Mean colour of the body interior, inset 2 px from the measured edges.
 * Small bodies get a smaller inset (1 px, then none) so a hollow 3 px candle is still
 * judged by its fill and not by its border.
 */
export interface InteriorSample {
  rgb: Rgb;
  /** True when the body was too small to sample inside the border. */
  borderOnly: boolean;
}

export function sampleInterior(image: PixelImage, m: Measured, background: Rgb): InteriorSample {
  const { width, height, data } = image;
  for (const inset of [2, 1, 0]) {
    // 0.3 px of slack so an edge measured at 14.9985 still counts as 15.
    const xa = Math.ceil(m.bodyLeft + inset - 0.3);
    const xb = Math.floor(m.bodyRight - inset + 0.3) - 1;
    const ya = Math.ceil(m.bodyTop + inset - 0.3);
    const yb = Math.floor(m.bodyBottom - inset + 0.3) - 1;
    if (xa > xb || ya > yb) continue;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = Math.max(0, ya); y <= Math.min(height - 1, yb); y++) {
      for (let x = Math.max(0, xa); x <= Math.min(width - 1, xb); x++) {
        const i = (y * width + x) * 4;
        const a = data[i + 3] as number;
        r += overWhite(data[i] as number, a);
        g += overWhite(data[i + 1] as number, a);
        b += overWhite(data[i + 2] as number, a);
        n++;
      }
    }
    if (n > 0) return { rgb: [r / n, g / n, b / n], borderOnly: inset === 0 };
  }
  // Too small for any interior (a flat candle): read the row that is most covered by the
  // line, then undo the blend with the background to recover the line's own colour.
  let bestRow = Math.floor(m.bodyTop);
  let bestOverlap = -1;
  for (
    let y = Math.floor(m.bodyTop);
    y < Math.max(Math.ceil(m.bodyBottom), Math.floor(m.bodyTop) + 1);
    y++
  ) {
    const overlap = Math.min(m.bodyBottom, y + 1) - Math.max(m.bodyTop, y);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestRow = y;
    }
  }
  const row = Math.min(height - 1, Math.max(0, bestRow));
  const xa = Math.max(0, Math.ceil(m.bodyLeft));
  const xb = Math.min(width - 1, Math.max(xa, Math.floor(m.bodyRight) - 1));
  const sum: Rgb = [0, 0, 0];
  let n = 0;
  for (let x = xa; x <= xb; x++) {
    const i = (row * width + x) * 4;
    const a = data[i + 3] as number;
    for (let c = 0; c < 3; c++) sum[c] = (sum[c] as number) + overWhite(data[i + c] as number, a);
    n++;
  }
  const cover = Math.max(0.2, Math.min(1, bestOverlap));
  const rgb = sum.map((v, c) => {
    const mean = v / Math.max(1, n);
    const bg = background[c] as number;
    return Math.max(0, Math.min(255, bg + (mean - bg) / cover));
  }) as Rgb;
  return { rgb, borderOnly: true };
}

export interface Classification {
  types: CandleType[];
  /** True where the colour did not clearly say bull or bear. */
  unclear: boolean[];
}

/**
 * Step 9. Saturated colours use hue (green = bull, red = bear). Neutral colours compare
 * the body with the background. Anything else is split into two groups with k-means.
 */
export function classifyCandles(
  samples: InteriorSample[],
  background: Rgb,
  settings: DetectSettings,
): Classification {
  const interiors = samples.map((s) => s.rgb);
  const bgLab = rgbToLab(...background);
  const labs: Lab[] = interiors.map((c) =>
    rgbToLab(Math.round(c[0]), Math.round(c[1]), Math.round(c[2])),
  );
  const types: Array<CandleType | null> = interiors.map((rgb, i) => {
    const lab = labs[i] as Lab;
    const chroma = Math.hypot(lab[1], lab[2]);
    const { hue, saturation } = rgbToHueSat(rgb[0], rgb[1], rgb[2]);
    if (chroma >= SATURATED_CHROMA && saturation >= 0.25) {
      if (hue >= 60 && hue <= 180) return 'bull';
      if (hue < 30 || hue > 330) return 'bear';
      return null;
    }
    if (chroma < NEUTRAL_CHROMA) {
      const light = deltaE(lab, bgLab) < settings.tLow || lab[0] >= LIGHT_L;
      return light === settings.lightBodyIsBull ? 'bull' : 'bear';
    }
    return null;
  });

  // A neutral body judged only by its border (a flat doji) tells us nothing about its type.
  const unclear = types.map((t, i) => {
    if (t === null) return true;
    const lab = labs[i] as Lab;
    return (samples[i] as InteriorSample).borderOnly && Math.hypot(lab[1], lab[2]) < NEUTRAL_CHROMA;
  });
  if (types.some((t) => t === null)) {
    const assigned = kMeansLightness(labs);
    types.forEach((t, i) => {
      if (t === null) {
        const light = assigned[i] as boolean;
        types[i] = light === settings.lightBodyIsBull ? 'bull' : 'bear';
      }
    });
  }
  return { types: types as CandleType[], unclear };
}

/** k-means with k = 2 in Lab. Returns, per point, whether it is in the lighter group. */
function kMeansLightness(points: Lab[]): boolean[] {
  if (points.length === 0) return [];
  let lo = points[0] as Lab;
  let hi = points[0] as Lab;
  for (const p of points) {
    if (p[0] < lo[0]) lo = p;
    if (p[0] > hi[0]) hi = p;
  }
  let c0: Lab = [...lo];
  let c1: Lab = [...hi];
  let side = points.map(() => 0);
  for (let iter = 0; iter < 12; iter++) {
    side = points.map((p) => (deltaE(p, c0) <= deltaE(p, c1) ? 0 : 1));
    const next = [c0, c1].map((old, k) => {
      const members = points.filter((_, i) => side[i] === k);
      if (members.length === 0) return old;
      return [0, 1, 2].map(
        (d) => members.reduce((a, p) => a + (p[d] as number), 0) / members.length,
      ) as Lab;
    });
    c0 = next[0] as Lab;
    c1 = next[1] as Lab;
  }
  const lightSide = c0[0] >= c1[0] ? 0 : 1;
  return side.map((s) => s === lightSide);
}
