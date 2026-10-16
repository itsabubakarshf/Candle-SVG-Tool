/**
 * "Is this chart clean?" (only candles, nothing else).
 *
 * The check never looks at candle colours. It asks what is drawn where no candle can explain
 * it: ink outside every candle's body and wick, with a margin for blur and JPEG ringing.
 * It only reports structured evidence, so that a clean chart never gets a false warning:
 *
 *  - lines:  a long straight run of marks (grid line, level line, edge of a box);
 *  - shapes: a large shaded area (a box or tint);
 *  - text:   a cluster of small glyph-like marks (price scale, labels, a watermark).
 *
 * Anything vague (a stray speck, faint noise) is ignored.
 */

export type CleanIssue = 'lines' | 'shapes' | 'text';

export interface CleanReport {
  clean: boolean;
  /** Which kinds of extra content were found. Empty when the chart is clean. */
  issues: CleanIssue[];
}

/** Where a detected candle is, in source pixels. */
export interface CandleExtent {
  centerX: number;
  bodyLeft: number;
  bodyRight: number;
  bodyTop: number;
  bodyBottom: number;
  wickTop: number | null;
  wickBottom: number | null;
  /** What the body is filled with, when known. */
  fill?: [number, number, number];
}

export interface CleanOptions {
  /** JPEG / lossy WebP: compression ringing reaches further from an edge. */
  lossy?: boolean;
  /** A long horizontal line was already found (and removed) before candles were detected. */
  knownLines?: boolean;
  /**
   * Called only when something was found, to double-check before warning: returns candles that
   * the first pass did not read (faint ones). What they cover is not an "extra".
   */
  moreCandles?: () => CandleExtent[];
}

/** ΔE from the background at which a mark is visible at all (a faint grid line is ~5). */
const WEAK = 4;
/** ΔE of solid ink (text, a drawn line). */
const STRONG = 24;
/** A chain of marks may skip this many pixels (dotted and dashed lines). */
const MAX_GAP = 6;

/** Below this body width (px) the check stays silent: marks and candles cannot be told apart. */
const MIN_CANDLE_WIDTH = 6;

const CLEAN: CleanReport = { clean: true, issues: [] };

export function checkClean(
  de: Float32Array,
  width: number,
  height: number,
  candles: CandleExtent[],
  options: CleanOptions = {},
): CleanReport {
  if (candles.length === 0 || width < 8 || height < 8) return CLEAN;
  const first = scan(de, width, height, candles, options);
  if (first.clean || !options.moreCandles) return first;
  // Something was found. Before warning, make sure it is not just candles we failed to read.
  const extra = options.moreCandles();
  if (extra.length === 0) return first;
  return scan(de, width, height, [...candles, ...extra], options);
}

/** Looks for extras once, treating `candles` as the only things that belong on the chart. */
function scan(
  de: Float32Array,
  width: number,
  height: number,
  allCandles: CandleExtent[],
  options: CleanOptions,
): CleanReport {
  // Blur reaches ~2 px, resampling ~2 px, JPEG up to one 8 x 8 block.
  const margin = options.lossy ? 10 : 6;

  // Something far narrower than the usual candle (a digit read as a candle) explains nothing.
  const widths = allCandles.map((c) => c.bodyRight - c.bodyLeft).sort((a, b) => a - b);
  const usual = widths[Math.floor(widths.length / 2)] as number;
  // Candles this small look like specks and text: nothing can be told apart reliably. Say nothing.
  if (usual < MIN_CANDLE_WIDTH) return CLEAN;
  const candles = allCandles.filter((c) => c.bodyRight - c.bodyLeft >= 0.4 * usual);

  // ---- what the candles explain: body and wick boxes, row by row
  const rowIntervals: number[][] = Array.from({ length: height }, () => []);
  const addRect = (x0: number, x1: number, y0: number, y1: number) => {
    const a = Math.max(0, Math.floor(x0));
    const b = Math.min(width - 1, Math.ceil(x1));
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(height - 1, Math.ceil(y1)); y++) {
      (rowIntervals[y] as number[]).push(a, b);
    }
  };
  for (const c of candles) {
    addRect(c.bodyLeft - margin, c.bodyRight + margin, c.bodyTop - margin, c.bodyBottom + margin);
    addRect(
      c.centerX - 2 - margin,
      c.centerX + 2 + margin,
      (c.wickTop ?? c.bodyTop) - margin,
      (c.wickBottom ?? c.bodyBottom) + margin,
    );
  }
  const merged: number[][] = rowIntervals.map(mergeIntervals);

  // ---- marks outside every candle, and the longest straight chain of them
  const mark = new Uint8Array(width * height); // 1 = faint mark, 2 = solid ink
  const explained = new Uint8Array(width * height); // 1 = inside a candle's area
  const colRun = new Int32Array(width);
  const colGap = new Int32Array(width);
  let marked = 0;
  let longestRow = 0;
  let longestCol = 0;
  for (let y = 0; y < height; y++) {
    const iv = merged[y] as number[];
    let k = 0;
    let rowRun = 0;
    let rowGap = 0;
    for (let x = 0; x < width; x++) {
      while (k < iv.length && x > (iv[k + 1] as number)) k += 2;
      if (k < iv.length && x >= (iv[k] as number)) {
        const end = iv[k + 1] as number; // explained by a candle: skip to its end
        explained.fill(1, y * width + x, y * width + end + 1);
        x = end;
        continue;
      }
      const v = de[y * width + x] as number;
      if (v >= WEAK) {
        mark[y * width + x] = v >= STRONG ? 2 : 1;
        marked++;
        rowRun += rowGap + 1;
        rowGap = 0;
        if (rowRun > longestRow) longestRow = rowRun;
        colRun[x] = (colRun[x] as number) + (colGap[x] as number) + 1;
        colGap[x] = 0;
        if ((colRun[x] as number) > longestCol) longestCol = colRun[x] as number;
      } else {
        if (++rowGap > MAX_GAP) {
          rowRun = 0;
          rowGap = 0;
        }
        colGap[x] = (colGap[x] as number) + 1;
        if ((colGap[x] as number) > MAX_GAP) {
          colRun[x] = 0;
          colGap[x] = 0;
        }
      }
    }
  }
  const issues = new Set<CleanIssue>();
  if (options.knownLines) issues.add('lines');
  if (marked === 0) return report(issues); // the common case: nothing outside the candles

  // Lines: a horizontal chain of marks as long as a quarter of the image, or a vertical one
  // most of its height (a candle that was missed also leaves a tall, thin chain).
  if (longestRow >= Math.max(30, 0.25 * width) || longestCol >= Math.max(30, 0.6 * height)) {
    issues.add('lines');
  }

  // ---- connected groups of marks
  let glyphLike = 0; // small solid-ink groups: letters, digits, markers
  let faintGlyphLike = 0; // small faint groups: a watermark
  const stack: number[] = [];
  for (let start = 0; start < mark.length; start++) {
    if (mark[start] !== 1 && mark[start] !== 2) continue; // none, or already in a group
    let size = 0;
    let solid = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let nearCandle = false; // touches a candle's area
    stack.push(start);
    mark[start] = mark[start] === 2 ? 4 : 3; // visited (3 = faint, 4 = solid)
    while (stack.length > 0) {
      const p = stack.pop() as number;
      const px = p % width;
      const py = (p - px) / width;
      size++;
      if (mark[p] === 4) solid++;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (explained[q]) nearCandle = true;
          const m = mark[q] as number;
          if (m === 1 || m === 2) {
            mark[q] = m === 2 ? 4 : 3;
            stack.push(q);
          }
        }
      }
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    // A candle the first pass missed (JPEG noise can hide one): as wide as the usual candle and
    // drawn in solid ink. It is not an extra.
    if (
      usual > 0 &&
      w >= 0.5 * usual &&
      w <= 2.5 * usual &&
      h >= 6 &&
      solid >= 0.015 * size &&
      solid >= 6
    ) {
      continue;
    }
    // Shapes: one large shaded area.
    // (a box over the candles is cut up by them, so also accept compact, well-filled pieces)
    if (size >= 600 && w >= 40 && h >= 40) issues.add('shapes');
    else if (size >= 300 && Math.min(w, h) >= 10 && size >= 0.5 * w * h && solid < 0.25 * size) {
      issues.add('shapes'); // (mostly solid pieces are the rest of a candle, not a shaded area)
    }
    // The rest of a candle that was only partly read: its own colour, or a thin upright strip.
    if (nearCandle && (solid > 0 || (w <= 4 && h >= Math.max(12, 3 * w)))) continue;
    // Glyph-like groups are small in both directions (lines are long, boxes are big).
    if (w <= 40 && h <= 40) {
      if (solid >= 4) glyphLike++;
      else if (size >= 10) faintGlyphLike++;
    } else if (w <= 120 && h <= 120 && solid === 0 && size >= 12) {
      faintGlyphLike++; // large faint lettering
    }
  }
  if (glyphLike >= 3 || faintGlyphLike >= 4) issues.add('text');

  return report(issues);
}

function report(issues: Set<CleanIssue>): CleanReport {
  const list = (['lines', 'shapes', 'text'] as const).filter((i) => issues.has(i));
  return { clean: list.length === 0, issues: list };
}

/** Solid ink for the line stripper (same as STRONG, kept separate for clarity). */
const LINE_INK = 24;
/**
 * A line to remove is unbroken (flat candles side by side leave small gaps between them, and
 * are not a line). Dashed lines are still found by the scan, from where the marks are.
 */
const LINE_GAP = 1;

export interface StrippedLines {
  de: Float32Array;
  dl: Float32Array;
  /** At least one long horizontal line was found. */
  found: boolean;
}

/**
 * Candle detection splits the image into columns, so a strong horizontal line across the chart
 * (a level line, an entry line) joins every candle into one blob. Find such lines and blank
 * them in the maps used for detection, so the candles can still be read.
 *
 * A line is told apart from a candle's border by its columns: a column that has no other ink
 * than the line is a gap between candles, so the line pixel there is removed. A candle's column
 * always has more ink (its other border, its wick, its body), so nothing of a candle is touched,
 * even when candles touch and a row of borders runs the whole width of the chart.
 * Returns the original arrays when there is nothing to remove.
 */
export function stripLongLines(
  de: Float32Array,
  dl: Float32Array,
  width: number,
  height: number,
): StrippedLines {
  const minLength = Math.max(48, 0.3 * width);
  type Run = { y: number; a: number; b: number };
  const runs: Run[] = [];
  for (let y = 0; y < height; y++) {
    let start = -1;
    let last = -1;
    for (let x = 0; x <= width; x++) {
      const ink = x < width && (de[y * width + x] as number) >= LINE_INK;
      if (ink) {
        if (start < 0) start = x;
        last = x;
      } else if (start >= 0 && (x === width || x - last > LINE_GAP)) {
        if (last - start + 1 >= minLength) runs.push({ y, a: start, b: last });
        start = -1;
      }
    }
  }
  if (runs.length === 0) return { de, dl, found: false };

  // Runs in neighbouring rows that overlap are one (thick) line.
  const groups: Array<{ top: number; bottom: number; a: number; b: number }> = [];
  for (const r of runs) {
    const g = groups.find(
      (q) => r.y <= q.bottom + 1 && r.y >= q.top - 1 && r.a <= q.b && r.b >= q.a,
    );
    if (g) {
      g.top = Math.min(g.top, r.y);
      g.bottom = Math.max(g.bottom, r.y);
      g.a = Math.min(g.a, r.a);
      g.b = Math.max(g.b, r.b);
    } else groups.push({ top: r.y, bottom: r.y, a: r.a, b: r.b });
  }
  const lines = groups.filter((g) => g.bottom - g.top <= 4); // thicker is a block, not a line

  // Solid ink per column.
  const colInk = new Int32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((de[y * width + x] as number) >= LINE_INK) colInk[x] = (colInk[x] as number) + 1;
    }
  }

  // Ink that belongs to the lines themselves, per column.
  const lineInk = new Int32Array(width);
  for (const g of lines) {
    for (let x = g.a; x <= g.b; x++) {
      for (let y = Math.max(0, g.top - 1); y <= Math.min(height - 1, g.bottom + 1); y++) {
        if ((de[y * width + x] as number) >= LINE_INK) lineInk[x] = (lineInk[x] as number) + 1;
      }
    }
  }
  // A column with nothing but lines in it is a candidate gap. Anything else in a column (a
  // border, a wick, a body) means a candle is there.
  const gap = new Uint8Array(width);
  for (let x = 0; x < width; x++) {
    gap[x] = (lineInk[x] as number) > 0 && (colInk[x] as number) <= (lineInk[x] as number) ? 1 : 0;
  }

  // Two borders of one hollow candle look like two lines with a "gap" between them. Tell them
  // apart from real lines: a hollow body is closed at both ends by vertical ink and is not tall.
  const apart = Math.max(80, 0.3 * height);
  const inkBetween = (x: number, y0: number, y1: number): number => {
    let ink = 0;
    for (let y = y0; y <= y1; y++) if ((de[y * width + x] as number) >= LINE_INK) ink++;
    return ink;
  };
  /** Walks outward from x to the first column with ink between the lines: its x if that is a full edge. */
  const edge = (from: number, dir: 1 | -1, y0: number, y1: number): number => {
    for (let x = from; x >= 0 && x < width; x += dir) {
      const next = x + dir >= 0 && x + dir < width ? inkBetween(x + dir, y0, y1) : 0;
      const ink = Math.max(inkBetween(x, y0, y1), next);
      if (ink >= 0.3 * (y1 - y0 + 1)) return ink >= 0.8 * (y1 - y0 + 1) ? x : -1; // a stray pixel is ignored
    }
    return -1;
  };
  /** A wick above the top line or below the bottom line, between the two edges. */
  const wickOutside = (xl: number, xr: number, top: number, bottom: number): boolean => {
    for (let x = xl + 1; x < xr; x++) {
      if (inkBetween(x, Math.max(0, top - 3), Math.max(0, top - 1)) > 0) return true;
      if (inkBetween(x, Math.min(height - 1, bottom + 1), Math.min(height - 1, bottom + 3)) > 0) {
        return true;
      }
    }
    return false;
  };

  const outDe = new Float32Array(de);
  const outDl = new Float32Array(dl);
  const stripped = new Uint8Array(width);
  const confirmed = new Set<(typeof lines)[number]>();
  for (let a = 0; a < width; a++) {
    if (!gap[a]) continue;
    let b = a;
    while (b + 1 < width && gap[b + 1]) b++;
    const covering = lines.filter((g) => g.a <= a && g.b >= b);
    const hollow = new Set<(typeof lines)[number]>();
    for (const g1 of covering) {
      for (const g2 of covering) {
        const between = g2.top - g1.bottom - 1;
        if (between < 1) continue;
        const xl = edge(a - 1, -1, g1.bottom + 1, g2.top - 1);
        const xr = edge(b + 1, 1, g1.bottom + 1, g2.top - 1);
        if (xl < 0 || xr < 0) continue;
        // Closed on both sides: a hollow candle body (it has a wick sticking out, or is small)
        // or a drawn box (tall, nothing sticking out).
        if (between < apart || wickOutside(xl, xr, g1.top, g2.bottom)) {
          hollow.add(g1);
          hollow.add(g2);
        }
      }
    }
    for (const g of lines) {
      if (hollow.has(g) || g.a > b || g.b < a) continue;
      confirmed.add(g);
      for (let x = Math.max(a, g.a); x <= Math.min(b, g.b); x++) {
        for (let y = Math.max(0, g.top - 1); y <= Math.min(height - 1, g.bottom + 1); y++) {
          outDe[y * width + x] = 0;
          outDl[y * width + x] = 0;
        }
        stripped[x] = 1;
      }
    }
    a = b;
  }
  // Where such a line passes a candle's column without touching the candle (it runs above or
  // below it), the line is removed there too, or it would stretch the candle up to the line.
  const faint = 8;
  for (const g of confirmed) {
    const y0 = Math.max(0, g.top - 1);
    const y1 = Math.min(height - 1, g.bottom + 1);
    for (let x = g.a; x <= g.b; x++) {
      if (stripped[x]) continue;
      let touching = false;
      for (let dx = -1; dx <= 1 && !touching; dx++) {
        const cx = x + dx;
        if (cx < 0 || cx >= width) continue;
        for (const y of [y0 - 2, y0 - 1, y1 + 1, y1 + 2]) {
          if (y >= 0 && y < height && (de[y * width + cx] as number) >= faint) touching = true;
        }
      }
      if (touching) continue;
      for (let y = y0; y <= y1; y++) {
        outDe[y * width + x] = 0;
        outDl[y * width + x] = 0;
      }
    }
  }
  // Only a line that crosses the gaps between candles counts (and needs removing).
  let columns = 0;
  for (let x = 0; x < width; x++) columns += stripped[x] as number;
  if (columns < 8) return { de, dl, found: false };
  return { de: outDe, dl: outDl, found: true };
}

/** Sorts [a, b, a, b, ...] pairs and merges the ones that touch or overlap. */
function mergeIntervals(flat: number[]): number[] {
  if (flat.length <= 2) return flat;
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < flat.length; i += 2) pairs.push([flat[i] as number, flat[i + 1] as number]);
  pairs.sort((p, q) => p[0] - q[0]);
  const out: number[] = [];
  let [a, b] = pairs[0] as [number, number];
  for (let i = 1; i < pairs.length; i++) {
    const [c, d] = pairs[i] as [number, number];
    if (c <= b + 1) b = Math.max(b, d);
    else {
      out.push(a, b);
      a = c;
      b = d;
    }
  }
  out.push(a, b);
  return out;
}
