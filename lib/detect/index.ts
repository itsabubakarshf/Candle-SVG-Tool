import { deltaE, rgbToLab, type Rgb } from '@/lib/color/lab';
import { rgbToHex } from '@/lib/svg/hex';
import { median, measureCluster, type Measured } from './measure';
import { findBackground } from './background';
import { classifyCandles, sampleInterior } from './classify';
import { checkClean, stripLongLines } from './clean';
import { confidenceScore } from './confidence';
import { colourMaps } from './coverage';
import { segmentColumns } from './segment';
import {
  DEFAULT_SETTINGS,
  type Candle,
  type CandleColors,
  type DetectSettings,
  type DetectionResult,
  type PixelImage,
  type SourceStyle,
} from './types';

export { DEFAULT_SETTINGS, LOW_CONFIDENCE } from './types';
export type { Candle, DetectSettings, DetectionResult, PixelImage } from './types';

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
  const read = (de: Float32Array, dl: Float32Array): Measured[] => {
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
  const { de, dl } = stripped;
  const measured = read(de, dl);

  if (measured.length === 0) {
    return {
      candles: [],
      background,
      medianBodyWidth: null,
      sourceBorderWidth: null,
      sourceWickWidth: null,
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
  const { types, unclear } = classifyCandles(samples, background, settings);

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
  return {
    candles,
    background,
    medianBodyWidth: medianWidth,
    sourceBorderWidth,
    sourceWickWidth,
    sourceStyle,
    // Judged from where the candles are, never from their colours.
    cleanliness: checkClean(raw.de, width, height, measured, {
      lossy: settings.lossySource,
      knownLines: stripped.found,
      // Before warning, look again with a more sensitive eye: marks that turn out to be faint
      // candles are not extras. Only candle-sized finds count.
      moreCandles: () =>
        faintCandles(de, dl, width, height, settings, image, background, medianWidth),
    }),
  };
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
