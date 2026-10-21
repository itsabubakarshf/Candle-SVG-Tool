/**
 * Everything on a chart that is not a candle: lines (solid, dashed, dotted, straight or
 * slanted, any colour), shaded boxes and text labels.
 *
 * Nothing here knows about colours as such. Boxes are found as large flat patches of one
 * colour; lines as thin, long, straight chains of marks; text as small groups of marks of
 * letter size. Everything is measured from the original pixels.
 */
import { deltaE, rgbToLab, type Rgb } from '@/lib/color/lab';
import { rgbToHex } from '@/lib/svg/hex';
import { overWhite } from './background';
import type { CandleExtent } from './clean';
import { candleMask } from './mask';
import { findSlanted } from './slanted';
import type { BoxExtra, Extra, LineExtra, PixelImage, TextExtra } from './types';

/** ΔE from the background at which a mark exists at all. */
const WEAK = 4;
/** ΔE of solid ink. */
const STRONG = 24;

export interface ExtrasOptions {
  lossy?: boolean;
  /**
   * Only look for dotted and dashed lines, anywhere, without knowing where the candles are.
   * Used before the candles are read, because every dash would be read as a candle.
   */
  patternedOnly?: boolean;
}

export interface ExtrasFound {
  extras: Extra[];
  /** 1 where a pixel belongs to something that was found (so the candles can be read without it). */
  footprint: Uint8Array;
}

const NONE: ExtrasFound = { extras: [], footprint: new Uint8Array(0) };

// ---------------------------------------------------------------------------------------------
// small helpers

function rgbAt(image: PixelImage, p: number): Rgb {
  const i = p * 4;
  const a = image.data[i + 3] as number;
  return [
    overWhite(image.data[i] as number, a),
    overWhite(image.data[i + 1] as number, a),
    overWhite(image.data[i + 2] as number, a),
  ];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

const half = (v: number) => Math.round(v * 2) / 2;

// ---------------------------------------------------------------------------------------------
// boxes: big flat patches of one colour

interface Patch {
  size: number;
  x0: number;
  y0: number;
  x1: number; // inclusive
  y1: number;
}

function patches(match: Uint8Array, width: number, height: number): Patch[] {
  const seen = new Uint8Array(match.length);
  const out: Patch[] = [];
  const stack: number[] = [];
  for (let start = 0; start < match.length; start++) {
    if (!match[start] || seen[start]) continue;
    let size = 0;
    let x0 = width;
    let y0 = height;
    let x1 = 0;
    let y1 = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop() as number;
      const x = p % width;
      const y = (p - x) / width;
      size++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1]) {
        if (q >= 0 && match[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
      if (y < height - 1 && match[p + width] && !seen[p + width]) {
        seen[p + width] = 1;
        stack.push(p + width);
      }
    }
    if (size >= 40) out.push({ size, x0, y0, x1, y1 });
  }
  return out;
}

interface BoxFound {
  box: Omit<BoxExtra, 'id'>;
  tint: Rgb;
  match: Uint8Array;
}

function findBoxes(
  image: PixelImage,
  de: Float32Array,
  area: Uint8Array,
  body: Uint8Array,
  lossy: boolean,
  candles: CandleExtent[],
): BoxFound[] {
  const { width, height } = image;
  // The colours that cover the most space outside the candles (quantised: JPEG adds noise).
  const hist = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let p = 0; p < de.length; p++) {
    const v = de[p] as number;
    if (v < 1.5 || v > 80 || area[p]) continue;
    const [r, g, b] = rgbAt(image, p);
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    const e = hist.get(key);
    if (e) {
      e.n++;
      e.r += r;
      e.g += g;
      e.b += b;
    } else hist.set(key, { n: 1, r, g, b });
  }
  const top = [...hist.values()]
    .filter((e) => e.n >= 400)
    .sort((a, b) => b.n - a.n)
    .slice(0, 4);

  const found: BoxFound[] = [];
  const tol = lossy ? 9 : 4;
  for (const t of top) {
    const tint: Rgb = [t.r / t.n, t.g / t.n, t.b / t.n];
    const match = new Uint8Array(width * height);
    for (let p = 0; p < match.length; p++) {
      if (body[p] || (de[p] as number) < 1.5) continue;
      const [r, g, b] = rgbAt(image, p);
      const d = Math.hypot(r - tint[0], g - tint[1], b - tint[2]);
      if (d <= tol) match[p] = 1;
    }
    // a few stray pixels of the same colour (a faint line's edge) are not part of a box
    const pieces = patches(match, width, height).filter((m) => m.size >= 24);
    // A candle (or its wick) cuts a box into pieces that share its top and bottom edge.
    const groups: Patch[][] = [];
    for (const piece of pieces) {
      const g = groups.find((members) =>
        members.some((m) => {
          const yOverlap = Math.min(m.y1, piece.y1) - Math.max(m.y0, piece.y0) + 1;
          const xOverlap = Math.min(m.x1, piece.x1) - Math.max(m.x0, piece.x0) + 1;
          const xGap = Math.max(m.x0, piece.x0) - Math.min(m.x1, piece.x1) - 1;
          const yGap = Math.max(m.y0, piece.y0) - Math.min(m.y1, piece.y1) - 1;
          // the pieces of one box share its edges, within a little blur
          const sameRows = Math.abs(m.y0 - piece.y0) <= 3 && Math.abs(m.y1 - piece.y1) <= 3;
          const sameCols = Math.abs(m.x0 - piece.x0) <= 3 && Math.abs(m.x1 - piece.x1) <= 3;
          return (
            (sameRows &&
              yOverlap >= 0.6 * Math.min(m.y1 - m.y0 + 1, piece.y1 - piece.y0 + 1) &&
              xGap <= 120) ||
            (sameCols &&
              xOverlap >= 0.6 * Math.min(m.x1 - m.x0 + 1, piece.x1 - piece.x0 + 1) &&
              yGap <= 120)
          );
        }),
      );
      if (g) g.push(piece);
      else groups.push([piece]);
    }
    for (const g of groups) {
      const x0 = Math.min(...g.map((m) => m.x0));
      const y0 = Math.min(...g.map((m) => m.y0));
      const x1 = Math.max(...g.map((m) => m.x1));
      const y1 = Math.max(...g.map((m) => m.y1));
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      if (w < 8 || h < 8 || w * h < 200) continue;
      let flat = 0;
      let explained = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const p = y * width + x;
          if (match[p]) flat++;
          else if (area[p]) explained++;
        }
      }
      const total = w * h;
      // Mostly flat colour, the rest hidden behind candles. A flat patch that is only a candle
      // body, or a thin stripe, is not a box.
      if (flat < 0.35 * total || flat + explained < 0.9 * total) continue;
      // A pale candle body that was measured a little too small is not a box either.
      const cx = x0 + w / 2;
      const cy = y0 + h / 2;
      const isBody = candles.some(
        (c) =>
          cx >= c.bodyLeft &&
          cx <= c.bodyRight &&
          cy >= c.bodyTop &&
          cy <= c.bodyBottom &&
          w <= 1.6 * (c.bodyRight - c.bodyLeft) + 6 &&
          h <= 1.6 * (c.bodyBottom - c.bodyTop) + 6,
      );
      if (isBody) continue;
      // Flat patches in the colour candle bodies are filled with are candle bodies.
      const tintLab = rgbToLab(...(tint.map(Math.round) as Rgb));
      const likeFill = candles.some(
        (c) =>
          c.fill !== undefined &&
          deltaE(tintLab, rgbToLab(...(c.fill.map(Math.round) as Rgb))) <= 3,
      );
      if (likeFill) continue;
      // wider than a candle: a box spans several, a candle body that went unread does not
      const widths = candles.map((c) => c.bodyRight - c.bodyLeft).sort((a, b) => a - b);
      const typicalW = widths[Math.floor(widths.length / 2)] ?? 0;
      if (w < 1.5 * typicalW) continue;
      found.push({
        box: { kind: 'box', x: x0, y: y0, width: w, height: h, fill: rgbToHex(tint) },
        tint,
        match,
      });
    }
  }
  // Never report the same area twice (two close tints).
  return found.filter(
    (a, i) =>
      !found.some(
        (b, j) =>
          j < i &&
          Math.abs(a.box.x - b.box.x) < 6 &&
          Math.abs(a.box.y - b.box.y) < 6 &&
          Math.abs(a.box.width - b.box.width) < 6 &&
          Math.abs(a.box.height - b.box.height) < 6,
      ),
  );
}

// ---------------------------------------------------------------------------------------------
// connected marks and what shape each one has

interface Comp {
  /** Pixel indices. */
  px: number[];
  size: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Ink-weighted centre, in pixel-centre coordinates. */
  cx: number;
  cy: number;
  /** Direction of the longest extent, radians in [0, π). */
  angle: number;
  /** Extent along and across that direction (pixels). */
  length: number;
  thick: number;
  /** Largest ΔE in the group. */
  peak: number;
  solid: number;
  touchesCandle: boolean;
  /** t of the ends along `angle`, measured from (cx, cy). */
  t0: number;
  t1: number;
}

function analyse(
  px: number[],
  ink: Float32Array,
  width: number,
  area: Uint8Array,
  height: number,
): Comp {
  let wsum = 0;
  let mx = 0;
  let my = 0;
  let x0 = width;
  let y0 = height;
  let x1 = 0;
  let y1 = 0;
  let peak = 0;
  let solid = 0;
  let touchesCandle = false;
  for (const p of px) {
    const x = p % width;
    const y = (p - x) / width;
    const w = ink[p] as number;
    wsum += w;
    mx += w * (x + 0.5);
    my += w * (y + 0.5);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (w > peak) peak = w;
    if (w >= STRONG) solid++;
    if (!touchesCandle) {
      for (let dy = -1; dy <= 1 && !touchesCandle; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && area[ny * width + nx]) {
            touchesCandle = true;
            break;
          }
        }
      }
    }
  }
  const cx = mx / wsum;
  const cy = my / wsum;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of px) {
    const x = (p % width) + 0.5 - cx;
    const y = Math.floor(p / width) + 0.5 - cy;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  if (angle < 0) angle += Math.PI;
  // Exactly horizontal or vertical stays exactly so.
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let t0 = Infinity;
  let t1 = -Infinity;
  let u0 = Infinity;
  let u1 = -Infinity;
  for (const p of px) {
    const x = (p % width) + 0.5 - cx;
    const y = Math.floor(p / width) + 0.5 - cy;
    const t = x * dx + y * dy;
    const u = -x * dy + y * dx;
    if (t < t0) t0 = t;
    if (t > t1) t1 = t;
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
  }
  return {
    px,
    size: px.length,
    x0,
    y0,
    x1,
    y1,
    cx,
    cy,
    angle,
    length: t1 - t0 + 1,
    thick: u1 - u0 + 1,
    peak,
    solid,
    touchesCandle,
    t0,
    t1,
  };
}

const isDot = (c: Comp) => c.size <= 12 && c.x1 - c.x0 < 4 && c.y1 - c.y0 < 4;
const isLinear = (c: Comp) => c.length >= 3 && c.thick <= 4.5 && c.length / c.thick >= 2;

/** Angle difference between two directions (mod π), in radians. */
const angleDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
};

// ---------------------------------------------------------------------------------------------
// lines

interface LineFit {
  cx: number;
  cy: number;
  angle: number;
  t0: number;
  t1: number;
}

/** Ink-weighted straight-line fit through pixels. Horizontal and vertical lines snap. */
function fitLine(px: number[], ink: Float32Array, width: number): LineFit {
  let wsum = 0;
  let mx = 0;
  let my = 0;
  for (const p of px) {
    const w = ink[p] as number;
    wsum += w;
    mx += w * ((p % width) + 0.5);
    my += w * (Math.floor(p / width) + 0.5);
  }
  const cx = mx / wsum;
  const cy = my / wsum;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of px) {
    const w = ink[p] as number;
    const x = (p % width) + 0.5 - cx;
    const y = Math.floor(p / width) + 0.5 - cy;
    sxx += w * x * x;
    syy += w * y * y;
    sxy += w * x * y;
  }
  let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  if (angle < 0) angle += Math.PI;
  const snap = (0.6 * Math.PI) / 180;
  if (angle < snap || angle > Math.PI - snap) angle = 0;
  else if (Math.abs(angle - Math.PI / 2) < snap) angle = Math.PI / 2;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let t0 = Infinity;
  let t1 = -Infinity;
  for (const p of px) {
    const t = ((p % width) + 0.5 - cx) * dx + (Math.floor(p / width) + 0.5 - cy) * dy;
    if (t < t0) t0 = t;
    if (t > t1) t1 = t;
  }
  return { cx, cy, angle, t0: t0 - 0.5, t1: t1 + 0.5 };
}

function distanceToLine(f: { cx: number; cy: number; angle: number }, x: number, y: number) {
  return Math.abs(-(x - f.cx) * Math.sin(f.angle) + (y - f.cy) * Math.cos(f.angle));
}

interface LineGroup {
  members: Comp[];
  /** All on a regular dash pattern (dashed or dotted)? */
  patterned: boolean;
}

/**
 * Pieces that lie on the same straight line (a line cut by candles, or by gaps). Two pieces
 * are on one line when they point the same way and sit within 1.5 px of each other's line.
 */
function groupCollinear(pieces: Comp[]): Comp[][] {
  const parent = pieces.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    return r;
  };
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i] as Comp;
      const b = pieces[j] as Comp;
      // The longer piece defines the direction.
      const ref = a.length >= b.length ? a : b;
      const other = ref === a ? b : a;
      if (angleDiff(a.angle, b.angle) > (1.2 * Math.PI) / 180 + 3 / Math.max(a.length, b.length))
        continue;
      if (distanceToLine(ref, other.cx, other.cy) > 1.5) continue;
      parent[find(i)] = find(j);
    }
  }
  const out = new Map<number, Comp[]>();
  pieces.forEach((c, i) => {
    const r = find(i);
    const g = out.get(r);
    if (g) g.push(c);
    else out.set(r, [c]);
  });
  return [...out.values()];
}

/** Dots and short dashes that sit on one line at an even spacing (dotted and dashed lines). */
interface ChainRules {
  /** Fewest elements in a chain. */
  min: number;
  minSpan: number;
  /** Where candles are: spots hidden by them are not "missing" dots. */
  area?: Uint8Array;
  width: number;
}

function findChains(elems: Comp[], rules: ChainRules): Comp[][] {
  if (elems.length < rules.min || elems.length > 700) return [];
  const votes = new Map<number, number>();
  const keyOf = (i: number, j: number): number | null => {
    const a = elems[i] as Comp;
    const b = elems[j] as Comp;
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const d = Math.hypot(dx, dy);
    if (d < 2 || d > 320) return null;
    let th = Math.atan2(dy, dx);
    if (th < 0) th += Math.PI;
    if (th >= Math.PI) th -= Math.PI;
    const rho = -a.cx * Math.sin(th) + a.cy * Math.cos(th);
    return Math.round(th / ((0.5 * Math.PI) / 180)) * 100000 + Math.round(rho) + 50000;
  };
  for (let i = 0; i < elems.length; i++) {
    for (let j = i + 1; j < elems.length; j++) {
      const k = keyOf(i, j);
      if (k !== null) votes.set(k, (votes.get(k) ?? 0) + 1);
    }
  }
  const bins = [...votes.entries()].filter(([, v]) => v >= 5).sort((a, b) => b[1] - a[1]);
  const claimed = new Set<number>();
  const chains: Comp[][] = [];
  for (const [key] of bins.slice(0, 60)) {
    const thIdx = Math.floor(key / 100000);
    const rhoq = key - thIdx * 100000 - 50000;
    const th = (thIdx * 0.5 * Math.PI) / 180;
    let fit = { cx: 0, cy: 0, angle: th };
    // start from the nominal line, then refit on its inliers twice
    let inliers = elems.filter((e, i) => {
      if (claimed.has(i)) return false;
      const d = Math.abs(-e.cx * Math.sin(th) + e.cy * Math.cos(th) - rhoq);
      return d <= 2.5;
    });
    for (let round = 0; round < 3 && inliers.length >= 4; round++) {
      let mx = 0;
      let my = 0;
      for (const e of inliers) {
        mx += e.cx;
        my += e.cy;
      }
      mx /= inliers.length;
      my /= inliers.length;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (const e of inliers) {
        sxx += (e.cx - mx) ** 2;
        syy += (e.cy - my) ** 2;
        sxy += (e.cx - mx) * (e.cy - my);
      }
      let a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      if (a < 0) a += Math.PI;
      fit = { cx: mx, cy: my, angle: a };
      inliers = elems.filter(
        (e, i) => !claimed.has(i) && distanceToLine(fit, e.cx, e.cy) <= (round < 2 ? 2 : 1.2),
      );
    }
    if (inliers.length < rules.min) continue;
    // every element must be a dot, or a dash that runs along the line
    const ok = inliers.filter(
      (e) => isDot(e) || angleDiff(e.angle, fit.angle) <= (20 * Math.PI) / 180,
    );
    if (ok.length < rules.min) continue;
    const dx = Math.cos(fit.angle);
    const dy = Math.sin(fit.angle);
    const sorted = ok
      .map((e) => ({ e, t: (e.cx - fit.cx) * dx + (e.cy - fit.cy) * dy }))
      .sort((a, b) => a.t - b.t);
    const gaps = sorted.slice(1).map((s, i) => s.t - (sorted[i] as { t: number }).t);
    const pitch = median(gaps);
    if (pitch < 2) continue;
    const regular = gaps.filter((g) => {
      const k = Math.round(g / pitch);
      return k >= 1 && k <= 16 && Math.abs(g - k * pitch) <= 0.3 * pitch;
    }).length;
    if (regular < 0.75 * gaps.length) continue;
    const span = (sorted[sorted.length - 1] as { t: number }).t - (sorted[0] as { t: number }).t;
    if (span < rules.minSpan) continue;
    // not much missing along the way (apart from what a candle hides)
    const first = sorted[0] as { t: number };
    let expected = 0;
    for (let t = first.t; t <= first.t + span + 0.5 * pitch; t += pitch) {
      const x = Math.floor(fit.cx + t * dx);
      const y = Math.floor(fit.cy + t * dy);
      const hidden = rules.area && x >= 0 && y >= 0 && rules.area[y * rules.width + x] === 1;
      if (!hidden) expected++;
    }
    if (sorted.length < (rules.area ? 0.6 : 0.35) * expected) continue;
    const members = sorted.map((s) => s.e);
    chains.push(members);
    for (const m of members) claimed.add(elems.indexOf(m));
  }
  return chains;
}

// ---------------------------------------------------------------------------------------------
// text: small marks of letter size, grouped into lines

interface TextGroup {
  comps: Comp[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function groupText(cands: Comp[]): TextGroup[] {
  const sorted = [...cands].sort((a, b) => a.x0 - b.x0);
  const groups: TextGroup[] = [];
  for (const c of sorted) {
    const h = c.y1 - c.y0 + 1;
    let target: TextGroup | undefined;
    for (const g of groups) {
      const gh = g.y1 - g.y0 + 1;
      const yOverlap = Math.min(g.y1, c.y1) - Math.max(g.y0, c.y0) + 1;
      // within the line's height (a colon's dots, a letter's dot, small marks), or mostly overlapping
      const inside = c.y0 >= g.y0 - 0.3 * gh && c.y1 <= g.y1 + 0.3 * gh;
      if (yOverlap < 0.35 * Math.min(h, gh) && !inside) continue;
      const gap = c.x0 - g.x1 - 1;
      if (gap <= Math.max(0.9 * Math.max(h, gh), 6)) {
        target = g;
        break;
      }
    }
    if (target) {
      target.comps.push(c);
      target.x0 = Math.min(target.x0, c.x0);
      target.y0 = Math.min(target.y0, c.y0);
      target.x1 = Math.max(target.x1, c.x1);
      target.y1 = Math.max(target.y1, c.y1);
    } else {
      groups.push({ comps: [c], x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 });
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------------------------

/** The marked pixels as an SVG path: one rectangle per run of identical rows. */
export function tracePixels(pixels: number[], width: number): string {
  const rows = new Map<number, number[]>();
  for (const p of pixels) {
    const y = Math.floor(p / width);
    const list = rows.get(y);
    if (list) list.push(p % width);
    else rows.set(y, [p % width]);
  }
  // runs per row
  const runs: Array<{ y: number; x0: number; x1: number }> = [];
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    let from = xs[0] as number;
    let prev = from;
    for (const x of xs.slice(1)) {
      if (x !== prev + 1) {
        runs.push({ y, x0: from, x1: prev });
        from = x;
      }
      prev = x;
    }
    runs.push({ y, x0: from, x1: prev });
  }
  // stack runs with the same extent in consecutive rows
  runs.sort((a, b) => a.x0 - b.x0 || a.x1 - b.x1 || a.y - b.y);
  const rects: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  const open = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
  for (const r of runs) {
    const key = `${r.x0}:${r.x1}`;
    const cur = open.get(key);
    if (cur && cur.y1 === r.y - 1) cur.y1 = r.y;
    else {
      const next = { x0: r.x0, x1: r.x1, y0: r.y, y1: r.y };
      rects.push(next);
      open.set(key, next);
    }
  }
  return rects
    .map((r) => `M${r.x0} ${r.y0}h${r.x1 - r.x0 + 1}v${r.y1 - r.y0 + 1}h${-(r.x1 - r.x0 + 1)}z`)
    .join('');
}

/**
 * How heavy the letters are, from the width of their vertical stems relative to their height.
 * (Inter: regular stems are about 0.13 of the capital height, semi-bold about 0.19.)
 */
export function estimateWeight(
  pixels: number[],
  ink: Float32Array,
  width: number,
  peak: number,
  capHeight: number,
): number {
  const cov = new Map<number, number>();
  for (const p of pixels) {
    const c = Math.min(1, (ink[p] as number) / Math.max(1, peak));
    if (c > 0.2) cov.set(p, c);
  }
  const rows = new Map<number, number[]>();
  for (const p of cov.keys()) {
    const y = Math.floor(p / width);
    const list = rows.get(y);
    if (list) list.push(p % width);
    else rows.set(y, [p % width]);
  }
  const stems: number[] = [];
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    let run: number[] = [xs[0] as number];
    const flush = () => {
      // only narrow runs are stems; wide ones are the horizontal strokes of the letters
      if (run.length <= 3) {
        stems.push(run.reduce((sum, x) => sum + (cov.get(y * width + x) as number), 0));
      }
    };
    for (const x of xs.slice(1)) {
      if (x === (run[run.length - 1] as number) + 1) run.push(x);
      else {
        flush();
        run = [x];
      }
    }
    flush();
  }
  if (stems.length < 4 || capHeight < 5) return 400;
  stems.sort((a, b) => a - b);
  const ratio = (stems[Math.floor(stems.length / 2)] as number) / capHeight;
  return ratio <= 0.135 ? 400 : ratio <= 0.16 ? 500 : ratio <= 0.19 ? 600 : 700;
}

/** A "line" that runs along a candle's own edge or wick is that candle, not a separate line. */
function isCandleEdge(l: LineExtra, candles: CandleExtent[]): boolean {
  const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
  if (len === 0) return false;
  const vertical = Math.abs(l.x2 - l.x1) < 0.05 * len;
  const horizontal = Math.abs(l.y2 - l.y1) < 0.05 * len;
  if (!vertical && !horizontal) return false;
  const near = 8;
  const overlap = (a0: number, a1: number, b0: number, b1: number) =>
    Math.max(0, Math.min(Math.max(a0, a1), b1) - Math.max(Math.min(a0, a1), b0));
  for (const c of candles) {
    if (vertical) {
      const x = l.x1;
      // inside the candles' own height and over one of them: a wick or edge that was split off
      const top = Math.min(...candles.map((k) => k.wickTop ?? k.bodyTop));
      const bottom = Math.max(...candles.map((k) => k.wickBottom ?? k.bodyBottom));
      if (
        x >= c.bodyLeft - 2 &&
        x <= c.bodyRight + 2 &&
        Math.min(l.y1, l.y2) >= top - near &&
        Math.max(l.y1, l.y2) <= bottom + near &&
        len <= 0.85 * (bottom - top)
      ) {
        return true;
      }
      const sides: Array<[number, number, number]> = [
        [c.bodyLeft, c.bodyTop, c.bodyBottom],
        [c.bodyRight, c.bodyTop, c.bodyBottom],
        [c.centerX, c.wickTop ?? c.bodyTop, c.wickBottom ?? c.bodyBottom],
      ];
      for (const [sx, y0, y1] of sides) {
        // along the candle's own edge, and not much longer than it
        if (
          Math.abs(x - sx) <= near &&
          overlap(l.y1, l.y2, y0 - near, y1 + near) >= 0.5 * len &&
          len <= 1.4 * (y1 - y0 + 2 * near)
        ) {
          return true;
        }
      }
      // a wick (or the rest of one) that starts at the body or at the end of the wick
      const ya = Math.min(l.y1, l.y2);
      const yb = Math.max(l.y1, l.y2);
      const wickSpan = (c.wickBottom ?? c.bodyBottom) - (c.wickTop ?? c.bodyTop);
      if (
        (Math.abs(x - c.centerX) <= 2.5 || (x >= c.bodyLeft - 2 && x <= c.bodyRight + 2)) &&
        ya <= (c.wickBottom ?? c.bodyBottom) + near &&
        yb >= (c.wickTop ?? c.bodyTop) - near &&
        len <= (c.wickTop === null && c.wickBottom === null ? 2.2 : 1.4) * (wickSpan + 2 * near)
      ) {
        return true;
      }
    } else {
      const y = l.y1;
      const sides: Array<[number, number, number]> = [
        [c.bodyTop, c.bodyLeft, c.bodyRight],
        [c.bodyBottom, c.bodyLeft, c.bodyRight],
      ];
      for (const [sy, x0, x1] of sides) {
        if (
          Math.abs(y - sy) <= near &&
          overlap(l.x1, l.x2, x0 - near, x1 + near) >= 0.5 * len &&
          len <= 1.4 * (x1 - x0 + 2 * near)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

interface Ring {
  members: Comp[];
  cx: number;
  cy: number;
  r: number;
  dotR: number;
  phase: number;
}

/**
 * Small round dots of one size, spaced evenly around a circle: TradingView's dotted-circle
 * sticker (PSP). It is 8 places with one left empty, like a loading sign. Dots are joined
 * to their nearest neighbours (a ring's dots are each other's nearest), then each group is
 * checked: same distance from its centre, spread all the way round, a hole in the middle.
 */
/** Least-squares circle through the dots' centres (falls back to their mean). */
function circleCentre(members: Comp[]): { cx: number; cy: number } {
  const k = members.length;
  const mx = members.reduce((a, m) => a + m.cx, 0) / k;
  const my = members.reduce((a, m) => a + m.cy, 0) / k;
  let suu = 0;
  let svv = 0;
  let suv = 0;
  let su3 = 0;
  let sv3 = 0;
  for (const m of members) {
    const u = m.cx - mx;
    const v = m.cy - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    su3 += u * u * u + u * v * v;
    sv3 += v * v * v + v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return { cx: mx, cy: my };
  const uc = (0.5 * (su3 * svv - sv3 * suv)) / det;
  const vc = (0.5 * (sv3 * suu - su3 * suv)) / det;
  return { cx: mx + uc, cy: my + vc };
}

export function findRings(comps: Comp[]): Ring[] {
  const dots = comps.filter((c) => {
    const w = c.x1 - c.x0 + 1;
    const h = c.y1 - c.y0 + 1;
    return c.size >= 1 && w <= 12 && h <= 12 && Math.max(w, h) <= 2 * Math.min(w, h) + 1;
  });
  if (dots.length < 5 || dots.length > 3000) return [];
  const n = dots.length;
  const dist = (a: Comp, b: Comp) => Math.hypot(a.cx - b.cx, a.cy - b.cy);
  const nn = dots.map((a) => {
    let best = Infinity;
    for (const b of dots) if (b !== a) best = Math.min(best, dist(a, b));
    return best;
  });
  const parent = dots.map((_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i] as number));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = dist(dots[i] as Comp, dots[j] as Comp);
      if (d <= 1.45 * Math.min(nn[i] as number, nn[j] as number) + 1) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Comp[]>();
  dots.forEach((d, i) => {
    const k = find(i);
    groups.set(k, [...(groups.get(k) ?? []), d]);
  });
  const rings: Ring[] = [];
  for (const members of groups.values()) {
    const k = members.length;
    if (k < 5 || k > 16) continue;
    // the centre of the circle through the dots (their mean is pulled away from the empty place)
    const { cx, cy } = circleCentre(members);
    const radii = members.map((m) => Math.hypot(m.cx - cx, m.cy - cy));
    const r = radii.reduce((a, b) => a + b, 0) / k;
    if (r < 3 || r > 90) continue;
    if (Math.max(...radii.map((x) => Math.abs(x - r))) > 0.22 * r + 0.6) continue;
    const sizes = members.map((m) => (m.x1 - m.x0 + 1 + (m.y1 - m.y0 + 1)) / 2);
    const dotD = sizes.reduce((a, b) => a + b, 0) / k;
    if (r < 1.1 * dotD) continue; // a blob, not a ring
    if (Math.max(...sizes) > 2.2 * Math.min(...sizes) + 1) continue;
    const angles = members.map((m) => Math.atan2(m.cy - cy, m.cx - cx)).sort((a, b) => a - b);
    const step = (2 * Math.PI) / k;
    let worst = 0;
    for (let i = 0; i < k; i++) {
      const a = angles[i] as number;
      const b = i + 1 < k ? (angles[i + 1] as number) : (angles[0] as number) + 2 * Math.PI;
      worst = Math.max(worst, b - a);
    }
    if (worst > 1.8 * step) continue;
    // phase: the middle of the widest gap, where the sticker has no dot
    let phase = 0;
    let widest = -1;
    for (let i = 0; i < k; i++) {
      const a = angles[i] as number;
      const b = i + 1 < k ? (angles[i + 1] as number) : (angles[0] as number) + 2 * Math.PI;
      if (b - a > widest) {
        widest = b - a;
        phase = (a + b) / 2;
      }
    }
    rings.push({
      members,
      cx,
      cy,
      r,
      dotR: dotD / 2,
      phase: Math.atan2(Math.sin(phase), Math.cos(phase)),
    });
  }
  return rings;
}

export function findExtras(
  image: PixelImage,
  background: Rgb,
  de: Float32Array,
  candles: CandleExtent[],
  options: ExtrasOptions = {},
): ExtrasFound {
  const { width, height } = image;
  if ((candles.length === 0 && !options.patternedOnly) || width < 16 || height < 16) return NONE;
  const lossy = options.lossy ?? false;
  // JPEG ringing is faint but real: ask for more before calling something a mark
  const weak = lossy ? 9 : WEAK;
  const { area, body } = candleMask(candles, width, height, lossy ? 6 : 2);
  const footprint = new Uint8Array(width * height);
  const extras: Extra[] = [];
  const counters = { line: 0, box: 0, text: 0, marker: 0 };
  const nextId = (k: 'line' | 'box' | 'text' | 'marker') =>
    `${k}-${String(++counters[k]).padStart(2, '0')}`;

  // ---- boxes
  const ink = new Float32Array(de); // ΔE from whatever is behind (the background, or a box)
  const boxes = options.patternedOnly ? [] : findBoxes(image, de, area, body, lossy, candles);
  for (const b of boxes) {
    const { x, y, width: w, height: h } = b.box;
    const tintLab = rgbToLab(...(b.tint.map(Math.round) as Rgb));
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const p = yy * width + xx;
        if (area[p]) continue;
        if (b.match[p]) {
          ink[p] = 0;
          footprint[p] = 1;
        } else {
          const [r, g, bl] = rgbAt(image, p).map(Math.round) as Rgb;
          ink[p] = deltaE(rgbToLab(r, g, bl), tintLab);
        }
      }
    }
    extras.push({ ...b.box, id: nextId('box') });
  }

  // ---- marks outside the candles, joined into pieces
  const mark = new Uint8Array(width * height);
  let marked = 0;
  for (let p = 0; p < mark.length; p++) {
    if (!area[p] && (ink[p] as number) >= weak) {
      mark[p] = 1;
      marked++;
    }
  }
  if (marked > 0.25 * width * height) return { extras, footprint: footprint }; // not a chart
  const comps: Comp[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mark.length; start++) {
    if (mark[start] !== 1) continue;
    const px: number[] = [];
    stack.push(start);
    mark[start] = 2;
    while (stack.length) {
      const p = stack.pop() as number;
      px.push(p);
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (mark[q] === 1) {
            mark[q] = 2;
            stack.push(q);
          }
        }
      }
    }
    // single specks are noise unless they turn out to be a dot of a dotted line
    comps.push(analyse(px, ink, width, area, height));
    if (comps.length > 6000) break;
  }

  const claimed = new Set<Comp>();
  const pixelsOf = (cs: Comp[]) => cs.flatMap((c) => c.px);

  // ---- rings of dots (the PSP marker): one shape, found before dotted lines can take its dots
  if (!options.patternedOnly) {
    for (const ring of findRings(comps)) {
      const pix = pixelsOf(ring.members);
      const peak = Math.max(...ring.members.map((c) => c.peak));
      // the sticker's own colour: the one its dots' middles have most often (edges are blended)
      const strong = pix.filter((p) => (ink[p] as number) >= 0.8 * peak);
      const counts = new Map<number, number>();
      for (const p of strong) {
        const [r0, g0, b0] = rgbAt(image, p);
        const key = (r0 << 16) | (g0 << 8) | b0;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      let top = 0;
      let topCount = -1;
      for (const [key, count] of counts) {
        if (count > topCount) {
          top = key;
          topCount = count;
        }
      }
      const own: Rgb = [(top >> 16) & 255, (top >> 8) & 255, top & 255];
      const cx = Math.round(ring.cx * 4) / 4;
      const cy = Math.round(ring.cy * 4) / 4;
      const r = Math.round(ring.r * 10) / 10;
      const dotR = Math.max(0.5, Math.round(ring.dotR * 4) / 4);
      extras.push({
        kind: 'marker',
        id: nextId('marker'),
        cx,
        cy,
        r,
        dotR,
        phase: ring.phase,
        color: rgbToHex(own),
        from: { cx, cy, r: r + dotR },
      });
      for (const m of ring.members) claimed.add(m);
      for (const p of pix) footprint[p] = 1;
    }
  }

  // How the pieces of one line follow each other, and which gaps a candle explains.
  const piecesAlong = (members: Comp[]) => {
    const fit0 = fitLine(pixelsOf(members), ink, width);
    const dx = Math.cos(fit0.angle);
    const dy = Math.sin(fit0.angle);
    const sorted = members
      .map((m) => ({
        m,
        a: (m.cx - fit0.cx) * dx + (m.cy - fit0.cy) * dy + m.t0,
        b: (m.cx - fit0.cx) * dx + (m.cy - fit0.cy) * dy + m.t1,
      }))
      .sort((p, q) => p.a - q.a);
    const gaps = sorted.slice(1).map((s, i) => {
      const prev = sorted[i] as { b: number };
      const gap = s.a - prev.b;
      const mid = (s.a + prev.b) / 2;
      const x = Math.floor(fit0.cx + mid * dx);
      const y = Math.floor(fit0.cy + mid * dy);
      const hidden = x >= 0 && y >= 0 && x < width && y < height && area[y * width + x] === 1;
      return { gap, hidden, index: i + 1 };
    });
    return { sorted, gaps };
  };

  // ---- lines made of pieces: solid, or cut by candles, or with long dashes
  const lineGroups: LineGroup[] = [];
  if (!options.patternedOnly) {
    const pieces = comps.filter(
      (c) =>
        isLinear(c) &&
        c.length >= 8 &&
        // the rest of a candle's wick, left over at its end
        !(c.touchesCandle && angleDiff(c.angle, Math.PI / 2) < 0.1 && c.length < 40),
    );
    for (const members of groupCollinear(pieces)) {
      if (!members.some((m) => m.length >= 25)) {
        // short pieces count as one line only when candles explain every gap between them
        if (members.length < 2) continue;
        const { sorted, gaps } = piecesAlong(members);
        const span =
          (sorted[sorted.length - 1] as { b: number }).b - (sorted[0] as { a: number }).a;
        if (span < 40 || gaps.some((g) => g.gap > 3 && !g.hidden)) continue;
      }
      lineGroups.push({ members, patterned: false });
      for (const m of members) claimed.add(m);
    }
  }

  // ---- dotted and dashed lines made of short pieces
  const shorts = comps.filter(
    (c) => !claimed.has(c) && (isDot(c) || (isLinear(c) && c.length < 25)),
  );
  const chainRules: ChainRules = options.patternedOnly
    ? { min: 6, minSpan: 60, width }
    : { min: 4, minSpan: 16, area, width };
  for (const chain of findChains(shorts, chainRules)) {
    lineGroups.push({ members: chain, patterned: true });
    for (const m of chain) claimed.add(m);
  }

  const lines: LineExtra[] = [];
  const linePixels: number[][] = [];
  const walk = (fit: LineFit, dir: 1 | -1, members: Set<number>): number => {
    const dx = Math.cos(fit.angle);
    const dy = Math.sin(fit.angle);
    const start = dir === 1 ? fit.t1 : fit.t0;
    let miss = 0;
    let last = start;
    for (let step = 1; step <= 40; step++) {
      const t = start + dir * (step - 0.5);
      const x = fit.cx + t * dx;
      const y = fit.cy + t * dy;
      let hit = false;
      for (let k = -1; k <= 1; k++) {
        const px = Math.floor(x - k * dy);
        const py = Math.floor(y + k * dx);
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const p = py * width + px;
        if (body[p]) return last;
        if ((ink[p] as number) >= WEAK) {
          hit = true;
          members.add(p);
        }
      }
      if (hit) {
        miss = 0;
        last = start + dir * step;
      } else if (++miss >= 2) break;
    }
    return last;
  };

  const pushLine = (members: Comp[], patterned: boolean, noWalk = false) => {
    const px = pixelsOf(members);
    const fit = fitLine(px, ink, width);
    const dx = Math.cos(fit.angle);
    const dy = Math.sin(fit.angle);
    const extra = new Set<number>();
    let { t0, t1 } = fit;
    if (!patterned && !noWalk) {
      const lo = walk(fit, -1, extra);
      const hi = walk(fit, 1, extra);
      t0 = Math.min(t0, lo);
      t1 = Math.max(t1, hi);
    }
    // ink strength, colour and thickness
    const all = [...px, ...extra];
    const values = all.map((p) => ink[p] as number);
    const peak = [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.9)] ?? 1;
    const strong = all.filter((p) => (ink[p] as number) >= 0.85 * peak);
    const col: Rgb = [0, 0, 0];
    for (const p of strong) {
      const c = rgbAt(image, p);
      col[0] += c[0];
      col[1] += c[1];
      col[2] += c[2];
    }
    const n = Math.max(1, strong.length);
    const color = rgbToHex([col[0] / n, col[1] / n, col[2] / n]);
    let weight = 0;
    const ts = new Set<number>();
    for (const p of all) {
      weight += Math.min(1, (ink[p] as number) / Math.max(1, peak));
      ts.add(
        Math.round(((p % width) + 0.5 - fit.cx) * dx + (Math.floor(p / width) + 0.5 - fit.cy) * dy),
      );
    }
    const per = weight / Math.max(1, ts.size);
    const widthPx = per <= 1.45 ? 1 : half(per);

    // dashes: pitch and dash length
    let dash: [number, number] | null = null;
    if (patterned || members.length > 1) {
      const sorted = members
        .map((m) => ({ m, t: (m.cx - fit.cx) * dx + (m.cy - fit.cy) * dy }))
        .sort((a, b) => a.t - b.t);
      const pitchList = sorted.slice(1).map((s, i) => s.t - (sorted[i] as { t: number }).t);
      const pitch = median(pitchList);
      const real = (m: Comp) => Math.max(1, m.length);
      if (patterned) {
        const on = Math.min(Math.max(1, half(median(members.map(real)))), pitch - 0.5);
        dash = [on, Math.max(0.5, half(pitch - on))];
        // start at the first element's own start so the pattern lines up
        const first = sorted[0] as { m: Comp; t: number };
        const last = sorted[sorted.length - 1] as { m: Comp; t: number };
        t0 = Math.min(first.t - real(first.m) / 2, t0);
        // Is there ink at this spot of the line (across its thickness)?
        const inkAt = (t: number): boolean => {
          for (let o = -1; o <= 1; o++) {
            const x = Math.floor(fit.cx + t * dx - o * dy);
            const y = Math.floor(fit.cy + t * dy + o * dx);
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const p = y * width + x;
            if (!body[p] && (ink[p] as number) >= WEAK) return true;
          }
          return false;
        };
        const gapLen = Math.max(0.5, pitch - on);
        // the pattern may continue where a candle's margin hid the next dots, but only while
        // there are real gaps between them (ink all the way along is a line or edge of its own)
        const reach = (from: number, dir: 1 | -1): number => {
          let at = from;
          for (let k = 1; k <= 8; k++) {
            if (inkAt(from + dir * ((k - 1) * pitch + on / 2 + gapLen / 2))) break;
            const t = from + dir * k * pitch;
            const x = fit.cx + t * dx;
            const y = fit.cy + t * dy;
            let seen = false;
            for (let oy = -1; oy <= 1 && !seen; oy++) {
              for (let ox = -1; ox <= 1; ox++) {
                const px = Math.floor(x) + ox;
                const py = Math.floor(y) + oy;
                if (px < 0 || py < 0 || px >= width || py >= height) continue;
                const p = py * width + px;
                if (!body[p] && (ink[p] as number) >= WEAK) {
                  seen = true;
                  extra.add(p);
                }
              }
            }
            if (!seen) break;
            at = t;
          }
          return at;
        };
        t0 = Math.min(t0, reach(first.t, -1) - real(first.m) / 2);
        t1 = Math.max(t1, reach(last.t, 1) + real(last.m) / 2);
        // Dashes that touch a candle are part of its blob: take them out by their colour.
        const lineRgb: Rgb = [col[0] / n, col[1] / n, col[2] / n];
        const far = Math.hypot(
          background[0] - lineRgb[0],
          background[1] - lineRgb[1],
          background[2] - lineRgb[2],
        );
        for (let t = t0; t < t1; t += pitch) {
          // a dash with ink in the gap beside it is not a dash: it lies on something solid
          if (
            (t - gapLen / 2 > t0 && inkAt(t - gapLen / 2)) ||
            (t + on + gapLen / 2 < t1 && inkAt(t + on + gapLen / 2))
          ) {
            continue;
          }
          for (let s = 0; s < on; s += 0.5) {
            for (let o = -1; o <= 1; o++) {
              const x = Math.floor(fit.cx + (t + s) * dx - o * dy);
              const y = Math.floor(fit.cy + (t + s) * dy + o * dx);
              if (x < 0 || y < 0 || x >= width || y >= height) continue;
              const p = y * width + x;
              const c = rgbAt(image, p);
              const d = Math.hypot(c[0] - lineRgb[0], c[1] - lineRgb[1], c[2] - lineRgb[2]);
              if (d <= 0.35 * far) extra.add(p);
            }
          }
        }
      }
    }
    // endpoints
    const p1 = { x: fit.cx + t0 * dx, y: fit.cy + t0 * dy };
    const p2 = { x: fit.cx + t1 * dx, y: fit.cy + t1 * dy };
    const clampX = (v: number) => Math.min(width, Math.max(0, v));
    const clampY = (v: number) => Math.min(height, Math.max(0, v));
    lines.push({
      kind: 'line',
      id: '',
      x1: clampX(p1.x),
      y1: clampY(p1.y),
      x2: clampX(p2.x),
      y2: clampY(p2.y),
      color,
      width: widthPx,
      dash,
    });
    linePixels.push([...new Set([...all, ...extra])]);
  };

  for (const g of lineGroups) {
    if (g.patterned) {
      pushLine(g.members, true);
      continue;
    }
    // long pieces: is the line dashed (regular real gaps) or simply cut by candles?
    const { sorted, gaps } = piecesAlong(g.members);
    const real = gaps.filter((x) => x.gap > 3 && !x.hidden).map((x) => x.gap);
    const cut = gaps.filter((x) => x.gap > 3 && !x.hidden).map((x) => x.index);
    if (real.length === 0) {
      pushLine(g.members, false);
      continue;
    }
    const pitch = median(sorted.slice(1).map((s, i) => s.a - (sorted[i] as { a: number }).a));
    const pieceLens = sorted.map((s) => s.b - s.a);
    const regular =
      sorted.length >= 3 &&
      real.every((gap) => Math.abs(gap - median(real)) <= 0.3 * Math.max(1, median(real))) &&
      pieceLens.every((l) => Math.abs(l - median(pieceLens)) <= 0.35 * median(pieceLens));
    if (regular) {
      const on = half(median(pieceLens));
      const lineFit = fitLine(pixelsOf(g.members), ink, width);
      void lineFit;
      pushLine(g.members, true);
      const last = lines[lines.length - 1] as LineExtra;
      last.dash = [Math.max(1, on), Math.max(0.5, half(pitch - on))];
    } else {
      // separate lines at the real gaps
      let from = 0;
      for (const c of [...cut, sorted.length]) {
        pushLine(
          sorted.slice(from, c).map((s) => s.m),
          false,
        );
        from = c;
      }
    }
  }
  // Slanted lines can touch a wick, so they are found by their shape alone, before the candles
  // are known. (Later, with the candles known, they are ordinary pieces.)
  if (options.patternedOnly) {
    for (const run of findSlanted(ink, width, height, weak)) {
      pushLine([analyse(run.pixels, ink, width, area, height)], false, true);
    }
  }
  lines.forEach((l, i) => {
    if (isCandleEdge(l, candles)) {
      // not a line of its own: a border or wick of a candle that was only partly read
      return;
    }
    extras.push({ ...l, id: nextId('line') });
    for (const p of linePixels[i] as number[]) footprint[p] = 1;
  });

  // ---- text
  const glyphCandidates = comps.filter((c) => {
    if (options.patternedOnly || claimed.has(c)) return false;
    const h = c.y1 - c.y0 + 1;
    const w = c.x1 - c.x0 + 1;
    return c.size >= 2 && h <= 64 && w <= 90;
  });
  for (const g of groupText(glyphCandidates)) {
    const real = g.comps.filter((c) => c.size >= 4);
    const gh = g.y1 - g.y0 + 1;
    // letters of one size, at least three of them: a label, a price, a time, a watermark
    const tall = real.filter((c) => c.y1 - c.y0 + 1 >= 0.6 * gh);
    // (small letters can touch and join up, so a long, low group also counts)
    const wide = g.x1 - g.x0 + 1 >= 2.2 * gh && (real.length >= 2 || (real[0]?.size ?? 0) >= 40);
    if (tall.length < 3 && !wide) continue;
    if (gh < 5 || gh > 64) continue;
    // marks that only lean on a candle are leftovers of it, not text
    if (g.comps.filter((c) => c.touchesCandle).length >= 0.6 * g.comps.length) continue;
    // letter colour: the strongest pixels
    const pix = g.comps.flatMap((c) => c.px);
    const peak = Math.max(...g.comps.map((c) => c.peak));
    const strong = pix.filter((p) => (ink[p] as number) >= 0.8 * peak);
    const col: Rgb = [0, 0, 0];
    for (const p of strong) {
      const c = rgbAt(image, p);
      col[0] += c[0];
      col[1] += c[1];
      col[2] += c[2];
    }
    const n = Math.max(1, strong.length);
    const heights = real.map((c) => c.y1 - c.y0 + 1);
    const cap = Math.max(...heights);
    const bottoms = real.map((c) => c.y1 + 1);
    const baseline = median(bottoms);
    const text: TextExtra = {
      kind: 'text',
      id: nextId('text'),
      x: g.x0,
      y: baseline,
      text: '',
      size: Math.max(6, Math.round(cap / 0.716)),
      weight: estimateWeight(pix, ink, width, peak, cap),
      color: rgbToHex([col[0] / n, col[1] / n, col[2] / n]),
      region: { x: g.x0, y: g.y0, width: g.x1 - g.x0 + 1, height: gh },
      from: { x: g.x0, y: g.y0, width: g.x1 - g.x0 + 1, height: gh },
      unread: true,
      trace: tracePixels(
        pix.filter((p) => (ink[p] as number) >= 0.45 * peak),
        width,
      ),
    };
    extras.push(text);
    for (const p of pix) footprint[p] = 1;
  }

  return { extras, footprint };
}

/** The colour maps with everything that was found taken out, so candles can be read cleanly. */
export function withoutFootprint(
  de: Float32Array,
  dl: Float32Array,
  footprint: Uint8Array,
  width: number,
  height: number,
): { de: Float32Array; dl: Float32Array } {
  const outDe = new Float32Array(de);
  const outDl = new Float32Array(dl);
  for (let p = 0; p < footprint.length; p++) {
    if (!footprint[p]) continue;
    const x = p % width;
    const y = (p - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        // only blank marks: never grow into something strong that is not ours
        const q = ny * width + nx;
        if (dx === 0 && dy === 0) {
          outDe[q] = 0;
          outDl[q] = 0;
        } else if ((de[q] as number) < STRONG) {
          outDe[q] = 0;
          outDl[q] = 0;
        }
      }
    }
  }
  return { de: outDe, dl: outDl };
}

/** Just the ΔE map, with what was found taken out. */
export function withoutFootprintDe(de: Float32Array, footprint: Uint8Array): Float32Array {
  if (footprint.length === 0) return de;
  const out = new Float32Array(de);
  for (let p = 0; p < footprint.length; p++) if (footprint[p]) out[p] = 0;
  return out;
}

/** What findThinLines needs to know about each candle. */
export interface ThinLineCandle {
  bodyTop: number;
  bodyBottom: number;
  wickTop: number | null;
  wickBottom: number | null;
  borderRgb: Rgb;
  wickRgb: Rgb | null;
}

/**
 * Short level lines drawn from a candle's side (TradingView starts them at the candle). Their
 * columns overlap the candle, so the candle reader would take them as part of it. Found by
 * colour: 1 or 2 px thick, nothing above or below, a colour no candle has, one colour from end
 * to end, starting or ending right next to other ink, and open at least at one end.
 */
export function findThinLines(
  image: PixelImage,
  de: Float32Array,
  candles: ThinLineCandle[],
): { lines: LineExtra[]; footprint: Uint8Array } {
  const { width, height, data } = image;
  const footprint = new Uint8Array(width * height);
  const lines: LineExtra[] = [];
  const real = candles.filter(
    (c) =>
      Number.isFinite(c.bodyTop) && Number.isFinite(c.bodyBottom) && c.bodyBottom - c.bodyTop > 2,
  );
  if (real.length < 2) return { lines, footprint };
  // a colour counts as a candle's when two candles have it (a line can stretch one candle to it)
  const each = real.flatMap((c) =>
    [c.borderRgb, c.wickRgb].flatMap((rgb) =>
      rgb ? [rgbToLab(...(rgb.map(Math.round) as Rgb))] : [],
    ),
  );
  const candleLabs = each.filter(
    (l, i) => each.filter((m, j) => j !== i && deltaE(l, m) <= 10).length >= 1,
  );
  if (candleLabs.length === 0) return { lines, footprint };
  const maxLen = Math.max(48, 0.3 * width);
  const labAt = (p: number) =>
    rgbToLab(data[p * 4] as number, data[p * 4 + 1] as number, data[p * 4 + 2] as number);
  const inked = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && (de[y * width + x] as number) >= 12;
  const quietAt = (x: number, y: number) =>
    y < 0 || y >= height || (de[y * width + x] as number) < WEAK;
  const MAX_ROWS = 2;
  /** How many rows of ink go down from (x, y) before it is empty again; 0 if more than MAX_ROWS. */
  const depth = (x: number, y: number) => {
    for (let t = 1; t <= MAX_ROWS; t++) if (quietAt(x, y + t)) return t;
    return 0;
  };
  // a pixel of a thin row: ink with nothing right above it, and empty again within a few rows
  const thin = (x: number, y: number) => inked(x, y) && quietAt(x, y - 1) && depth(x, y) > 0;
  /** No ink there, and no candle side going up or down from it. */
  const free = (x0: number, y: number, rows: number) =>
    [x0 - 1, x0, x0 + 1].every(
      (xx) => !inked(xx, y) && !inked(xx, y - 3) && !inked(xx, y + rows + 2),
    );
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      // cheap first: a run of thin pixels, whatever their colour
      if (!thin(x, y)) {
        x++;
        continue;
      }
      let b = x;
      while (b + 1 < width && thin(b + 1, y)) b++;
      const a0 = x;
      x = b + 1;
      if (b - a0 + 1 < 12) continue;
      // then split it where the colour changes (a candle's border, then the line)
      let s0 = a0;
      while (s0 <= b) {
        const first = labAt(y * width + s0);
        let e = s0;
        while (e + 1 <= b && deltaE(labAt(y * width + e + 1), first) <= 15) e++;
        const s = s0;
        s0 = e + 1;
        const len = e - s + 1;
        if (len < 12 || len > maxLen) continue;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        for (let xx = s; xx <= e; xx++) {
          const q = y * width + xx;
          sr += data[q * 4] as number;
          sg += data[q * 4 + 1] as number;
          sb += data[q * 4 + 2] as number;
        }
        const mean: Rgb = [sr / len, sg / len, sb / len];
        const meanLab = rgbToLab(...(mean.map(Math.round) as Rgb));
        if (candleLabs.some((c) => deltaE(meanLab, c) <= 25)) continue;
        const depths = [];
        for (let xx = s; xx <= e; xx++) depths.push(depth(xx, y));
        depths.sort((p, q) => p - q);
        const rows = depths[depths.length >> 1] as number;
        let quiet = 0;
        for (let xx = s; xx <= e; xx++) if (quietAt(xx, y - 1) && quietAt(xx, y + rows)) quiet++;
        if (quiet < 0.85 * len) continue;
        // drawn from a candle: one end touches ink, the other is open (a line across the chart
        // is cut by candles at both ends of every piece)
        // touching a candle: ink that also goes up or down (not the line's own soft end)
        const solid = (xx: number) =>
          inked(xx, y) && (inked(xx, y - 1) || inked(xx, y + rows) || inked(xx, y - 2));
        const touchL = solid(s - 1) || solid(s - 2);
        const touchR = solid(e + 1) || solid(e + 2);
        // (one pixel of slack at the open end: its last pixel is often soft)
        if (touchL === touchR) continue; // touched at both ends: a hollow candle's border
        if (!((touchL && free(e + 3, y, rows)) || (touchR && free(s - 3, y, rows)))) continue;
        // the same colour again past the candle it touches: one long line through the candles
        const goesOn = (from: number, dir: 1 | -1) => {
          let xx = from;
          for (let k = 0; k < 80 && inked(xx, y); k++) xx += dir;
          for (let k = 0; k < 3; k++, xx += dir) {
            if (xx < 0 || xx >= width) return false;
            if (inked(xx, y) && deltaE(labAt(y * width + xx), meanLab) <= 15) return true;
          }
          return false;
        };
        if ((touchL && goesOn(s - 1, -1)) || (touchR && goesOn(e + 1, 1))) continue;
        lines.push({
          kind: 'line',
          id: '',
          x1: s,
          y1: y + rows / 2,
          x2: e + 1,
          y2: y + rows / 2,
          color: rgbToHex(mean.map(Math.round) as Rgb),
          width: rows,
          dash: null,
        });
        for (let r = 0; r < rows; r++) {
          for (let xx = s; xx <= e; xx++) footprint[(y + r) * width + xx] = 1;
        }
      }
    }
  }
  return { lines, footprint };
}
