import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { checkClean } from '@/lib/detect/clean';
import { detect } from '@/lib/detect';
import { DEFAULT_SETTINGS, type PixelImage } from '@/lib/detect/types';
import {
  HOLLOW_STYLE,
  TV_DEFAULT,
  blur,
  copyImage,
  jpegRoundTrip,
  layout,
  overlayBox,
  overlayLine,
  overlayText,
  randomChart,
  renderChart,
  resizeBilinear,
  type SynthCandle,
  type SynthChart,
  type SynthStyle,
} from './synth/generate';

const DARK_STYLE: SynthStyle = {
  background: [19, 23, 34],
  bull: { fill: [38, 166, 154], border: [38, 166, 154], wick: [38, 166, 154] },
  bear: { fill: [239, 83, 80], border: [239, 83, 80], wick: [239, 83, 80] },
  borderWidth: 1,
  wickWidth: 1,
};

/** Colours that look nothing like TradingView's: nothing about colour may matter. */
const WEIRD_STYLE: SynthStyle = {
  background: [255, 255, 255],
  bull: { fill: [255, 214, 10], border: [122, 92, 0], wick: [122, 92, 0] },
  bear: { fill: [91, 42, 134], border: [46, 18, 69], wick: [46, 18, 69] },
  borderWidth: 2,
  wickWidth: 1,
};

/** Light gray candles on white: a washed-out grayscale chart. */
const PALE_STYLE: SynthStyle = {
  background: [255, 255, 255],
  bull: { fill: [226, 229, 233], border: [168, 174, 182], wick: [168, 174, 182] },
  bear: { fill: [186, 191, 199], border: [144, 150, 160], wick: [144, 150, 160] },
  borderWidth: 1,
  wickWidth: 1,
};

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

const mixed = (n: number): Array<Omit<SynthCandle, 'centerX'>> =>
  Array.from({ length: n }, (_, i) =>
    spec(i % 2 ? 'bear' : 'bull', 120 + (i % 3) * 14, 190 + (i % 2) * 20),
  );

type Variant = { name: string; make: (c: SynthChart) => { image: PixelImage; lossy: boolean } };
const VARIANTS: Variant[] = [
  { name: 'clean', make: (c) => ({ image: renderChart(c).image, lossy: false }) },
  { name: '1.25x', make: (c) => ({ image: renderChart(c, { scale: 1.25 }).image, lossy: false }) },
  { name: '1.5x', make: (c) => ({ image: renderChart(c, { scale: 1.5 }).image, lossy: false }) },
  { name: 'blur', make: (c) => ({ image: blur(renderChart(c).image), lossy: false }) },
  {
    name: 'jpeg q70',
    make: (c) => ({ image: jpegRoundTrip(renderChart(c).image, 70), lossy: true }),
  },
  {
    name: 'jpeg q50',
    make: (c) => ({ image: jpegRoundTrip(renderChart(c).image, 50), lossy: true }),
  },
  {
    name: 'offset',
    make: (c) => ({ image: renderChart(c, { offsetX: 1, offsetY: 1 }).image, lossy: false }),
  },
  {
    name: 'resampled',
    make: (c) => ({ image: resizeBilinear(renderChart(c).image, 1.25), lossy: false }),
  },
];

function report(image: PixelImage, lossy: boolean) {
  return detect(image, { ...DEFAULT_SETTINGS, lossySource: lossy }).cleanliness;
}

// ------------------------------------------------------------------ never a false warning
describe('a clean chart is never flagged (whatever its colours or quality)', () => {
  const charts: Array<[string, SynthChart]> = [
    ['hollow bull + dark bear', layout(mixed(6), { style: HOLLOW_STYLE, pitch: 40, height: 300 })],
    ['TradingView green and red', layout(mixed(7), { style: TV_DEFAULT, pitch: 40, height: 300 })],
    ['dark theme', layout(mixed(7), { style: DARK_STYLE, pitch: 40, height: 300 })],
    [
      'purple and yellow, thick borders',
      layout(mixed(6), { style: WEIRD_STYLE, pitch: 40, height: 300 }),
    ],
    ['pale gray candles', layout(mixed(6), { style: PALE_STYLE, pitch: 40, height: 300 })],
    ['40 candles', randomChart(40, 11, TV_DEFAULT)],
    ['40 hollow candles', randomChart(40, 12, HOLLOW_STYLE)],
    [
      'wide hollow candles (61 and 73 px)',
      layout(
        [
          spec('bull', 100, 220, { bodyWidth: 61, wickTop: 40, wickBottom: 270 }),
          spec('bear', 140, 240, { bodyWidth: 73, wickTop: 90, wickBottom: 300 }),
        ],
        { style: HOLLOW_STYLE, pitch: 100, height: 340 },
      ),
    ],
    ['a single candle', layout(mixed(1), { style: TV_DEFAULT, pitch: 40, height: 300 })],
    ['touching candles', layout(mixed(5), { style: HOLLOW_STYLE, pitch: 25, height: 300 })],
    ['1 px gaps', layout(mixed(5), { style: HOLLOW_STYLE, pitch: 26, height: 300 })],
    [
      'narrow and wide candles',
      layout(
        [
          spec('bull', 120, 190, { bodyWidth: 3 }),
          spec('bear', 110, 180, { bodyWidth: 61 }),
          spec('bull', 130, 200, { bodyWidth: 5 }),
        ],
        {
          style: TV_DEFAULT,
          pitch: 70,
          height: 300,
        },
      ),
    ],
    [
      'flat candles and long wicks',
      layout(
        [
          spec('bull', 200, 200),
          spec('bear', 150, 153, { wickTop: 20, wickBottom: 280 }),
          spec('bull', 180, 180, { wickTop: null, wickBottom: null }),
        ],
        { style: TV_DEFAULT, pitch: 40, height: 300 },
      ),
    ],
    [
      'candles cut by the image edge',
      layout(mixed(4), { style: TV_DEFAULT, pitch: 40, height: 300, startX: 4.5 }),
    ],
  ];

  for (const [name, chart] of charts) {
    for (const v of VARIANTS) {
      it(`${name} | ${v.name}`, () => {
        const { image, lossy } = v.make(chart);
        const r = detect(image, { ...DEFAULT_SETTINGS, lossySource: lossy });
        expect(r.cleanliness.issues, `${name} | ${v.name}`).toEqual([]);
        expect(r.cleanliness.clean).toBe(true);
        // and nothing is invented: a chart of only candles has no lines, boxes or labels
        expect(r.extras, `${name} | ${v.name}`).toEqual([]);
      });
    }
  }

  it('random clean charts: many seeds, widths, styles and qualities, none flagged', () => {
    const styles = [TV_DEFAULT, HOLLOW_STYLE, DARK_STYLE, WEIRD_STYLE, PALE_STYLE];
    const flagged: string[] = [];
    let n = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const style = styles[seed % styles.length] as SynthStyle;
      const bodyWidth = [6, 9, 14, 20, 31][seed % 5] as number;
      const pitch = bodyWidth + [0, 1, 2, 4, 9][seed % 5]!;
      const chart = randomChart(10 + (seed % 30), seed, style, bodyWidth, pitch);
      for (const v of VARIANTS) {
        const { image, lossy } = v.make(chart);
        const r = detect(image, { ...DEFAULT_SETTINGS, lossySource: lossy });
        n++;
        if (!r.cleanliness.clean || r.extras.length > 0) {
          flagged.push(
            `seed ${seed} w${bodyWidth} p${pitch} ${v.name}: ${r.cleanliness.issues} ${r.extras.map((e) => e.kind)}`,
          );
        }
      }
    }
    expect(flagged, `${flagged.length} of ${n} flagged`).toEqual([]);
  });

  it("Abbi's real screenshot", () => {
    const png = PNG.sync.read(
      fs.readFileSync(path.join(__dirname, 'fixtures', 'abbi-sample-5-candles.png')),
    );
    const r = report({ width: png.width, height: png.height, data: png.data }, false);
    expect(r).toEqual({ clean: true, issues: [] });
  });

  it('one candle in another colour is still a clean chart (colour never matters)', () => {
    const chart = layout(mixed(5), { style: TV_DEFAULT, pitch: 40, height: 300 });
    const { image } = renderChart(chart);
    const c = chart.candles[2]!;
    for (let y = 0; y < image.height; y++) {
      for (let x = Math.floor(c.centerX - 14); x < Math.ceil(c.centerX + 14); x++) {
        const i = (y * image.width + x) * 4;
        if (image.data[i] !== 255 || image.data[i + 1] !== 255 || image.data[i + 2] !== 255) {
          image.data[i] = 41;
          image.data[i + 1] = 98;
          image.data[i + 2] = 255;
        }
      }
    }
    expect(report(image, false).clean).toBe(true);
  });

  it('a chart with no candles says nothing (that has its own message)', () => {
    const { image } = renderChart({ width: 100, height: 100, candles: [], style: TV_DEFAULT });
    expect(report(image, false)).toEqual({ clean: true, issues: [] });
  });

  it('does not slow detection down noticeably (NFR-2)', () => {
    const chart = { ...randomChart(40, 7, HOLLOW_STYLE, 20, 48), width: 2000, height: 1200 };
    const { image } = renderChart(chart);
    detect(image);
    const t0 = performance.now();
    const r = detect(image);
    const ms = performance.now() - t0;
    console.log(`NFR-2 with the cleanliness check: 2000x1200, ${ms.toFixed(0)} ms`);
    expect(r.cleanliness.clean).toBe(true);
    expect(ms).toBeLessThan(500);
  });
});

// ------------------------------------------------------------------ what is left over
describe('anything that cannot become a shape is still reported, once', () => {
  it('marks no candle and no shape explains are reported, as one kind of issue each', () => {
    const w = 120;
    const h = 100;
    const de = new Float32Array(w * h);
    const candle = {
      centerX: 20,
      bodyLeft: 12,
      bodyRight: 28,
      bodyTop: 30,
      bodyBottom: 70,
      wickTop: 10,
      wickBottom: 90,
    };
    for (let y = 10; y < 90; y++) de[y * w + 20] = 60; // its wick
    expect(checkClean(de, w, h, [candle])).toEqual({ clean: true, issues: [] });
    for (let y = 20; y < 70; y++) for (let x = 60; x < 110; x++) de[y * w + x] = 15; // a shaded area
    const r = checkClean(de, w, h, [candle]);
    expect(r.clean).toBe(false);
    expect(r.issues).toContain('shapes');
  });

  it('lines, boxes and labels that became shapes no longer count as "not clean"', () => {
    const chart = layout(mixed(6), { style: TV_DEFAULT, pitch: 40, height: 300 });
    const img = copyImage(renderChart({ ...chart, width: chart.width + 50 }).image);
    overlayLine(img, { x0: 0, y0: 70, x1: img.width, y1: 70, color: [8, 153, 129] });
    overlayBox(img, { x0: 50, y0: 80, x1: 190, y1: 240, color: [41, 98, 255], alpha: 0.18 });
    overlayText(img, '4523.5', img.width - 46, 30, { color: [120, 128, 140], scale: 2 });
    const r = detect(img);
    expect(r.extras.map((e) => e.kind).sort()).toEqual(['box', 'line', 'text']);
    expect(r.cleanliness).toEqual({ clean: true, issues: [] });
  });
});
