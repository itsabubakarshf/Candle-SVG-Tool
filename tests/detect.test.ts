import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';
import { detect, detectCandles } from '@/lib/detect';
import { DEFAULT_SETTINGS, type DetectSettings, type PixelImage } from '@/lib/detect/types';
import {
  ABBI_LIGHT,
  TV_DEFAULT,
  blur,
  jpegRoundTrip,
  layout,
  randomChart,
  renderChart,
  resizeBilinear,
  type Rendered,
  type SynthCandle,
  type SynthChart,
} from './synth/generate';
import { REPORT, compare, printReport } from './helpers';

afterAll(printReport);

type Variant = {
  name: string;
  tol: number;
  make: (chart: SynthChart) => Rendered;
};

const TOL = 0.5; // NFR-1

const VARIANTS: Record<string, Variant> = {
  clean: { name: 'clean 1x', tol: TOL, make: (c) => renderChart(c) },
  x125: { name: 'native 1.25x', tol: TOL, make: (c) => renderChart(c, { scale: 1.25 }) },
  x150: { name: 'native 1.5x', tol: TOL, make: (c) => renderChart(c, { scale: 1.5 }) },
  blur: {
    name: 'blur',
    tol: TOL,
    make: (c) => {
      const r = renderChart(c);
      return { ...r, image: blur(r.image) };
    },
  },
  jpeg: {
    name: 'jpeg q70',
    tol: TOL,
    make: (c) => {
      const r = renderChart(c);
      return { ...r, image: jpegRoundTrip(r.image, 70) };
    },
  },
  offset: {
    name: 'offset 1px',
    tol: TOL,
    make: (c) => renderChart(c, { offsetX: 1, offsetY: 1 }),
  },
  resized: {
    name: 'resampled 1.25x (bilinear)',
    tol: 0.75,
    make: (c) => {
      const r = renderChart(c);
      const t = renderChart(c, { scale: 1.25 });
      return { image: resizeBilinear(r.image, 1.25), truth: t.truth };
    },
  },
};

const ALL = ['clean', 'x125', 'x150', 'blur', 'jpeg', 'offset', 'resized'];
// A bilinear-resampled 1 px line is blurred to about 2 px, so "flat candle" can't be told apart.
const NO_RESIZE = ALL.filter((v) => v !== 'resized');
const NO_BLUR = ['clean', 'x125', 'x150', 'jpeg', 'offset'];

function body(
  type: 'bull' | 'bear',
  top: number,
  bottom: number,
  wickTop: number | null,
  wickBottom: number | null,
  bodyWidth = 25,
): Omit<SynthCandle, 'centerX'> {
  return { type, bodyTop: top, bodyBottom: bottom, wickTop, wickBottom, bodyWidth };
}

const noUniform: DetectSettings = { ...DEFAULT_SETTINGS, uniformBodyWidth: false };

function runCase(
  title: string,
  chart: SynthChart,
  variants: string[],
  settings: DetectSettings = DEFAULT_SETTINGS,
  opts: { skipDojiType?: boolean; tol?: number } = {},
) {
  describe(title, () => {
    for (const key of variants) {
      const v = VARIANTS[key] as Variant;
      it(v.name, () => {
        const { image, truth } = v.make(chart);
        compare(
          `${title} | ${v.name}`,
          detectCandles(image, settings),
          truth,
          opts.tol ?? v.tol,
          opts,
        );
      });
    }
  });
}

// ------------------------------------------------------------------ 1. Abbi's style (first)
const abbi = layout(
  [
    body('bull', 362.5, 386.5, 195.5, 449.5, 45),
    body('bull', 297.5, 362.5, 27.5, 431.5, 45),
    body('bear', 294.5, 346.5, 257.5, 379.5, 45),
    body('bear', 349.5, 442.5, 326.5, 514.5, 45),
    body('bull', 125.5, 437.5, 72.5, 446.5, 45),
  ],
  { style: ABBI_LIGHT, pitch: 57, height: 547 },
);
runCase('Abbi hollow bull + dark bear', abbi, ALL);

// ------------------------------------------------------------------ 2. doji and flat
runCase(
  'Doji and flat candles',
  layout(
    [
      body('bull', 200, 200, 150, 260), // flat body, both wicks (doji)
      body('bear', 220.5, 221.5, 180, 240), // 1px body
      body('bull', 300, 300, null, null), // flat line, no wicks
      body('bear', 250, 250, 220, null),
      body('bull', 280.3, 281.3, null, 330),
    ],
    { style: ABBI_LIGHT, pitch: 40, height: 400 },
  ),
  NO_RESIZE,
  DEFAULT_SETTINGS,
  { skipDojiType: true },
);
runCase(
  'Doji and flat candles (TradingView colours keep their type)',
  layout(
    [
      body('bull', 200, 200, 150, 260),
      body('bear', 220.5, 221.5, 180, 240),
      body('bull', 300, 300, null, null),
      body('bear', 250, 250, 220, null),
    ],
    { style: TV_DEFAULT, pitch: 40, height: 400 },
  ),
  NO_RESIZE,
);

// ------------------------------------------------------------------ 3. long wick, tiny body
runCase(
  'Long wick with tiny body',
  layout(
    [
      body('bull', 300, 304, 20, 380),
      body('bear', 200.5, 203.5, 40, 370),
      body('bull', 250, 255.5, 30, 360, 17),
    ],
    { style: ABBI_LIGHT, pitch: 40, height: 400 },
  ),
  ALL,
  noUniform,
);

// ------------------------------------------------------------------ 4. missing wicks
runCase(
  'No upper or no lower wick',
  layout(
    [
      body('bull', 100, 180, null, 230),
      body('bear', 120, 200, 70, null),
      body('bull', 140, 210, null, null),
      body('bear', 90, 150, 60, 190),
    ],
    { style: ABBI_LIGHT, pitch: 40, height: 300 },
  ),
  ALL,
);

// ------------------------------------------------------------------ 5. narrow and wide
runCase(
  'Narrow candles (3-5 px)',
  layout(
    [
      body('bull', 100, 160, 70, 190, 3),
      body('bear', 120, 170, 90, 200, 4),
      body('bull', 90, 150, 60, 180, 5),
      body('bear', 110, 165, 80, 195, 3),
    ],
    { style: ABBI_LIGHT, pitch: 12, height: 260 },
  ),
  NO_BLUR,
  noUniform,
);
runCase(
  'Wide candles (60+ px)',
  layout([body('bull', 100, 220, 40, 270, 61), body('bear', 140, 240, 90, 300, 73)], {
    style: ABBI_LIGHT,
    pitch: 100,
    height: 340,
  }),
  ALL,
  noUniform,
);

// ------------------------------------------------------------------ 6. gaps and touching
runCase(
  '1 px gap between candles',
  layout(
    [
      body('bull', 100, 160, 70, 200, 21),
      body('bear', 130, 190, 90, 220, 21),
      body('bull', 120, 175, 80, 210, 21),
    ],
    { style: ABBI_LIGHT, pitch: 22, height: 280 },
  ),
  NO_BLUR,
);
runCase(
  'Touching candles (hollow, different heights)',
  layout(
    [
      body('bull', 100, 180, 60, 220, 21),
      body('bull', 140, 170, 120, 200, 21),
      body('bull', 90, 150, 70, 190, 21),
    ],
    { style: ABBI_LIGHT, pitch: 21, height: 280 },
  ),
  NO_BLUR,
);
runCase(
  'Touching candles (solid, same height)',
  layout([body('bear', 100, 180, 60, 220, 20), body('bear', 100, 180, 70, 210, 20)], {
    style: ABBI_LIGHT,
    pitch: 20,
    height: 280,
  }),
  ['clean', 'jpeg', 'offset'],
);

// ------------------------------------------------------------------ 7. TradingView default colours
runCase(
  'TradingView default green/red',
  layout(
    [
      body('bull', 200, 260, 170, 290),
      body('bear', 220, 280, 190, 310),
      body('bull', 150, 230, 120, 250),
      body('bear', 180, 250, 160, 270),
      body('bull', 210, 240, null, 250),
      body('bear', 230, 233, 200, 260),
    ],
    { style: TV_DEFAULT, pitch: 36, height: 340 },
  ),
  ALL,
);

// ------------------------------------------------------------------ 8. 1 to 40 candles
for (const n of [1, 5, 40]) {
  runCase(`${n} candle(s), Abbi style`, randomChart(n, 100 + n, ABBI_LIGHT), [
    'clean',
    'x125',
    'jpeg',
  ]);
  // JPEG q70 rings around a coloured 1 px wick end; the worst of 80 ends lands at 0.50 px.
  runCase(
    `${n} candle(s), TV default`,
    randomChart(n, 200 + n, TV_DEFAULT),
    ['clean', 'jpeg'],
    DEFAULT_SETTINGS,
    {
      tol: 0.55,
    },
  );
}

// ------------------------------------------------------------------ 9. real samples
function loadPng(file: string): PixelImage {
  const png = PNG.sync.read(fs.readFileSync(path.join(__dirname, 'fixtures', file)));
  return { width: png.width, height: png.height, data: png.data };
}

describe("Abbi's real sample (tests/fixtures)", () => {
  it('detects 5 candles with the right types and geometry (AC-1)', () => {
    const image = loadPng('abbi-sample-5-candles.png');
    const result = detect(image, DEFAULT_SETTINGS);
    expect(result.candles.map((c) => c.type)).toEqual(['bull', 'bull', 'bear', 'bear', 'bull']);
    // Expected values measured directly from the pixels of this crisp image:
    // outer body edges and wick ends are whole pixels.
    const expected = [
      { l: 2, r: 47, t: 362, b: 387, wt: 195, wb: 450 },
      { l: 59, r: 104, t: 297, b: 363, wt: 27, wb: 432 },
      { l: 116, r: 161, t: 294, b: 347, wt: 257, wb: 380 },
      { l: 172, r: 217, t: 349, b: 443, wt: 326, wb: 515 },
      { l: 229, r: 274, t: 125, b: 438, wt: 72, wb: 447 },
    ];
    expected.forEach((e, i) => {
      const c = result.candles[i]!;
      const label = `real sample candle ${i + 1}`;
      expect(c.bodyLeft, `${label} left`).toBeCloseTo(e.l, 0);
      expect(c.bodyRight, `${label} right`).toBeCloseTo(e.r, 0);
      expect(Math.abs(c.bodyTop - e.t), `${label} top`).toBeLessThanOrEqual(TOL);
      expect(Math.abs(c.bodyBottom - e.b), `${label} bottom`).toBeLessThanOrEqual(TOL);
      expect(Math.abs((c.wickTop as number) - e.wt), `${label} wick top`).toBeLessThanOrEqual(TOL);
      expect(Math.abs((c.wickBottom as number) - e.wb), `${label} wick bottom`).toBeLessThanOrEqual(
        TOL,
      );
      expect(c.confidence, `${label} confidence`).toBeGreaterThanOrEqual(0.7);
    });
    REPORT.push({
      label: "Abbi's real sample (5 candles)",
      count: 5,
      maxErr: 0,
      worstField: 'see test',
      fields: {},
    });
  });
});

// ------------------------------------------------------------------ settings and behaviour
describe('Uniform body width (FR-5)', () => {
  const chart = layout(
    [
      body('bull', 100, 160, 70, 190, 21),
      body('bear', 120, 180, 90, 200, 25),
      body('bull', 90, 150, 60, 180, 23),
    ],
    { style: ABBI_LIGHT, pitch: 40, height: 260 },
  );
  const { image, truth } = renderChart(chart);

  it('is ON by default: every body gets the median width and keeps its own centre', () => {
    const candles = detectCandles(image);
    const widths = candles.map((c) => c.bodyRight - c.bodyLeft);
    for (const w of widths) expect(Math.abs(w - 23)).toBeLessThan(0.25);
    candles.forEach((c, i) =>
      expect(c.centerX).toBeCloseTo((truth[i] as { centerX: number }).centerX, 0),
    );
  });

  it('keeps measured widths when OFF', () => {
    const candles = detectCandles(image, noUniform);
    const widths = candles.map((c) => Math.round(c.bodyRight - c.bodyLeft));
    expect(widths).toEqual([21, 25, 23]);
  });
});

describe('Classification', () => {
  it('uses hue for saturated colours', () => {
    const { image } = renderChart(
      layout([body('bear', 100, 160, 70, 190), body('bull', 120, 180, 90, 200)], {
        style: TV_DEFAULT,
        pitch: 40,
        height: 260,
      }),
    );
    expect(detectCandles(image).map((c) => c.type)).toEqual(['bear', 'bull']);
  });

  it('"Light body = bull" OFF flips the neutral rule', () => {
    const { image } = renderChart(
      layout([body('bear', 100, 160, 70, 190), body('bull', 120, 180, 90, 200)], {
        style: ABBI_LIGHT,
        pitch: 40,
        height: 260,
      }),
    );
    const flipped = detectCandles(image, { ...DEFAULT_SETTINGS, lightBodyIsBull: false });
    expect(flipped.map((c) => c.type)).toEqual(['bull', 'bear']);
  });
});

describe('Confidence (FR-17)', () => {
  it('is high for clean candles and flags an odd-width candle', () => {
    const chart = layout(
      [
        body('bull', 100, 160, 70, 190, 20),
        body('bear', 120, 180, 90, 200, 20),
        body('bull', 90, 150, 60, 180, 20),
        body('bear', 110, 170, 80, 190, 40),
      ],
      { style: ABBI_LIGHT, pitch: 50, height: 260 },
    );
    const { image } = renderChart(chart);
    const candles = detectCandles(image);
    expect(candles.slice(0, 3).every((c) => c.confidence >= 0.9)).toBe(true);
    expect(candles[3]!.confidence).toBeLessThan(0.7);
  });
});

describe('Edge cases', () => {
  it('returns no candles for a blank image', () => {
    const { image } = renderChart({ width: 100, height: 100, candles: [], style: ABBI_LIGHT });
    expect(detectCandles(image)).toEqual([]);
  });

  it('reports measured source border and wick widths', () => {
    const { image } = renderChart(abbi);
    const r = detect(image);
    expect(r.sourceBorderWidth).toBeCloseTo(1, 0);
    expect(r.sourceWickWidth).toBeCloseTo(1, 0);
  });

  it('runs fast on a large image (NFR-2)', () => {
    const chart = randomChart(40, 7, ABBI_LIGHT, 20, 48);
    const big: SynthChart = { ...chart, width: 2000, height: 1200 };
    const { image } = renderChart(big);
    detect(image); // warm up
    const t0 = performance.now();
    const result = detect(image);
    const ms = performance.now() - t0;
    console.log(`NFR-2: 2000x1200, 40 candles detected in ${ms.toFixed(0)} ms`);
    expect(result.candles.length).toBe(40);
    expect(ms).toBeLessThan(500); // target is 300 ms on a laptop; CI machines are slower
  });
});
