import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type { CleanIssue } from '@/lib/detect/clean';
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
  type Rgb,
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
        const r = report(image, lossy);
        expect(r.issues, `${name} | ${v.name}`).toEqual([]);
        expect(r.clean).toBe(true);
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
        const r = report(image, lossy);
        n++;
        if (!r.clean) flagged.push(`seed ${seed} w${bodyWidth} p${pitch} ${v.name}: ${r.issues}`);
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

// ------------------------------------------------------------------ real extras are found
describe('a chart with extras is flagged, with the right reason', () => {
  const GRAY: Rgb = [120, 128, 140];

  const bases: Array<[string, SynthChart, Rgb, Rgb]> = [
    // name, chart, ink colour for solid marks, faint-grid colour
    [
      'TradingView colours',
      layout(mixed(6), { style: TV_DEFAULT, pitch: 40, height: 300 }),
      [41, 98, 255],
      [0, 0, 0],
    ],
    [
      'hollow bull + dark bear',
      layout(mixed(6), { style: HOLLOW_STYLE, pitch: 40, height: 300 }),
      [220, 30, 30],
      [0, 0, 0],
    ],
    [
      'dark theme',
      layout(mixed(6), { style: DARK_STYLE, pitch: 40, height: 300 }),
      [255, 255, 255],
      [160, 168, 190],
    ],
  ];

  const wide = (c: SynthChart): SynthChart => ({ ...c, width: c.width + 50 }); // room for a price scale

  for (const [name, base, ink, gridColor] of bases) {
    describe(name, () => {
      const make = () => copyImage(renderChart(wide(base)).image);
      const alphaFaint = name === 'dark theme' ? 0.18 : 0.06;

      it('a level line across the whole chart', () => {
        const img = make();
        overlayLine(img, { x0: 0, y0: 80, x1: img.width, y1: 80, color: ink });
        expect(report(img, false).issues).toContain('lines');
      });

      it('a level line from a candle to the right edge only', () => {
        const img = make();
        overlayLine(img, {
          x0: img.width * 0.5,
          y0: 90,
          x1: img.width,
          y1: 90,
          color: ink,
          width: 2,
        });
        expect(report(img, false).issues).toContain('lines');
      });

      it('a faint dotted grid (horizontal)', () => {
        const img = make();
        for (const y of [40, 100, 160, 220, 270]) {
          overlayLine(img, {
            x0: 0,
            y0: y,
            x1: img.width,
            y1: y,
            color: gridColor,
            alpha: alphaFaint,
            dash: [1, 3],
          });
        }
        expect(report(img, false).issues).toContain('lines');
      });

      it('a faint grid (vertical)', () => {
        const img = make();
        for (const x of [30, 90, 150, 210]) {
          overlayLine(img, {
            x0: x,
            y0: 0,
            x1: x,
            y1: img.height,
            color: gridColor,
            alpha: alphaFaint,
          });
        }
        expect(report(img, false).issues).toContain('lines');
      });

      it('a vertical line (session or time marker)', () => {
        const img = make();
        overlayLine(img, { x0: 150, y0: 0, x1: 150, y1: img.height, color: ink, dash: [6, 4] });
        expect(report(img, false).issues).toContain('lines');
      });

      it('the outline of a box', () => {
        const img = make();
        const [x0, y0, x1, y1] = [40, 70, 190, 230];
        overlayLine(img, { x0, y0, x1, y1: y0, color: ink });
        overlayLine(img, { x0, y0: y1, x1, y1, color: ink });
        overlayLine(img, { x0, y0, x1: x0, y1, color: ink });
        overlayLine(img, { x0: x1, y0, x1, y1, color: ink });
        expect(report(img, false).issues).toContain('lines');
      });

      it('a shaded box drawn over the candles (an SMT gap)', () => {
        const img = make();
        overlayBox(img, { x0: 50, y0: 80, x1: 190, y1: 240, color: ink, alpha: 0.18 });
        expect(report(img, false).issues).toContain('shapes');
      });

      it('price scale numbers on the right', () => {
        const img = make();
        ['4523.5', '4518.0', '4512.5', '4507.0', '4501.5'].forEach((t, i) =>
          overlayText(img, t, img.width - 46, 30 + i * 55, { color: GRAY, scale: 2 }),
        );
        expect(report(img, false).issues).toContain('text');
      });

      it('a faint watermark', () => {
        const img = make();
        overlayText(img, '4523', 60, 120, {
          color: name === 'dark theme' ? [255, 255, 255] : [0, 0, 0],
          alpha: alphaFaint,
          scale: 6,
        });
        expect(report(img, false).issues).toContain('text');
      });

      it('survives JPEG: a grid is still found', () => {
        const img = make();
        for (const y of [40, 100, 160, 220]) {
          overlayLine(img, { x0: 0, y0: y, x1: img.width, y1: y, color: ink, alpha: 0.5 });
        }
        expect(report(jpegRoundTrip(img, 70), true).issues).toContain('lines');
      });
    });
  }

  it('reports every kind of extra it finds, once each', () => {
    const base = layout(mixed(6), { style: TV_DEFAULT, pitch: 40, height: 300 });
    const img = copyImage(renderChart({ ...base, width: base.width + 50 }).image);
    overlayLine(img, { x0: 0, y0: 80, x1: img.width, y1: 80, color: [41, 98, 255] });
    overlayBox(img, { x0: 50, y0: 120, x1: 190, y1: 240, color: [41, 98, 255], alpha: 0.18 });
    ['4523.5', '4518.0', '4512.5'].forEach((t, i) =>
      overlayText(img, t, img.width - 46, 30 + i * 55, { color: [120, 128, 140] }),
    );
    const r = report(img, false);
    expect(r.clean).toBe(false);
    expect(r.issues).toEqual(expect.arrayContaining(['lines', 'text']));
    expect(new Set(r.issues).size).toBe(r.issues.length); // each kind once
  });
});

describe('the check is about position, not colour', () => {
  it('a line in the exact colour of the candles is still a line', () => {
    const chart = layout(mixed(6), { style: TV_DEFAULT, pitch: 40, height: 300 });
    const img = copyImage(renderChart(chart).image);
    overlayLine(img, { x0: 0, y0: 70, x1: img.width, y1: 70, color: [8, 153, 129] });
    expect(report(img, false).issues).toContain('lines');
  });

  it('the same candles in different colours get the same answer', () => {
    for (const style of [TV_DEFAULT, WEIRD_STYLE, DARK_STYLE, HOLLOW_STYLE, PALE_STYLE]) {
      const chart = layout(mixed(6), { style, pitch: 40, height: 300 });
      const clean = report(renderChart(chart).image, false);
      expect(clean.clean, JSON.stringify(style.bull)).toBe(true);
      const img = copyImage(renderChart(chart).image);
      const bg = style.background;
      const ink: Rgb = bg[0] > 128 ? [0, 0, 0] : [255, 255, 255];
      overlayLine(img, { x0: 0, y0: 70, x1: img.width, y1: 70, color: ink, alpha: 0.8 });
      expect(report(img, false).clean, JSON.stringify(style.bull)).toBe(false);
    }
  });
});

describe('the issue list never contains anything but the three kinds', () => {
  it('uses only lines, shapes and text', () => {
    const allowed: CleanIssue[] = ['lines', 'shapes', 'text'];
    const chart = layout(mixed(6), { style: TV_DEFAULT, pitch: 40, height: 300 });
    const img = copyImage(renderChart(chart).image);
    overlayBox(img, { x0: 20, y0: 20, x1: 200, y1: 260, color: [255, 0, 0], alpha: 0.2 });
    for (const issue of report(img, false).issues) expect(allowed).toContain(issue);
  });
});
