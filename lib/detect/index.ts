import { deltaE, rgbToLab, type Rgb } from '@/lib/color/lab';
import { rgbToHex } from '@/lib/svg/hex';
import { median, measureCluster, type Measured } from './measure';
import { findBackground } from './background';
import { sampleInterior } from './classify';
import { decideUp, groupCandles } from './direction';
import { checkClean, stripLongLines } from './clean';
import { findExtras, withoutFootprint, withoutFootprintDe } from './extras';
import { confidenceScore } from './confidence';
import { colourMaps } from './coverage';
import { blankStrays, columnRuns, segmentColumns } from './segment';
import {
  DEFAULT_SETTINGS,
  type Candle,
  type CandleColors,
  type DetectSettings,
  type Direction,
  type DetectionResult,
  type PixelImage,
  type SourceStyle,
} from './types';

export { DEFAULT_SETTINGS, LOW_CONFIDENCE } from './types';
export type { Candle, DetectSettings, DetectionResult, Direction, PixelImage } from './types';

/**
 * Finds every candle in the image and measures it. Pure function: no DOM, no React.
 * All maths run on the original pixels (no resizing, no smoothing) and all results are
 * in source-image pixels.
 */
export function detect(
  image: PixelImage,
  settings: DetectSettings = DEFAULT_SETTINGS,
): DetectionResult {
  const { width, height } = image;
  const background = findBackground(image);
  const raw = colourMaps(image, background);
  const read = (deIn: Float32Array, dlIn: Float32Array): Measured[] => {
    let de = deIn;
    let dl = dlIn;
    // a label above or below a candle must not stretch it
    ({ de, dl } = blankStrays(
      de,
      dl,
      width,
      height,
      columnRuns(de, width, height, settings),
      settings,
    ));
    const clusters = segmentColumns(de, width, height, settings);
    const out: Measured[] = [];
    clusters.forEach((c, i) => {
      const prev = clusters[i - 1];
      const next = clusters[i + 1];
      const gapLeft = prev ? c.left - prev.right - 1 : c.left;
      const gapRight = next ? next.left - c.right - 1 : width - 1 - c.right;
      // Take a little margin for blurred edge pixels, but never cross into a neighbour.
      const x0 = Math.max(0, c.left - Math.min(2, Math.floor(gapLeft / 2)));
      const x1 = Math.min(width - 1, c.right + Math.min(2, Math.floor(gapRight / 2)));
      const m = measureCluster(de, dl, width, height, x0, x1, c.split, settings, image, background);
      if (m) out.push(m);
    });
    return out;
  };
  // A strong line across the chart joins all the candles into one: take it out first.
  const stripped = stripLongLines(raw.de, raw.dl, width, height);
  let { de, dl } = stripped;

  // Dotted and dashed lines would each be read as a candle: take them out before anything else.
  const lossy = settings.lossySource ?? false;
  const pre = findExtras(image, background, raw.de, [], { lossy, patternedOnly: true });
  const base =
    pre.extras.length > 0
      ? withoutFootprint(stripped.de, stripped.dl, pre.footprint, width, height)
      : stripped;
  let measured = read(base.de, base.dl);
  de = base.de;
  dl = base.dl;

  // Lines, boxes and labels next to the candles. They can hide or break candles, so once found
  // they are taken out of the picture and the candles are read again.
  const extent = (list: Measured[]) => {
    const widths = list.map((m) => m.bodyRight - m.bodyLeft);
    const heights = list.map((m) => (m.wickBottom ?? m.bodyBottom) - (m.wickTop ?? m.bodyTop));
    const typicalW = median(widths);
    const typicalH = median(heights);
    return list
      .filter((m, i) => {
        // a digit read as a candle: much narrower and much shorter than the real ones
        const tiny =
          (widths[i] as number) < 0.4 * typicalW && (heights[i] as number) < 0.5 * typicalH;
        if (tiny) return false;
        // a short run of letters read as a small flat candle: narrower than the real ones and
        // hardly any height at all
        if ((heights[i] as number) <= 14 && (widths[i] as number) < 0.7 * typicalW) return false;
        // several labels stacked in one column also look like one narrow candle: a real one is
        // unbroken from its top to its bottom
        if ((widths[i] as number) < 0.5 * typicalW) {
          const top = Math.floor(m.wickTop ?? m.bodyTop);
          const bottom = Math.ceil(m.wickBottom ?? m.bodyBottom);
          let inked = 0;
          for (let y = top; y < bottom; y++) {
            for (let dx = -1; dx <= 1; dx++) {
              const x = Math.floor(m.centerX) + dx;
              if (x >= 0 && x < width && (raw.de[y * width + x] as number) >= 4) {
                inked++;
                break;
              }
            }
          }
          if (inked < 0.85 * Math.max(1, bottom - top)) return false;
        }
        // a row of letters also looks like a flat bar: a real bar is inked from end to end
        if (m.bodyBottom - m.bodyTop <= 6) {
          const left = Math.ceil(m.bodyLeft) + 1;
          const right = Math.floor(m.bodyRight) - 1;
          let inked = 0;
          for (let x = left; x <= right; x++) {
            for (let y = Math.floor(m.bodyTop); y <= Math.ceil(m.bodyBottom); y++) {
              if (
                x >= 0 &&
                x < width &&
                y >= 0 &&
                y < height &&
                (raw.de[y * width + x] as number) >= 4
              ) {
                inked++;
                break;
              }
            }
          }
          if (right >= left && inked < 0.85 * (right - left + 1)) return false;
        }
        return true;
      })
      .map((m) => ({
        fill: sampleInterior(image, m, background).rgb,
        centerX: m.centerX,
        bodyLeft: m.bodyLeft,
        bodyRight: m.bodyRight,
        bodyTop: m.bodyTop,
        bodyBottom: m.bodyBottom,
        wickTop: m.wickTop,
        wickBottom: m.wickBottom,
      }));
  };
  let found = findExtras(image, background, raw.de, extent(measured), { lossy });
  // Reading the candles again changes what counts as "not a candle": go round until it settles.
  for (let round = 0; round < 3 && found.extras.length > 0; round++) {
    const cleaned = withoutFootprint(stripped.de, stripped.dl, found.footprint, width, height);
    const again = read(cleaned.de, cleaned.dl);
    if (again.length === 0) break;
    measured = again;
    const next = findExtras(image, background, raw.de, extent(measured), { lossy });
    const same = next.extras.length === found.extras.length && sameFootprint(next, found);
    found = next;
    de = cleaned.de;
    dl = cleaned.dl;
    if (same) break;
  }
  if (found.extras.length > 0) {
    ({ de, dl } = withoutFootprint(stripped.de, stripped.dl, found.footprint, width, height));
  }

  if (measured.length === 0) {
    return {
      candles: [],
      background,
      medianBodyWidth: null,
      sourceBorderWidth: null,
      sourceWickWidth: null,
      extras: [],
      cleanliness: { clean: true, issues: [] },
      sourceStyle: {
        bull: null,
        bear: null,
        borderWidth: 1,
        wickWidth: 1,
        background: rgbToHex(background),
      },
    };
  }

  const medianWidth = median(measured.map((m) => m.bodyRight - m.bodyLeft));
  const samples = measured.map((m) => sampleInterior(image, m, background));
  const grouping = groupCandles(samples, measured);
  const decision = decideUp(grouping, measured, settings, background);
  const types: Candle['type'][] = grouping.group.map((g) =>
    g === decision.upGroup ? 'bull' : 'bear',
  );
  const unclear = grouping.unclear;

  // The candles' own colours. A flat or tiny body has no interior, so its fill is its border.
  const own: Rgb3[] = measured.map((m, i) => {
    const s = samples[i] as (typeof samples)[number];
    return {
      body: s.borderOnly ? m.borderRgb : s.rgb,
      border: m.borderRgb,
      wick: m.wickRgb ?? m.borderRgb,
    };
  });
  // In a lossy image, a solid candle's border and wick are the fill's colour: measuring it from
  // the big filled area is more exact than from a 1 px line, which compression blurs.
  // A lossless PNG keeps even a subtle border (a few ΔE) exactly as drawn.
  const SAME_COLOUR = settings.lossySource ? 10 : 3;
  for (const c of own) {
    const near = (a: Rgb, b: Rgb) =>
      deltaE(rgbToLab(...roundRgb(a)), rgbToLab(...roundRgb(b))) <= SAME_COLOUR;
    if (near(c.border, c.body)) c.border = c.body;
    if (near(c.wick, c.border)) c.wick = c.border;
  }
  const typical = (type: Candle['type']): Rgb3 | null => {
    const group = own.filter((_, i) => types[i] === type);
    if (group.length === 0) return null;
    const med = (key: keyof Rgb3): Rgb =>
      [0, 1, 2].map((c) => median(group.map((g) => g[key][c] as number))) as Rgb;
    return { body: med('body'), border: med('border'), wick: med('wick') };
  };
  const typicalByType = { bull: typical('bull'), bear: typical('bear') };

  const candles: Candle[] = measured.map((m, i) => {
    const width = m.bodyRight - m.bodyLeft;
    const confidence = confidenceScore({
      widthDeviation: (width - medianWidth) / medianWidth,
      wickOffset: m.wickX === null ? null : Math.abs(m.wickX - m.centerX),
      split: m.split,
      unclearColour: unclear[i] as boolean,
    });
    // Step 11: uniform width. Same centre, median width.
    const half = settings.uniformBodyWidth ? medianWidth / 2 : width / 2;
    // Colours that clearly differ from the usual ones of this type belong to this candle alone.
    const usual = typicalByType[types[i] as Candle['type']];
    const mine = own[i] as Rgb3;
    const differs =
      usual !== null &&
      (['body', 'border', 'wick'] as const).some(
        (k) => deltaE(rgbToLab(...roundRgb(mine[k])), rgbToLab(...roundRgb(usual[k]))) > 8,
      );
    return {
      id: `candle-${String(i + 1).padStart(2, '0')}`,
      centerX: m.centerX,
      bodyLeft: m.centerX - half,
      bodyRight: m.centerX + half,
      bodyTop: m.bodyTop,
      bodyBottom: m.bodyBottom,
      wickTop: m.wickTop,
      wickBottom: m.wickBottom,
      type: types[i] as Candle['type'],
      group: grouping.group[i] as number,
      isDoji: m.isDoji,
      confidence,
      ...(differs ? { sourceColors: toHex(mine) } : {}),
    };
  });

  const borders = measured.flatMap((m) => (m.borderWidth === null ? [] : [m.borderWidth]));
  const wicks = measured.flatMap((m) => (m.wickWidth === null ? [] : [m.wickWidth]));
  const sourceBorderWidth = borders.length ? median(borders) : null;
  const sourceWickWidth = wicks.length ? median(wicks) : null;
  const sourceStyle: SourceStyle = {
    bull: typicalByType.bull ? toHex(typicalByType.bull) : null,
    bear: typicalByType.bear ? toHex(typicalByType.bear) : null,
    borderWidth: snapWidth(sourceBorderWidth ?? sourceWickWidth ?? 1),
    wickWidth: snapWidth(sourceWickWidth ?? sourceBorderWidth ?? 1),
    background: rgbToHex(background),
  };
  const groupColours = (k: number): CandleColors | null => {
    const members = own.filter((_, i) => grouping.group[i] === k);
    if (members.length === 0) return null;
    const med = (key: keyof Rgb3): Rgb =>
      [0, 1, 2].map((c) => median(members.map((x) => x[key][c] as number))) as Rgb;
    return toHex({ body: med('body'), border: med('border'), wick: med('wick') });
  };
  const direction: Direction = {
    groups: [0, 1].map((k) => ({ colours: groupColours(k), count: grouping.counts[k] as number })),
    upGroup: decision.upGroup,
    source: decision.source,
    sure: decision.sure,
  };
  return {
    candles,
    background,
    direction,
    medianBodyWidth: medianWidth,
    sourceBorderWidth,
    sourceWickWidth,
    sourceStyle,
    // Judged from where the candles are, never from their colours.
    extras: found.extras,
    cleanliness: checkClean(withoutFootprintDe(raw.de, found.footprint), width, height, measured, {
      lossy: settings.lossySource,
      // a long line that was found and turned into a line shape is not an extra left over
      knownLines: stripped.found && !found.extras.some((e) => e.kind === 'line'),
      // Before warning, look again with a more sensitive eye: marks that turn out to be faint
      // candles are not extras. Only candle-sized finds count.
      moreCandles: () =>
        faintCandles(de, dl, width, height, settings, image, background, medianWidth),
    }),
  };
}

function sameFootprint(a: { footprint: Uint8Array }, b: { footprint: Uint8Array }): boolean {
  if (a.footprint.length !== b.footprint.length) return false;
  for (let i = 0; i < a.footprint.length; i++) if (a.footprint[i] !== b.footprint[i]) return false;
  return true;
}

interface Rgb3 {
  body: Rgb;
  border: Rgb;
  wick: Rgb;
}

const roundRgb = (c: Rgb): Rgb => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])];

function toHex(c: Rgb3): CandleColors {
  return { body: rgbToHex(c.body), border: rgbToHex(c.border), wick: rgbToHex(c.wick) };
}

/** Measured widths are noisy by a few hundredths: 0.97 and 1.04 both mean 1 px. */
function snapWidth(w: number): number {
  const clamped = Math.min(8, Math.max(0.25, w));
  const whole = Math.round(clamped);
  return whole >= 1 && Math.abs(clamped - whole) < 0.12 ? whole : Math.round(clamped * 100) / 100;
}

/** Convenience wrapper with the signature from the SRS. */
export function detectCandles(
  image: PixelImage,
  settings: DetectSettings = DEFAULT_SETTINGS,
): Candle[] {
  return detect(image, settings).candles;
}

/** Candles that a more sensitive pass finds. Anything not candle-sized is ignored. */
function faintCandles(
  de: Float32Array,
  dl: Float32Array,
  width: number,
  height: number,
  settings: DetectSettings,
  image: PixelImage,
  background: Rgb,
  medianWidth: number,
): Measured[] {
  const sensitive = { ...settings, tLow: 2, tHigh: 14 };
  const found: Measured[] = [];
  for (const c of segmentColumns(de, width, height, sensitive)) {
    const m = measureCluster(
      de,
      dl,
      width,
      height,
      c.left,
      c.right,
      c.split,
      sensitive,
      image,
      background,
    );
    if (!m) continue;
    const w = m.bodyRight - m.bodyLeft;
    if (w >= 0.7 * medianWidth && w <= 1.4 * medianWidth) found.push(m);
  }
  return found;
}
