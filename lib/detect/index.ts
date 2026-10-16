import { median, measureCluster, type Measured } from './measure';
import { findBackground } from './background';
import { classifyCandles, sampleInterior } from './classify';
import { confidenceScore } from './confidence';
import { colourMaps } from './coverage';
import { segmentColumns } from './segment';
import {
  DEFAULT_SETTINGS,
  type Candle,
  type DetectSettings,
  type DetectionResult,
  type PixelImage,
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
  const { de, dl } = colourMaps(image, background);
  const clusters = segmentColumns(de, width, height, settings);

  const measured: Measured[] = [];
  clusters.forEach((c, i) => {
    const prev = clusters[i - 1];
    const next = clusters[i + 1];
    const gapLeft = prev ? c.left - prev.right - 1 : c.left;
    const gapRight = next ? next.left - c.right - 1 : width - 1 - c.right;
    // Take a little margin for blurred edge pixels, but never cross into a neighbour.
    const x0 = Math.max(0, c.left - Math.min(2, Math.floor(gapLeft / 2)));
    const x1 = Math.min(width - 1, c.right + Math.min(2, Math.floor(gapRight / 2)));
    const m = measureCluster(de, dl, width, height, x0, x1, c.split, settings);
    if (m) measured.push(m);
  });

  if (measured.length === 0) {
    return {
      candles: [],
      background,
      medianBodyWidth: null,
      sourceBorderWidth: null,
      sourceWickWidth: null,
    };
  }

  const medianWidth = median(measured.map((m) => m.bodyRight - m.bodyLeft));
  const { types, unclear } = classifyCandles(
    measured.map((m) => sampleInterior(image, m, background)),
    background,
    settings,
  );

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
    };
  });

  const borders = measured.flatMap((m) => (m.borderWidth === null ? [] : [m.borderWidth]));
  const wicks = measured.flatMap((m) => (m.wickWidth === null ? [] : [m.wickWidth]));
  return {
    candles,
    background,
    medianBodyWidth: medianWidth,
    sourceBorderWidth: borders.length ? median(borders) : null,
    sourceWickWidth: wicks.length ? median(wicks) : null,
  };
}

/** Convenience wrapper with the signature from the SRS. */
export function detectCandles(
  image: PixelImage,
  settings: DetectSettings = DEFAULT_SETTINGS,
): Candle[] {
  return detect(image, settings).candles;
}
