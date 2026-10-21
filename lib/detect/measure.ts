import type { Rgb } from '@/lib/color/lab';
import { overWhite } from './background';
import { strongThreshold } from './segment';
import type { DetectSettings, PixelImage } from './types';

/**
 * Geometry of one candle, in source pixels. Pixel i covers [i, i + 1].
 *
 * Edge pixels are measured with an "ink fraction": ΔE divided by the ΔE of the solid
 * line colour. A pixel that is 30% covered by a line contributes about 0.3, so an edge
 * sits at (index of the first covered pixel) + (1 − its fraction).
 *
 * SRS step 3 clamps coverage at T_high for finding rows and columns. Using the same
 * clamp for the edge fraction would push edges outward by up to half a pixel on dark
 * lines, so the fraction is normalised by the line's own ΔE instead.
 */
export interface Measured {
  centerX: number;
  bodyLeft: number;
  bodyRight: number;
  bodyTop: number;
  bodyBottom: number;
  wickTop: number | null;
  wickBottom: number | null;
  /** Where the wick line actually is (for the off-centre check). null if no wick. */
  wickX: number | null;
  isDoji: boolean;
  /** Border thickness of a hollow body. null for solid bodies. */
  borderWidth: number | null;
  wickWidth: number | null;
  /** Colour of the border line, from the pixels. */
  borderRgb: Rgb;
  /** Colour of the wick line. null if the candle has no wick. */
  wickRgb: Rgb | null;
  split: boolean;
}

const EDGE_EPS = 0.04;
const ROW_EPS = 0.05;

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? (s[(n - 1) / 2] as number) : ((s[n / 2 - 1] as number) + (s[n / 2] as number)) / 2;
}

function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(q * (s.length - 1))] as number;
}

/** Measures the candle that lives in columns x0..x1 (inclusive). Returns null for noise. */
export function measureCluster(
  de: Float32Array,
  dl: Float32Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  split: boolean,
  settings: DetectSettings,
  image: PixelImage,
  background: Rgb,
): Measured | null {
  const { tLow, tHigh } = settings;
  const strong = strongThreshold(settings);

  // ---- ink reference: the solid line colour's difference from the background
  // (95th percentile among strongly covered pixels).
  const histE = new Uint32Array(512);
  const histL = new Uint32Array(512);
  let inked = 0;
  for (let y = 0; y < height; y++) {
    for (let x = x0; x <= x1; x++) {
      const v = de[y * width + x] as number;
      if (v >= tHigh) {
        const be = Math.min(511, Math.round(v));
        const bl = Math.min(511, Math.round(dl[y * width + x] as number));
        histE[be] = (histE[be] as number) + 1;
        histL[bl] = (histL[bl] as number) + 1;
        inked++;
      }
    }
  }
  const percentile95 = (hist: Uint32Array): number => {
    let acc = 0;
    for (let b = 0; b < 512; b++) {
      acc += hist[b] as number;
      if (acc >= inked * 0.95) return b;
    }
    return 0;
  };
  const inkRef = inked > 0 ? Math.max(tHigh, percentile95(histE)) : tHigh;
  const inkL = inked > 0 ? percentile95(histL) : 0;
  // JPEG smears colour (chroma) past a line's end but keeps lightness sharp. When the line
  // is mostly a lightness contrast, measure partial pixels by lightness; otherwise by ΔE.
  const useLightness = inkL >= 0.35 * inkRef && inkL >= 10;
  const frac = (x: number, y: number): number => {
    const v = de[y * width + x] as number;
    if (v <= tLow) return 0;
    return useLightness
      ? Math.min(1, (dl[y * width + x] as number) / inkL)
      : Math.min(1, v / inkRef);
  };

  // ---- colours: read a line's own colour from its pixels.
  const rgbAt = (x: number, y: number): Rgb => {
    const i = (y * width + x) * 4;
    const a = image.data[i + 3] as number;
    return [
      overWhite(image.data[i] as number, a),
      overWhite(image.data[i + 1] as number, a),
      overWhite(image.data[i + 2] as number, a),
    ];
  };
  /** A pixel only partly covered by a line is the line blended with the background: undo it. */
  const unblend = (px: Rgb, f: number): Rgb => {
    if (f >= 0.85) return px;
    const k = Math.max(f, 0.25);
    return px.map((v, c) =>
      Math.max(0, Math.min(255, (background[c] as number) + (v - (background[c] as number)) / k)),
    ) as Rgb;
  };
  const medianRgb = (list: Rgb[]): Rgb | null =>
    list.length === 0
      ? null
      : ([0, 1, 2].map((c) => median(list.map((p) => p[c] as number))) as Rgb);

  // ---- step 5: covered span of every row
  const rowSpan = new Int32Array(height);
  const rowMin = new Int32Array(height);
  const rowMax = new Int32Array(height);
  let maxSpan = 0;
  for (let y = 0; y < height; y++) {
    let mn = -1;
    let mx = -1;
    for (let x = x0; x <= x1; x++) {
      if ((de[y * width + x] as number) >= strong) {
        if (mn < 0) mn = x;
        mx = x;
      }
    }
    rowMin[y] = mn;
    rowMax[y] = mx;
    const span = mn < 0 ? 0 : mx - mn + 1;
    rowSpan[y] = span;
    if (span > maxSpan) maxSpan = span;
  }
  // Candles are at least 3 px wide; anything thinner is a stray line.
  if (maxSpan < 3) return null;

  // Body rows: rows that reach both sides of the body. This is the SRS "at least 50% of the
  // widest row" rule made stricter: a wick plus a stray pixel from a neighbour can be half as
  // wide as the body, and a narrow body's wick can straddle two of its three pixels, but
  // neither reaches both sides.
  const fullRows: number[] = [];
  for (let y = 0; y < height; y++) if ((rowSpan[y] as number) >= 0.9 * maxSpan) fullRows.push(y);
  const refMin = median(fullRows.map((y) => rowMin[y] as number));
  const refMax = median(fullRows.map((y) => rowMax[y] as number));
  // A pixel of slack for JPEG ringing, but none on very narrow bodies where the wick is
  // only a pixel or two from either side.
  const slack = maxSpan >= 8 ? 1 : 0;
  const isBodyRow = (y: number) =>
    (rowSpan[y] as number) > 0 &&
    (rowMin[y] as number) <= refMin + slack &&
    (rowMax[y] as number) >= refMax - slack;
  let r0 = -1;
  let r1 = -1;
  for (let y = 0; y < height; y++) {
    if (isBodyRow(y)) {
      if (r0 < 0) r0 = y;
      r1 = y;
    }
  }
  if (r0 < 0) return null;

  const bodyRows: number[] = [];
  for (let y = r0; y <= r1; y++) if (isBodyRow(y)) bodyRows.push(y);
  const coarseLeft = median(bodyRows.map((y) => rowMin[y] as number));
  const coarseRight = median(bodyRows.map((y) => rowMax[y] as number)) + 1;

  // ---- step 6: left and right edges, refined with the edge pixel's ink fraction.
  // Skip the top and bottom border rows so corners do not bias the median.
  const sideRows =
    bodyRows.length >= 6 ? bodyRows.filter((y) => y >= r0 + 2 && y <= r1 - 2) : bodyRows;
  const lefts: number[] = [];
  const rights: number[] = [];
  const borderMasses: number[] = [];

  // Finds one side edge in a row, scanning inward from the outside (dir 1 = left side).
  //  - A thin line (a hollow body's border): its outer edge is the line's centre of mass
  //    minus half its mass. A blur or half-pixel offset moves pixel values, not that.
  //  - A step into a solid fill: where the ink profile crosses 50% of the fill's own level.
  const sideEdge = (y: number, dir: 1 | -1, fallback: number) => {
    const from = dir === 1 ? x0 : x1;
    const to =
      dir === 1
        ? Math.min(x1, Math.floor(coarseLeft) + 3)
        : Math.max(x0, Math.ceil(coarseRight) - 4);
    let first = -1;
    for (let x = from; dir === 1 ? x <= to : x >= to; x += dir) {
      if ((de[y * width + x] as number) > tLow && frac(x, y) >= EDGE_EPS) {
        first = x;
        break;
      }
    }
    if (first < 0) return { edge: fallback, thinMass: null as number | null };

    // Follow the run of ink pixels; a hollow border ends within a few pixels.
    const run: number[] = [];
    let peaked = false;
    for (let x = first; x >= x0 && x <= x1 && run.length < 8; x += dir) {
      const f = frac(x, y);
      if (f < EDGE_EPS) break;
      if (peaked && f < 0.25) break;
      if (f >= 0.5) peaked = true;
      run.push(f);
    }
    if (run.length < 8) {
      let mass = 0;
      let moment = 0;
      run.forEach((f, k) => {
        const c = Math.min(1, f);
        mass += c;
        moment += c * (first + dir * k + 0.5);
      });
      if (mass >= 0.2) {
        const centre = moment / mass;
        return { edge: dir === 1 ? centre - mass / 2 : centre + mass / 2, thinMass: mass };
      }
    }
    const inner: number[] = [];
    for (let k = 2; k <= 5; k++) {
      const x = first + dir * k;
      if (x >= x0 && x <= x1) inner.push(frac(x, y));
    }
    const plateau = Math.max(0.3, inner.length ? median(inner) : 1);
    const target = 0.5 * plateau;
    for (let x = first; x >= x0 && x <= x1; x += dir) {
      const b = frac(x, y);
      if (b >= target) {
        const prev = x - dir;
        const a = prev >= x0 && prev <= x1 ? frac(prev, y) : 0;
        const t = (target - a) / (b - a);
        return { edge: dir === 1 ? x - 0.5 + t : x + 1.5 - t, thinMass: null };
      }
    }
    return { edge: fallback, thinMass: null };
  };

  for (const y of sideRows) {
    const l = sideEdge(y, 1, coarseLeft);
    lefts.push(l.edge);
    rights.push(sideEdge(y, -1, coarseRight).edge);
    if (l.thinMass !== null) borderMasses.push(l.thinMass);
  }
  const bodyLeft = median(lefts);
  const bodyRight = median(rights);
  if (!(bodyRight > bodyLeft)) return null;
  const borderWidth =
    borderMasses.length >= sideRows.length / 2 && borderMasses.length > 0
      ? median(borderMasses)
      : null;

  // Border colour: the outermost solidly inked pixel on each side, row by row. For a hollow
  // body that is the border line; for a solid body it is the edge of the fill.
  const borderSamples: Rgb[] = [];
  const step = Math.max(1, Math.floor(sideRows.length / 40));
  for (let k = 0; k < sideRows.length; k += step) {
    const y = sideRows[k] as number;
    for (const dir of [1, -1] as const) {
      const from = dir === 1 ? x0 : x1;
      const to =
        dir === 1
          ? Math.min(x1, Math.floor(coarseLeft) + 3)
          : Math.max(x0, Math.ceil(coarseRight) - 4);
      let pick: Rgb | null = null;
      let bestF = 0;
      let bestPx: Rgb | null = null;
      for (let x = from; dir === 1 ? x <= to : x >= to; x += dir) {
        const f = frac(x, y);
        if (f >= 0.85) {
          pick = rgbAt(x, y);
          break;
        }
        if (f > bestF) {
          bestF = f;
          bestPx = rgbAt(x, y);
        }
      }
      if (!pick && bestPx && bestF >= 0.1) pick = unblend(bestPx, bestF);
      if (pick) borderSamples.push(pick);
    }
  }
  const borderRgb =
    medianRgb(borderSamples) ?? rgbAt(Math.round((bodyLeft + bodyRight) / 2), Math.round(r0));

  // ---- top and bottom: lower quartile of the ink fraction across the body's columns.
  // The wick covers only a few columns, so the quartile ignores it.
  // 0.3 px of slack so an edge measured at 14.9985 still counts as 15.
  let cA = Math.max(x0, Math.ceil(bodyLeft - 0.3));
  let cB = Math.min(x1, Math.floor(bodyRight + 0.3) - 1);
  if (cA > cB) cA = cB = Math.min(x1, Math.max(x0, Math.round((bodyLeft + bodyRight) / 2)));
  const rowQ = (y: number): number => {
    const vals: number[] = [];
    for (let x = cA; x <= cB; x++) vals.push(frac(x, y));
    return quantile(vals, 0.25);
  };

  let yTop = r0;
  for (let y = Math.max(0, r0 - 3); y <= r0; y++) {
    if (rowQ(y) >= ROW_EPS) {
      yTop = y;
      break;
    }
  }
  let yBot = r1;
  for (let y = Math.min(height - 1, r1 + 3); y >= r1; y--) {
    if (rowQ(y) >= ROW_EPS) {
      yBot = y;
      break;
    }
  }

  // A hollow body's top border (or a flat candle) is a thin line: its outer edge is the
  // line's centre of mass minus half its mass, which a blur leaves where it was.
  // A solid body's edge is a step: first covered row plus its uncovered part.
  const edge = (from: number, dir: 1 | -1): number => {
    const rows: number[] = [];
    for (let y = from; y >= 0 && y < height && rows.length < 8; y += dir) {
      const q = rowQ(y);
      if (q < ROW_EPS) break;
      if (q < 0.25 && rows.some((r) => r >= 0.5)) break; // past the line, into the body's inside
      rows.push(Math.min(1, q));
    }
    if (rows.length < 8) {
      let mass = 0;
      let moment = 0;
      rows.forEach((q, k) => {
        mass += q;
        moment += q * (from + dir * k + 0.5);
      });
      if (mass === 0) return dir === 1 ? from : from + 1; // nothing there: the row itself
      const centre = moment / mass;
      return dir === 1 ? centre - mass / 2 : centre + mass / 2;
    }
    const q = rows[0] as number;
    return dir === 1 ? from + (1 - q) : from + q;
  };
  const bodyTop = edge(yTop, 1);
  const bodyBottom = edge(yBot, -1);

  // ---- step 7: wicks. Rows beyond the body that carry a thin line near the centre.
  // Works on ink mass instead of hard thresholds, so faint (JPEG, coloured) wicks survive.
  interface Wick {
    end: number;
    x: number;
    width: number;
    rgb: Rgb | null;
  }
  const bodyCentre = (bodyLeft + bodyRight) / 2;
  const measureWick = (dir: -1 | 1): Wick | null => {
    const first = dir === -1 ? yTop - 1 : yBot + 1;
    if (first < 0 || first >= height) return null;
    const rowsAvail = dir === -1 ? first + 1 : height - first;
    const rowAt = (k: number) => first + dir * k;

    // The wick is the column group with the most ink beyond the body, near the centre.
    let xp = -1;
    let best = 0;
    for (
      let x = Math.max(x0, Math.round(bodyCentre) - 2);
      x <= Math.min(x1, Math.round(bodyCentre) + 1);
      x++
    ) {
      let m = 0;
      for (let k = 0; k < rowsAvail; k++) m += frac(x, rowAt(k));
      if (m > best) {
        best = m;
        xp = x;
      }
    }
    if (xp < 0 || best < 1) return null;
    const wl = Math.max(x0, xp - 2);
    const wr = Math.min(x1, xp + 2);
    const masses: number[] = [];
    for (let k = 0; k < rowsAvail; k++) {
      let m = 0;
      for (let x = wl; x <= wr; x++) m += frac(x, rowAt(k));
      masses.push(m);
    }
    const peak = Math.max(...masses);
    const ref = median(masses.filter((m) => m >= 0.5 * peak));
    if (!(ref > 0.2)) return null;

    let count = 0;
    while (count < rowsAvail && (masses[count] as number) >= 0.5 * ref) count++;
    if (count === 0) return null;
    // Wick end = where the ink profile crosses 50%. A blur, JPEG ringing or a partly covered
    // last row all leave that crossing where the true edge is, and faint ghosts below 50% are
    // ignored. Rows are sampled at their centres, so interpolate between the last row at or
    // above 50% and the next one.
    let end: number;
    if (count === rowsAvail) {
      end = dir === -1 ? 0 : height; // the wick runs off the image
    } else {
      const hi = Math.min(1, (masses[count - 1] as number) / ref);
      const lo = (masses[count] as number) / ref;
      const t = (hi - 0.5) / (hi - lo);
      const centre = rowAt(count - 1) + 0.5;
      end = dir === -1 ? centre - t : centre + t;
    }

    // Wick x: ink-weighted centre of the rows away from both ends.
    const from = count >= 4 ? 1 : 0;
    const to = count >= 4 ? count - 2 : count - 1;
    let sum = 0;
    let weight = 0;
    const colourSamples: Rgb[] = [];
    for (let k = from; k <= to; k++) {
      const y = rowAt(k);
      let strongest = -1;
      let strongestF = 0;
      for (let x = wl; x <= wr; x++) {
        const m = frac(x, y);
        sum += m * (x + 0.5);
        weight += m;
        if (m > strongestF) {
          strongestF = m;
          strongest = x;
        }
      }
      if (strongest >= 0 && strongestF >= 0.1) {
        colourSamples.push(unblend(rgbAt(strongest, y), strongestF));
      }
    }
    return {
      end,
      x: weight > 0 ? sum / weight : xp + 0.5,
      width: ref,
      rgb: medianRgb(colourSamples),
    };
  };

  const up = measureWick(-1);
  const down = measureWick(1);
  const wicks = [up, down].filter((w): w is Wick => w !== null);

  const centerX = (bodyLeft + bodyRight) / 2;
  return {
    centerX,
    bodyLeft,
    bodyRight,
    bodyTop,
    bodyBottom,
    wickTop: up ? up.end : null,
    wickBottom: down ? down.end : null,
    wickX: wicks.length ? wicks.reduce((a, w) => a + w.x, 0) / wicks.length : null,
    isDoji: bodyBottom - bodyTop < 2,
    borderWidth,
    wickWidth: wicks.length ? median(wicks.map((w) => w.width)) : null,
    borderRgb,
    wickRgb: medianRgb(wicks.flatMap((w) => (w.rgb ? [w.rgb] : []))),
    split,
  };
}
