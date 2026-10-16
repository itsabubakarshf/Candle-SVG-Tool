import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { deltaE, rgbToLab, type Rgb } from '@/lib/color/lab';
import { detect } from '@/lib/detect';
import { DEFAULT_SETTINGS } from '@/lib/detect/types';
import type { CandleColors, PixelImage } from '@/lib/detect/types';
import { normalizeHex } from '@/lib/svg/hex';
import {
  HOLLOW_STYLE,
  TV_DEFAULT,
  jpegRoundTrip,
  layout,
  renderChart,
  type SynthCandle,
  type SynthStyle,
} from './synth/generate';

const hexToRgb = (hex: string): Rgb => {
  const h = normalizeHex(hex)!.slice(1);
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as Rgb;
};
const rgb = (hex: string) => rgbToLab(...hexToRgb(hex));
/** Colour distance between two hex colours (ΔE). */
const dist = (a: string, b: string) => deltaE(rgb(a), rgb(b));

function expectColors(
  actual: CandleColors | null,
  want: { body: string; border: string; wick: string },
  tol: number,
) {
  expect(actual).not.toBeNull();
  for (const k of ['body', 'border', 'wick'] as const) {
    expect(
      dist(actual![k], want[k]),
      `${k}: got ${actual![k]}, want ${want[k]}`,
    ).toBeLessThanOrEqual(tol);
  }
}

const spec = (
  type: 'bull' | 'bear',
  top: number,
  bottom: number,
  extra: Partial<SynthCandle> = {},
): Omit<SynthCandle, 'centerX'> => ({
  type,
  bodyTop: top,
  bodyBottom: bottom,
  wickTop: top - 30,
  wickBottom: bottom + 30,
  bodyWidth: 25,
  ...extra,
});

const mix = (types: Array<'bull' | 'bear'>) =>
  types.map((t, i) => spec(t, 120 + (i % 3) * 14, 190 + (i % 2) * 20));

describe('Original colours: the candles keep the colours they were uploaded with', () => {
  it("TradingView's green and red come back unchanged", () => {
    const chart = layout(mix(['bull', 'bear', 'bull', 'bear', 'bull']), {
      style: TV_DEFAULT,
      pitch: 40,
      height: 300,
    });
    const { sourceStyle } = detect(renderChart(chart).image);
    expectColors(sourceStyle.bull, { body: '#089981', border: '#089981', wick: '#089981' }, 1);
    expectColors(sourceStyle.bear, { body: '#F23645', border: '#F23645', wick: '#F23645' }, 1);
  });

  it('any other colours work too, and a border that differs from its fill stays different', () => {
    const style: SynthStyle = {
      background: [255, 255, 255],
      bull: { fill: [255, 214, 10], border: [122, 92, 0], wick: [122, 92, 0] },
      bear: { fill: [91, 42, 134], border: [46, 18, 69], wick: [46, 18, 69] },
      borderWidth: 2,
      wickWidth: 1,
    };
    const chart = layout(mix(['bull', 'bear', 'bull', 'bear']), { style, pitch: 40, height: 300 });
    const r = detect(renderChart(chart).image);
    expectColors(r.sourceStyle.bull, { body: '#FFD60A', border: '#7A5C00', wick: '#7A5C00' }, 2);
    expectColors(r.sourceStyle.bear, { body: '#5B2A86', border: '#2E1245', wick: '#2E1245' }, 2);
    expect(r.sourceStyle.borderWidth).toBeCloseTo(2, 1);
    expect(r.sourceStyle.wickWidth).toBeCloseTo(1, 1);
    expect(r.candles.map((c) => c.type)).toEqual(['bull', 'bear', 'bull', 'bear']);
  });

  it('keeps a hollow candle hollow: fill stays the near-white it was', () => {
    const chart = layout(mix(['bull', 'bear', 'bull']), {
      style: HOLLOW_STYLE,
      pitch: 40,
      height: 300,
    });
    const { sourceStyle } = detect(renderChart(chart).image);
    expectColors(sourceStyle.bull, { body: '#FCFCFE', border: '#2B2F36', wick: '#2B2F36' }, 1);
    expectColors(sourceStyle.bear, { body: '#2B2F36', border: '#2B2F36', wick: '#2B2F36' }, 1);
  });

  it('records the measured line widths and the background colour', () => {
    const style: SynthStyle = {
      ...TV_DEFAULT,
      background: [19, 23, 34],
      borderWidth: 3,
      wickWidth: 2,
    };
    const chart = layout(mix(['bull', 'bear', 'bull']), { style, pitch: 40, height: 300 });
    const { sourceStyle } = detect(renderChart(chart).image);
    expect(sourceStyle.background).toBe('#131722');
    expect(sourceStyle.wickWidth).toBeCloseTo(2, 1);
  });

  it('stays true on a dark chart', () => {
    const style: SynthStyle = {
      background: [19, 23, 34],
      bull: { fill: [38, 166, 154], border: [38, 166, 154], wick: [38, 166, 154] },
      bear: { fill: [239, 83, 80], border: [239, 83, 80], wick: [239, 83, 80] },
      borderWidth: 1,
      wickWidth: 1,
    };
    const chart = layout(mix(['bull', 'bear', 'bull', 'bear']), { style, pitch: 40, height: 300 });
    const r = detect(renderChart(chart).image);
    expectColors(r.sourceStyle.bull, { body: '#26A69A', border: '#26A69A', wick: '#26A69A' }, 1);
    expectColors(r.sourceStyle.bear, { body: '#EF5350', border: '#EF5350', wick: '#EF5350' }, 1);
  });

  it('is not thrown off by anti-aliased lines (1.25x and 1.5x screenshots)', () => {
    const chart = layout(mix(['bull', 'bear', 'bull', 'bear', 'bull']), {
      style: TV_DEFAULT,
      pitch: 40,
      height: 300,
    });
    for (const scale of [1.25, 1.5]) {
      const { sourceStyle } = detect(renderChart(chart, { scale }).image);
      expectColors(sourceStyle.bull, { body: '#089981', border: '#089981', wick: '#089981' }, 3);
      expectColors(sourceStyle.bear, { body: '#F23645', border: '#F23645', wick: '#F23645' }, 3);
    }
  });

  it('survives JPEG compression, and compression noise is not mistaken for custom colours', () => {
    const chart = layout(mix(['bull', 'bear', 'bull', 'bear', 'bull', 'bear']), {
      style: TV_DEFAULT,
      pitch: 40,
      height: 300,
    });
    const r = detect(jpegRoundTrip(renderChart(chart).image, 70), {
      ...DEFAULT_SETTINGS,
      lossySource: true,
    });
    expectColors(r.sourceStyle.bull, { body: '#089981', border: '#089981', wick: '#089981' }, 6);
    expectColors(r.sourceStyle.bear, { body: '#F23645', border: '#F23645', wick: '#F23645' }, 6);
    expect(r.candles.some((c) => c.sourceColors)).toBe(false);
  });

  it('gives one candle in a different shade its own colours without touching the rest', () => {
    const chart = layout(mix(['bull', 'bull', 'bull', 'bull']), {
      style: TV_DEFAULT,
      pitch: 40,
      height: 300,
    });
    const { image } = renderChart(chart);
    // repaint candle 3 in another green in the pixels, as if the trader had highlighted it
    const c3 = chart.candles[2]!;
    const blue = [0, 200, 83];
    const idx = (x: number, y: number) => (y * image.width + x) * 4;
    for (let y = 0; y < image.height; y++) {
      for (let x = Math.floor(c3.centerX - 14); x < Math.ceil(c3.centerX + 14); x++) {
        const i = idx(x, y);
        if (image.data[i] !== 255 || image.data[i + 1] !== 255 || image.data[i + 2] !== 255) {
          image.data[i] = blue[0]!;
          image.data[i + 1] = blue[1]!;
          image.data[i + 2] = blue[2]!;
        }
      }
    }
    const r = detect(image);
    expect(r.candles.length).toBe(4);
    expect(r.candles[2]!.sourceColors).toBeDefined();
    expect(dist(r.candles[2]!.sourceColors!.body, '#00C853')).toBeLessThan(3);
    for (const i of [0, 1, 3]) expect(r.candles[i]!.sourceColors).toBeUndefined();
    expectColors(r.sourceStyle.bull, { body: '#089981', border: '#089981', wick: '#089981' }, 1);
  });

  it('keeps a flat candle in its own colour', () => {
    const chart = layout(
      [
        spec('bear', 200, 200),
        spec('bull', 160, 220),
        spec('bull', 150, 210),
        spec('bear', 140, 200),
      ],
      { style: TV_DEFAULT, pitch: 40, height: 300 },
    );
    const r = detect(renderChart(chart).image);
    expect(r.candles[0]!.isDoji).toBe(true);
    expect(r.candles[0]!.type).toBe('bear');
    expect(r.candles[0]!.sourceColors).toBeUndefined(); // same red as the other bears
    expectColors(r.sourceStyle.bear, { body: '#F23645', border: '#F23645', wick: '#F23645' }, 2);
  });

  it("reproduces Abbi's real screenshot: the colours really in its pixels", () => {
    const png = PNG.sync.read(
      fs.readFileSync(path.join(__dirname, 'fixtures', 'abbi-sample-5-candles.png')),
    );
    const image: PixelImage = { width: png.width, height: png.height, data: png.data };
    const px = (x: number, y: number): string => {
      const i = (y * png.width + x) * 4;
      return `#${[0, 1, 2].map((k) => (png.data[i + k] as number).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
    };
    const { sourceStyle } = detect(image);
    // candle 1 is a hollow bull: border at x=2, interior inside it, wick at x=24
    expectColors(sourceStyle.bull, { body: px(10, 375), border: px(2, 375), wick: px(24, 250) }, 1);
    // candle 3 is a solid bear: fill in the middle, border at its left edge, wick at x=138
    expectColors(
      sourceStyle.bear,
      { body: px(138, 320), border: px(116, 320), wick: px(138, 270) },
      1,
    );
  });

  it('finds nothing to report when there are no candles', () => {
    const { image } = renderChart({ width: 80, height: 80, candles: [], style: TV_DEFAULT });
    const r = detect(image);
    expect(r.sourceStyle.bull).toBeNull();
    expect(r.sourceStyle.bear).toBeNull();
  });

  it('leaves a type null when the image has none of it', () => {
    const chart = layout(mix(['bull', 'bull', 'bull']), {
      style: TV_DEFAULT,
      pitch: 40,
      height: 300,
    });
    const r = detect(renderChart(chart).image);
    expect(r.sourceStyle.bear).toBeNull();
    expect(r.sourceStyle.bull).not.toBeNull();
  });
});
