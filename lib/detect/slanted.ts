/**
 * Straight lines that are neither horizontal nor vertical, found without knowing where the
 * candles are. A slanted line that touches a wick would otherwise join two candles into one
 * blob. Candles only have horizontal and vertical edges, so any long straight slanted run of
 * marks is a drawn line.
 */

export interface SlantedLine {
  /** Pixel indices that belong to the line. */
  pixels: number[];
  /** Pixel-centre coordinates of its two ends. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const MIN_LENGTH = 40;
const STEP = Math.PI / 360; // 0.5 degrees
const AXIS_GUARD = (12 * Math.PI) / 180;

/**
 * @param ink ΔE from the background; pixels at or above `weak` are marks.
 */
export function findSlanted(
  ink: Float32Array,
  width: number,
  height: number,
  weak: number,
): SlantedLine[] {
  // Thin or edge pixels only: the inside of a filled body cannot be part of a thin line.
  const pts: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if ((ink[p] as number) < weak) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (
            nx >= 0 &&
            ny >= 0 &&
            nx < width &&
            ny < height &&
            (ink[ny * width + nx] as number) >= weak
          )
            n++;
        }
      }
      if (n <= 6) pts.push(p);
      if (pts.length > 160000) return [];
    }
  }
  if (pts.length < MIN_LENGTH) return [];

  const angles = Math.round(Math.PI / STEP); // 360
  const diag = Math.ceil(Math.hypot(width, height));
  const rows = 2 * diag + 1;
  const acc = new Uint16Array(angles * rows);
  const cos = new Float64Array(angles);
  const sin = new Float64Array(angles);
  const usable: number[] = [];
  for (let k = 0; k < angles; k++) {
    const th = k * STEP;
    cos[k] = Math.cos(th);
    sin[k] = Math.sin(th);
    // theta is the direction of the normal: 0 / 90 / 180 degrees are the axes
    const nearAxis =
      th < AXIS_GUARD || Math.abs(th - Math.PI / 2) < AXIS_GUARD || th > Math.PI - AXIS_GUARD;
    if (!nearAxis) usable.push(k);
  }
  for (const p of pts) {
    const x = (p % width) + 0.5;
    const y = Math.floor(p / width) + 0.5;
    for (const k of usable) {
      const rho = Math.round(x * (cos[k] as number) + y * (sin[k] as number)) + diag;
      acc[k * rows + rho] = (acc[k * rows + rho] as number) + 1;
    }
  }

  // Peaks, strongest first.
  const peaks: Array<{ k: number; rho: number; votes: number }> = [];
  for (const k of usable) {
    for (let r = 1; r < rows - 1; r++) {
      const v = acc[k * rows + r] as number;
      if (v >= MIN_LENGTH * 0.7) peaks.push({ k, rho: r - diag, votes: v });
    }
  }
  peaks.sort((a, b) => b.votes - a.votes);

  const claimed = new Uint8Array(width * height);
  const out: SlantedLine[] = [];
  for (const peak of peaks.slice(0, 400)) {
    if (out.length >= 12) break;
    const c = cos[peak.k] as number;
    const s = sin[peak.k] as number;
    // marks near this line, ordered along it
    const near: Array<{ p: number; t: number }> = [];
    for (const p of pts) {
      if (claimed[p]) continue;
      const x = (p % width) + 0.5;
      const y = Math.floor(p / width) + 0.5;
      if (Math.abs(x * c + y * s - peak.rho) <= 1.1) near.push({ p, t: -x * s + y * c });
    }
    if (near.length < MIN_LENGTH * 0.7) continue;
    near.sort((a, b) => a.t - b.t);
    // the longest unbroken run (gaps of up to 2.5 px are anti-aliasing)
    let best: [number, number] = [0, 0];
    let from = 0;
    for (let i = 1; i <= near.length; i++) {
      if (
        i === near.length ||
        (near[i] as { t: number }).t - (near[i - 1] as { t: number }).t > 2.5
      ) {
        if (i - from > best[1] - best[0]) best = [from, i];
        from = i;
      }
    }
    const run = near.slice(best[0], best[1]);
    if (run.length === 0) continue;
    const length = (run[run.length - 1] as { t: number }).t - (run[0] as { t: number }).t + 1;
    if (length < MIN_LENGTH || run.length < 0.7 * length) continue;

    // refine: a straight line through the run's marks
    let mx = 0;
    let my = 0;
    for (const { p } of run) {
      mx += (p % width) + 0.5;
      my += Math.floor(p / width) + 0.5;
    }
    mx /= run.length;
    my /= run.length;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const { p } of run) {
      const x = (p % width) + 0.5 - mx;
      const y = Math.floor(p / width) + 0.5 - my;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
    }
    const dir = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const dx = Math.cos(dir);
    const dy = Math.sin(dir);
    // still slanted after the refit?
    const fromAxis = Math.min(Math.abs(Math.sin(dir)), Math.abs(Math.cos(dir)));
    if (fromAxis < Math.sin(AXIS_GUARD)) continue;
    // how far the run reaches along the refitted line
    let t0 = Infinity;
    let t1 = -Infinity;
    for (const { p } of run) {
      const t = ((p % width) + 0.5 - mx) * dx + (Math.floor(p / width) + 0.5 - my) * dy;
      if (t < t0) t0 = t;
      if (t > t1) t1 = t;
    }
    const final: number[] = [];
    for (const p of pts) {
      if (claimed[p]) continue;
      const x = (p % width) + 0.5 - mx;
      const y = Math.floor(p / width) + 0.5 - my;
      const t = x * dx + y * dy;
      if (Math.abs(-x * dy + y * dx) <= 1.1 && t >= t0 - 1 && t <= t1 + 1) final.push(p);
    }
    if (final.length < MIN_LENGTH * 0.7) continue;
    for (const p of final) claimed[p] = 1;
    out.push({
      pixels: final,
      x1: mx + t0 * dx,
      y1: my + t0 * dy,
      x2: mx + t1 * dx,
      y2: my + t1 * dy,
    });
  }
  return out;
}
