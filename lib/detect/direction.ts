import { deltaE, rgbToHueSat, rgbToLab, type Lab, type Rgb } from '@/lib/color/lab';
import type { InteriorSample } from './classify';
import type { Measured } from './measure';
import type { DetectSettings } from './types';

/**
 * Which candles are rising (bull) and which are falling (bear)?
 *
 * Two separate questions:
 *  1. Which candles look alike? (the colour groups: at most two)
 *  2. Which group is the rising one?
 *
 * The first is a plain colour question. The second cannot come from colours alone: a chart can
 * be blue and orange, red up and green down (common in Asia), or white and black. So it is
 * answered from the chart's own structure, and from colour conventions only as a second opinion.
 */

const SATURATED_CHROMA = 25;
const LIGHT_L = 55;
/** Two body colours closer than this are one group. */
const SAME_GROUP = 12;

export interface Grouping {
  /** Per candle, 0 or 1. Group 0 holds the left-most candle. */
  group: number[];
  /** Typical body colour per group. null when a group has no candles. */
  colours: Array<Rgb | null>;
  counts: [number, number];
  /** True where the candle's colour did not clearly say which group it belongs to. */
  unclear: boolean[];
}

const lab = (c: Rgb): Lab => rgbToLab(Math.round(c[0]), Math.round(c[1]), Math.round(c[2]));

function medianLab(points: Lab[]): Lab {
  const med = (d: number) => {
    const s = points.map((p) => p[d] as number).sort((a, b) => a - b);
    const n = s.length;
    return n % 2
      ? (s[(n - 1) / 2] as number)
      : ((s[n / 2 - 1] as number) + (s[n / 2] as number)) / 2;
  };
  return [med(0), med(1), med(2)];
}

/** Splits the candles into (at most) two colour groups. */
export function groupCandles(samples: InteriorSample[], measured: Measured[]): Grouping {
  const n = samples.length;
  const body = samples.map((s) => lab(s.rgb));
  const border = measured.map((m) => lab(m.borderRgb));
  // Candles whose inside could be read give the colours of the groups. A flat candle has no
  // inside, so it is placed afterwards by its line.
  let basis = samples.map((s, i) => (s.borderOnly ? -1 : i)).filter((i) => i >= 0);
  if (basis.length === 0) basis = samples.map((_, i) => i);

  // Start from the two most different colours, then settle with k-means.
  let a = basis[0] as number;
  let b = basis[0] as number;
  let far = -1;
  for (const i of basis)
    for (const j of basis) {
      const d = deltaE(body[i] as Lab, body[j] as Lab);
      if (d > far) {
        far = d;
        a = i;
        b = j;
      }
    }
  let c0: Lab = [...(body[a] as Lab)];
  let c1: Lab = [...(body[b] as Lab)];
  let side = basis.map(() => 0);
  if (far >= SAME_GROUP) {
    for (let iter = 0; iter < 12; iter++) {
      side = basis.map((i) => (deltaE(body[i] as Lab, c0) <= deltaE(body[i] as Lab, c1) ? 0 : 1));
      for (const k of [0, 1]) {
        const members = basis.filter((_, idx) => side[idx] === k).map((i) => body[i] as Lab);
        if (members.length === 0) continue;
        const m = medianLab(members);
        if (k === 0) c0 = m;
        else c1 = m;
      }
    }
  }
  const two =
    far >= SAME_GROUP && deltaE(c0, c1) >= SAME_GROUP && side.includes(0) && side.includes(1);

  const raw = new Array<number>(n).fill(0);
  const unclear = new Array<boolean>(n).fill(false);
  if (two) {
    const bc: Lab[] = [0, 1].map((k) =>
      medianLab(basis.filter((_, idx) => side[idx] === k).map((i) => border[i] as Lab)),
    ) as Lab[];
    const centres = [c0, c1];
    basis.forEach((i, idx) => {
      raw[i] = side[idx] as number;
    });
    samples.forEach((s, i) => {
      if (!s.borderOnly || basis.includes(i)) return;
      // A flat candle is only a line. Place it by its colour, and doubt it when that colour is
      // also the border colour of the other group (a small hollow candle looks just like it).
      const best =
        deltaE(body[i] as Lab, centres[0] as Lab) <= deltaE(body[i] as Lab, centres[1] as Lab)
          ? 0
          : 1;
      raw[i] = best;
      if (deltaE(body[i] as Lab, bc[1 - best] as Lab) < SAME_GROUP) unclear[i] = true;
    });
  } else {
    // One colour among the candles with an inside. A flat candle of a clearly different colour
    // is the only one of its kind, so it forms the second group on its own.
    const refBody = medianLab(basis.map((i) => body[i] as Lab));
    const refBorder = medianLab(basis.map((i) => border[i] as Lab));
    const span = deltaE(refBody, refBorder);
    samples.forEach((s, i) => {
      if (!s.borderOnly || basis.includes(i)) return;
      const dBody = deltaE(body[i] as Lab, refBody);
      const dBorder = deltaE(body[i] as Lab, refBorder);
      if (dBody < SAME_GROUP) return;
      if (span >= SAME_GROUP && dBody < dBorder) {
        // between a hollow body and its border: a small candle of this same kind
        unclear[i] = true;
        return;
      }
      raw[i] = 1;
      if (dBorder < SAME_GROUP) unclear[i] = true;
    });
  }

  // Group 0 is the group of the left-most candle: a stable order, not a meaning.
  const flip = raw[0] === 1;
  const group = raw.map((g) => (flip ? 1 - g : g));
  const colours: Array<Rgb | null> = [0, 1].map((k) => {
    const members = group
      .map((g, i) => (g === k && !samples[i]!.borderOnly ? i : -1))
      .filter((i) => i >= 0);
    const ids =
      members.length > 0 ? members : group.map((g, i) => (g === k ? i : -1)).filter((i) => i >= 0);
    if (ids.length === 0) return null;
    const m = [0, 1, 2].map((c) => {
      const s = ids
        .map((i) => (samples[i] as InteriorSample).rgb[c] as number)
        .sort((x, y) => x - y);
      return s[Math.floor(s.length / 2)] as number;
    });
    return m as Rgb;
  });
  // Two shades of green (or of red) are one kind of candle: a trader may have highlighted one.
  const verdicts = colours.map(conventional);
  if (colours[1] !== null && verdicts[0] !== null && verdicts[0] === verdicts[1]) {
    group.fill(0);
    colours[1] = null;
  }
  const counts: [number, number] = [
    group.filter((g) => g === 0).length,
    group.filter((g) => g === 1).length,
  ];
  return { group, colours, counts, unclear };
}

export type DirectionSource = 'structure' | 'colour' | 'prior' | 'remembered' | 'user';

export interface UpDecision {
  /** The group of rising candles. With one colour only, 1 means "none of them are rising". */
  upGroup: 0 | 1;
  source: DirectionSource;
  /** False when the chart gave no real answer: the person should be asked. */
  sure: boolean;
}

/** green = bull, red = bear, anything else says nothing. */
function conventional(rgb: Rgb | null): 'bull' | 'bear' | null {
  if (!rgb) return null;
  const l = lab(rgb);
  const chroma = Math.hypot(l[1], l[2]);
  const { hue, saturation } = rgbToHueSat(rgb[0], rgb[1], rgb[2]);
  if (chroma < SATURATED_CHROMA || saturation < 0.25) return null;
  if (hue >= 60 && hue <= 180) return 'bull';
  if (hue < 30 || hue > 330) return 'bear';
  return null;
}

/**
 * A candle opens where the one before it closed. For each way round, add up how far every
 * candle's open is from the previous close. The right way round lines up; the wrong one
 * zig-zags. Returns the total misfit for "group 0 is rising" and for "group 1 is rising".
 */
export function structureMisfit(
  group: number[],
  measured: Pick<Measured, 'bodyTop' | 'bodyBottom'>[],
): { misfit: [number, number]; pairs: number; scale: number } {
  const heights = measured.map((m) => m.bodyBottom - m.bodyTop).sort((a, b) => a - b);
  const typical = heights[Math.floor(heights.length / 2)] ?? 0;
  const cap = Math.max(12, typical * 2);
  const misfit: [number, number] = [0, 0];
  let pairs = 0;
  for (let i = 0; i + 1 < measured.length; i++) {
    const p = measured[i] as Pick<Measured, 'bodyTop' | 'bodyBottom'>;
    const q = measured[i + 1] as Pick<Measured, 'bodyTop' | 'bodyBottom'>;
    // A pair of flat candles says nothing about direction.
    if (p.bodyBottom - p.bodyTop < 2 && q.bodyBottom - q.bodyTop < 2) continue;
    pairs++;
    for (const up of [0, 1] as const) {
      const bullP = group[i] === up;
      const bullQ = group[i + 1] === up;
      const close = bullP ? p.bodyTop : p.bodyBottom; // y grows downwards
      const open = bullQ ? q.bodyBottom : q.bodyTop;
      misfit[up] += Math.min(cap, Math.abs(open - close));
    }
  }
  return { misfit, pairs, scale: cap };
}

/** Decides which group is rising, and whether that is certain enough not to ask. */
export function decideUp(
  g: Grouping,
  measured: Pick<Measured, 'bodyTop' | 'bodyBottom'>[],
  settings: Pick<DetectSettings, 'lightBodyIsBull' | 'tLow'>,
  background: Rgb,
): UpDecision {
  // What the chart's layout says.
  const s = structureMisfit(g.group, measured);
  const worst = Math.max(s.misfit[0], s.misfit[1]);
  const gain = worst > 0 ? Math.abs(s.misfit[0] - s.misfit[1]) / worst : 0;
  const structureUp: 0 | 1 = s.misfit[0] <= s.misfit[1] ? 0 : 1;

  // What the colours say by convention (green up, red down).
  const v = g.colours.map(conventional);
  let colourUp: 0 | 1 | null = null;
  if (v[0] === 'bull' && v[1] !== 'bull') colourUp = 0;
  else if (v[1] === 'bull' && v[0] !== 'bull') colourUp = 1;
  else if (v[0] === 'bear' && v[1] !== 'bear') colourUp = 1;
  else if (v[1] === 'bear' && v[0] !== 'bear') colourUp = 0;

  // The layout is the stronger witness, but a convention needs a firmer argument to overrule.
  const needed = colourUp === null ? 0.35 : 0.6;
  const best = Math.min(...s.misfit);
  const longEnough = s.pairs >= 3 || (s.pairs === 2 && best / 2 < 1.5 && gain >= 0.8);
  const enough = longEnough && gain >= needed && worst - best >= s.pairs;
  if (enough) return { upGroup: structureUp, source: 'structure', sure: true };
  if (colourUp !== null) return { upGroup: colourUp, source: 'colour', sure: true };

  // No colour convention and no clear layout: guess lighter = rising, but say it is a guess.
  const bg = lab(background);
  const light = (rgb: Rgb | null) => {
    if (!rgb) return null;
    const l = lab(rgb);
    return deltaE(l, bg) < settings.tLow || l[0] >= LIGHT_L;
  };
  let guess: 0 | 1;
  if (g.colours[1] === null)
    guess = (light(g.colours[0] ?? null) === settings.lightBodyIsBull ? 0 : 1) as 0 | 1;
  else {
    const l0 = lab(g.colours[0] as Rgb)[0];
    const l1 = lab(g.colours[1] as Rgb)[0];
    const lightGroup = l0 >= l1 ? 0 : 1;
    guess = (settings.lightBodyIsBull ? lightGroup : 1 - lightGroup) as 0 | 1;
  }
  return { upGroup: guess, source: 'prior', sure: false };
}
