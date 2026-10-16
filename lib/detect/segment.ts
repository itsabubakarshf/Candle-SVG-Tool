import { coverageOf } from './coverage';
import type { DetectSettings } from './types';

/** A candle's columns, inclusive on both ends. */
export interface Cluster {
  left: number;
  right: number;
  /** True when this cluster was cut out of a wider, merged one. */
  split: boolean;
}

/** Tolerance (in rows) when deciding whether two columns end at the same height. */
const STEP = 1.5;
/** A wick is at most this many columns wide. */
const MAX_WICK_COLS = 3;
const MIN_CLUSTER_COVERAGE = 2;

/**
 * Step 4: split the image into candle columns.
 * A column is "active" when some pixel in it is at least half covered.
 */
export function columnRuns(
  de: Float32Array,
  width: number,
  height: number,
  settings: DetectSettings,
): Cluster[] {
  const { tLow, tHigh } = settings;
  const strong = strongThreshold(settings);
  const colMax = new Float32Array(width);
  const colSum = new Float32Array(width);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const v = de[row + x] as number;
      if (v <= tLow) continue;
      if (v > (colMax[x] as number)) colMax[x] = v;
      colSum[x] = (colSum[x] as number) + coverageOf(v, tLow, tHigh);
    }
  }

  const runs: Cluster[] = [];
  let start = -1;
  for (let x = 0; x <= width; x++) {
    const active = x < width && (colMax[x] as number) >= strong;
    if (active && start < 0) start = x;
    if (!active && start >= 0) {
      let total = 0;
      for (let i = start; i < x; i++) total += colSum[i] as number;
      if (total >= MIN_CLUSTER_COVERAGE) runs.push({ left: start, right: x - 1, split: false });
      start = -1;
    }
  }

  return runs;
}

/** Candle columns: the runs of active columns, with touching candles cut apart. */
export function segmentColumns(
  de: Float32Array,
  width: number,
  height: number,
  settings: DetectSettings,
): Cluster[] {
  const strong = strongThreshold(settings);
  const out: Cluster[] = [];
  for (const run of columnRuns(de, width, height, settings)) {
    out.push(...splitCluster(de, width, height, strong, run));
  }
  return out;
}

/** ΔE at which a pixel counts as "at least half covered". */
export function strongThreshold(settings: DetectSettings): number {
  return settings.tLow + 0.5 * (settings.tHigh - settings.tLow);
}

interface Run {
  start: number;
  end: number;
  value: number;
}

/**
 * Touching candles end up in one cluster. Cut it where
 *  - the top or bottom outline steps to a new level (a different body), or
 *  - two separate wick spikes appear (two candles with matching bodies).
 */
function splitCluster(
  de: Float32Array,
  width: number,
  height: number,
  strong: number,
  cluster: Cluster,
): Cluster[] {
  const n = cluster.right - cluster.left + 1;
  if (n < 8) return [cluster];

  const top = new Array<number>(n).fill(0);
  const bottom = new Array<number>(n).fill(0);
  const count = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const x = cluster.left + i;
    let first = -1;
    let last = -1;
    let c = 0;
    for (let y = 0; y < height; y++) {
      if ((de[y * width + x] as number) >= strong) {
        if (first < 0) first = y;
        last = y;
        c++;
      }
    }
    top[i] = first < 0 ? 0 : first;
    bottom[i] = last < 0 ? 0 : last;
    count[i] = c;
  }

  const upper = analyse(top, -1);
  const lower = analyse(bottom, 1);

  // Cue 1: the outline steps to a new level.
  const cuts: number[] = [...upper.steps, ...lower.steps];

  // Cue 2: two distinct wick spikes with no step between them.
  const spikes = mergeNear(
    [...upper.spikes, ...lower.spikes].sort((a, b) => a - b),
    MAX_WICK_COLS,
  );
  for (let k = 0; k + 1 < spikes.length; k++) {
    const p = spikes[k] as number;
    const q = spikes[k + 1] as number;
    if (q - p < 6) continue;
    if (cuts.some((c) => c > p && c <= q)) continue;
    cuts.push(boundaryBetween(count, p, q));
  }

  // Cuts are whole columns: where two cues point at nearly the same place, take their middle.
  const sorted = mergeNear(
    cuts.filter((c) => c > 0 && c < n).sort((a, b) => a - b),
    2,
  ).map(Math.round);
  if (sorted.length === 0) return [cluster];

  const pieces: Cluster[] = [];
  let from = 0;
  for (const cut of [...sorted, n]) {
    if (cut - from >= 3) {
      pieces.push({ left: cluster.left + from, right: cluster.left + cut - 1, split: true });
      from = cut;
    }
  }
  return pieces.length > 1 ? pieces : [cluster];
}

/**
 * Looks at one outline (top or bottom row of each column).
 * `dir` is -1 for the top outline (a wick reaches up = smaller row), +1 for the bottom.
 * Returns the narrow spikes (wicks) and the column where the plateau level steps.
 */
function analyse(values: number[], dir: 1 | -1): { spikes: number[]; steps: number[] } {
  const runs: Run[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    const last = runs[runs.length - 1];
    if (last && Math.abs(v - last.value) <= STEP) last.end = i;
    else runs.push({ start: i, end: i, value: v });
  }

  const spikes: number[] = [];
  const plateaus: Run[] = [];
  runs.forEach((run, k) => {
    const len = run.end - run.start + 1;
    const prev = runs[k - 1];
    const next = runs[k + 1];
    const beyond = (neighbour: Run) => (run.value - neighbour.value) * dir > STEP;
    if (len <= MAX_WICK_COLS && prev && next && beyond(prev) && beyond(next)) {
      spikes.push((run.start + run.end) / 2);
    } else {
      plateaus.push({ ...run });
    }
  });

  // Merge plateaus that only a spike separated, and swallow tiny leftovers.
  const merged: Run[] = [];
  for (const p of plateaus) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(p.value - last.value) <= STEP) {
      last.end = p.end;
    } else if (last && p.end - p.start + 1 < 3) {
      last.end = p.end;
    } else {
      merged.push(p);
    }
  }

  const steps: number[] = [];
  for (let k = 1; k < merged.length; k++) {
    const a = merged[k - 1] as Run;
    const b = merged[k] as Run;
    if (a.end - a.start + 1 >= 3 && b.end - b.start + 1 >= 3) steps.push(b.start);
  }
  return { spikes, steps };
}

function mergeNear(sorted: number[], gap: number): number[] {
  const out: number[] = [];
  for (const v of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && v - last <= gap) out[out.length - 1] = (last + v) / 2;
    else out.push(v);
  }
  return out;
}

/**
 * Where to cut between two wick positions p < q.
 * Hollow bodies leave two tall border lines between the wicks, so cut between them.
 * Solid bodies have no such lines; fall back to the midpoint.
 */
function boundaryBetween(count: number[], p: number, q: number): number {
  const lo = Math.ceil(p) + 2;
  const hi = Math.floor(q) - 2;
  let max = 0;
  for (let i = lo; i <= hi; i++) max = Math.max(max, count[i] as number);
  if (max > 0) {
    const tall: number[] = [];
    for (let i = lo; i <= hi; i++) if ((count[i] as number) >= 0.6 * max) tall.push(i);
    const first = tall[0] as number;
    const last = tall[tall.length - 1] as number;
    if (last - first <= 4) return Math.floor((first + last) / 2) + 1;
  }
  return Math.ceil((p + q) / 2);
}

/**
 * A label or a stray mark in the same columns as a candle, but far away from it vertically,
 * would be read as part of that candle. A candle's ink is one unbroken stretch from its top
 * to its bottom, so a small, separate stretch of ink in its columns is not the candle.
 * Returns copies of the maps with those stretches blanked (or the originals if none).
 */
export function blankStrays(
  de: Float32Array,
  dl: Float32Array,
  width: number,
  height: number,
  clusters: Cluster[],
  settings: DetectSettings,
): { de: Float32Array; dl: Float32Array } {
  const strong = strongThreshold(settings);
  let outDe: Float32Array | null = null;
  let outDl: Float32Array | null = null;
  for (const c of clusters) {
    const inkPerRow = new Int32Array(height);
    for (let y = 0; y < height; y++) {
      for (let x = c.left; x <= c.right; x++) {
        if ((de[y * width + x] as number) >= strong) inkPerRow[y] = (inkPerRow[y] as number) + 1;
      }
    }
    // stretches of rows with ink, separated by at least 10 blank rows
    const runs: Array<{ from: number; to: number; ink: number }> = [];
    let y = 0;
    while (y < height) {
      if ((inkPerRow[y] as number) === 0) {
        y++;
        continue;
      }
      let to = y;
      let ink = 0;
      let blank = 0;
      for (let k = y; k < height; k++) {
        if ((inkPerRow[k] as number) > 0) {
          to = k;
          ink += inkPerRow[k] as number;
          blank = 0;
        } else if (++blank >= 10) break;
      }
      runs.push({ from: y, to, ink });
      y = to + 1;
    }
    if (runs.length < 2) continue;
    const main = runs.reduce((a, b) => (b.ink > a.ink ? b : a));
    for (const r of runs) {
      if (r === main) continue;
      // only small stretches: another candle of the same size is not a stray
      if (r.ink > 0.3 * main.ink || r.to - r.from + 1 > 0.4 * (main.to - main.from + 1)) continue;
      outDe ??= new Float32Array(de);
      outDl ??= new Float32Array(dl);
      for (let yy = r.from; yy <= r.to; yy++) {
        for (let x = c.left; x <= c.right; x++) {
          outDe[yy * width + x] = 0;
          outDl[yy * width + x] = 0;
        }
      }
    }
  }
  return { de: outDe ?? de, dl: outDl ?? dl };
}
