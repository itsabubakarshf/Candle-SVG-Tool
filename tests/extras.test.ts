import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { detect } from '@/lib/detect';
import {
  DEFAULT_SETTINGS,
  type BoxExtra,
  type LineExtra,
  type PixelImage,
  type TextExtra,
} from '@/lib/detect/types';
import {
  TV_DEFAULT,
  copyImage,
  jpegRoundTrip,
  layout,
  overlayBox,
  overlayLine,
  overlayText,
  renderChart,
  type Rgb,
  type SynthCandle,
  type SynthStyle,
} from './synth/generate';

const load = (name: string): PixelImage => {
  const p = PNG.sync.read(fs.readFileSync(path.join(__dirname, 'fixtures', name)));
  return { width: p.width, height: p.height, data: p.data };
};

const lines = (e: { extras: Array<{ kind: string }> }) =>
  e.extras.filter((x) => x.kind === 'line') as LineExtra[];
const boxes = (e: { extras: Array<{ kind: string }> }) =>
  e.extras.filter((x) => x.kind === 'box') as BoxExtra[];
const texts = (e: { extras: Array<{ kind: string }> }) =>
  e.extras.filter((x) => x.kind === 'text') as TextExtra[];

const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

// ------------------------------------------------------------------ real screenshots
describe('real screenshots with a box, a line and a label', () => {
  it('first screenshot: 5 candles, the grey box and the thin slanted line', () => {
    const r = detect(load('extras-a.png'));
    expect(r.candles).toHaveLength(5);
    expect(boxes(r)).toHaveLength(1);
    const box = boxes(r)[0] as BoxExtra;
    expect([box.x, box.y, box.width, box.height]).toEqual([22, 224, 112, 85]);
    expect(box.fill).toBe('#F0F0F0');
    expect(lines(r)).toHaveLength(1);
    const l = lines(r)[0] as LineExtra;
    expect(near(l.x1, 21, 1.5) && near(l.y1, 498.6, 1.5)).toBe(true);
    expect(near(l.x2, 249, 1.5) && near(l.y2, 516.2, 1.5)).toBe(true);
    expect(l.dash).toBeNull();
    expect(texts(r)).toHaveLength(0);
    expect(r.cleanliness.clean).toBe(true);
  });

  it('second screenshot: also the dotted line and the 18:00 label', () => {
    const r = detect(load('extras-b.png'));
    expect(r.candles).toHaveLength(5);
    expect(boxes(r)).toHaveLength(1);
    const dotted = lines(r).filter((l) => l.dash !== null);
    expect(dotted).toHaveLength(1);
    const d = dotted[0] as LineExtra;
    expect(near(d.y1, 443.5, 0.6) && near(d.y2, 443.5, 0.6)).toBe(true);
    expect(near(d.x1, 59, 2) && near(d.x2, 205, 2)).toBe(true);
    const [on, off] = d.dash as [number, number];
    expect(on + off).toBeCloseTo(4, 0);
    // the slanted line and the small tick at the left edge
    expect(lines(r).filter((l) => l.dash === null).length).toBe(2);
    expect(texts(r)).toHaveLength(1);
    const t = texts(r)[0] as TextExtra;
    expect(t.region.x).toBeGreaterThanOrEqual(176);
    expect(t.region.x + t.region.width).toBeLessThanOrEqual(206);
    expect(near(t.region.y, 448, 2)).toBe(true);
    expect(r.cleanliness.clean).toBe(true);
  });

  it('the candles are the same as without the extras (the wick under the bar is kept)', () => {
    const r = detect(load('extras-b.png'));
    const bar = r.candles[3]!;
    expect(bar.wickBottom).toBeGreaterThan(180);
    expect(bar.wickTop).toBeLessThan(70);
  });
});

describe('the screenshot with the crosshair (as originally uploaded)', () => {
  const r = detect(load('extras-d.png'));

  it('keeps one look for all candles: the same dark lines on bull and bear', () => {
    expect(r.sourceStyle.bull?.border).toBe('#393939');
    expect(r.sourceStyle.bull?.wick).toBe('#393939');
    expect(r.sourceStyle.bear?.border).toBe('#393939');
    expect(r.sourceStyle.bear?.wick).toBe('#393939');
    expect(r.sourceStyle.borderWidth).toBe(1);
    expect(r.sourceStyle.wickWidth).toBe(1);
    // no candle has colours of its own: nothing is changed per candle
    expect(r.candles.filter((c) => c.sourceColors)).toHaveLength(0);
  });
});

describe('third screenshot: a slanted line that touches a wick, a label beside a candle', () => {
  const r = detect(load('extras-c.png'));

  it('reads the 4 candles at their real width (nothing else is mistaken for a candle)', () => {
    expect(r.candles).toHaveLength(4);
    for (const c of r.candles) expect(near(c.bodyRight - c.bodyLeft, 25, 1.5)).toBe(true);
    expect(r.candles.map((c) => Math.round(c.bodyLeft))).toEqual([10, 43, 77, 110]);
    expect(r.candles[3]?.type).toBe('bear');
    expect(r.cleanliness).toEqual({ clean: true, issues: [] });
  });

  it('finds the box, the slanted line, the left tick and the dotted line', () => {
    const b = boxes(r)[0] as BoxExtra;
    expect([b.x, b.y, b.width, b.height]).toEqual([23, 242, 133, 103]);
    const slanted = lines(r).filter(
      (l) => Math.abs(l.x1 - l.x2) > 0.01 && Math.abs(l.y1 - l.y2) > 0.01,
    );
    expect(slanted).toHaveLength(1);
    const s = slanted[0] as LineExtra;
    expect(near(Math.max(s.x1, s.x2), 123.5, 1.5) && near(Math.min(s.x1, s.x2), 88, 1.5)).toBe(
      true,
    );
    expect(near(Math.min(s.y1, s.y2), 181.3, 2) && near(Math.max(s.y1, s.y2), 242.3, 2)).toBe(true);
    const dotted = lines(r).filter((l) => l.dash !== null);
    expect(dotted).toHaveLength(1);
    expect((dotted[0] as LineExtra).width).toBe(1);
    expect(lines(r).filter((l) => Math.abs(l.x1 - l.x2) < 0.01)).toHaveLength(1); // the tick on the left edge
  });

  it('keeps the label as it looks: colour, size and weight (the original is semi-bold)', () => {
    const label = texts(r)[0] as TextExtra;
    expect(label.color).toBe('#191919');
    expect(label.size).toBe(10);
    expect(label.weight).toBe(600);
    // the thin grey label of the second screenshot stays regular
    expect((texts(detect(load('extras-b.png')))[0] as TextExtra).weight).toBe(400);
  });

  it('finds the label even though its letters touch, and keeps how it looks', () => {
    const t = texts(r);
    expect(t).toHaveLength(1);
    const label = t[0] as TextExtra;
    expect([label.region.x, label.region.y]).toEqual([126, 437]);
    expect(label.from).toEqual(label.region);
    expect(label.trace).toMatch(/^M\d+ \d+h/);
  });
});

// ------------------------------------------------------------------ synthetic charts
const spec = (
  type: 'bull' | 'bear',
  top: number,
  bottom: number,
): Omit<SynthCandle, 'centerX'> => ({
  type,
  bodyTop: top,
  bodyBottom: bottom,
  wickTop: top - 30,
  wickBottom: bottom + 30,
  bodyWidth: 25,
});
const mixed = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    spec(i % 2 ? 'bear' : 'bull', 120 + (i % 3) * 14, 190 + (i % 2) * 20),
  );

const DARK: SynthStyle = {
  background: [19, 23, 34],
  bull: { fill: [38, 166, 154], border: [38, 166, 154], wick: [38, 166, 154] },
  bear: { fill: [239, 83, 80], border: [239, 83, 80], wick: [239, 83, 80] },
  borderWidth: 1,
  wickWidth: 1,
};

const bases: Array<[string, SynthStyle, Rgb]> = [
  ['light chart', TV_DEFAULT, [41, 98, 255]],
  ['dark chart', DARK, [255, 214, 10]],
];

for (const [name, style, ink] of bases) {
  describe(`${name}: lines and boxes in any colour`, () => {
    const make = () => {
      const c = layout(mixed(6), { style, pitch: 40, height: 300 });
      return copyImage(renderChart({ ...c, width: c.width + 50 }).image);
    };
    const check = (img: PixelImage, lossy = false) =>
      detect(img, { ...DEFAULT_SETTINGS, lossySource: lossy });

    it('a solid line across the chart, over the candles', () => {
      const img = make();
      overlayLine(img, { x0: 0, y0: 80, x1: img.width, y1: 80, color: ink });
      const r = check(img);
      expect(r.candles).toHaveLength(6);
      expect(lines(r)).toHaveLength(1);
      const l = lines(r)[0] as LineExtra;
      expect(l.y1).toBeCloseTo(80.5, 1);
      expect(l.y2).toBeCloseTo(80.5, 1);
      expect(l.x1).toBeLessThanOrEqual(1);
      expect(l.x2).toBeGreaterThanOrEqual(img.width - 1);
      expect(l.width).toBe(1);
      expect(l.dash).toBeNull();
      expect(r.cleanliness.clean).toBe(true);
    });

    it('a line that runs through the candles keeps their shape', () => {
      const img = make();
      overlayLine(img, { x0: 0, y0: 160, x1: img.width, y1: 160, color: ink });
      const r = check(img);
      expect(r.candles).toHaveLength(6);
      expect(lines(r)).toHaveLength(1);
      expect(r.candles[0]?.bodyTop).toBeCloseTo(120, 0);
    });

    it('a dashed line', () => {
      const img = make();
      overlayLine(img, { x0: 10, y0: 60, x1: 280, y1: 60, color: ink, dash: [8, 5] });
      const r = check(img);
      expect(r.candles).toHaveLength(6);
      const l = lines(r);
      expect(l).toHaveLength(1);
      expect(l[0]?.dash).toEqual([8, 5]);
      expect(l[0]?.x1).toBeCloseTo(10, 0);
    });

    it('a dotted line', () => {
      const img = make();
      overlayLine(img, { x0: 0, y0: 50, x1: 290, y1: 50, color: ink, dash: [1, 3] });
      const r = check(img);
      expect(r.candles).toHaveLength(6);
      expect(lines(r)).toHaveLength(1);
      expect(lines(r)[0]?.dash).toEqual([1, 3]);
    });

    it('a dashed vertical line through a candle', () => {
      const img = make();
      overlayLine(img, { x0: 150, y0: 0, x1: 150, y1: img.height, color: ink, dash: [6, 4] });
      const r = check(img);
      expect(r.candles).toHaveLength(6);
      expect(lines(r)).toHaveLength(1);
      expect(lines(r)[0]?.dash).toEqual([6, 4]);
      expect(r.candles[3]?.wickBottom).toBeGreaterThan(230);
    });

    it('a shaded box over the candles', () => {
      const img = make();
      // (a box so strong that it outshines the candles themselves is a known limit)
      overlayBox(img, {
        x0: 50,
        y0: 80,
        x1: 190,
        y1: 240,
        color: ink,
        alpha: name === 'dark chart' ? 0.09 : 0.18,
      });
      const r = check(img);
      expect(r.candles).toHaveLength(6);
      expect(boxes(r)).toHaveLength(1);
      const b = boxes(r)[0] as BoxExtra;
      expect([b.x, b.y, b.width, b.height]).toEqual([50, 80, 140, 160]);
      expect(r.cleanliness.clean).toBe(true);
    });

    it('price labels on the right: one text per label, in the right place', () => {
      const img = make();
      ['4523.5', '4518.0', '4512.5'].forEach((t, i) =>
        overlayText(img, t, img.width - 46, 30 + i * 55, { color: ink, scale: 2 }),
      );
      const r = check(img);
      expect(r.candles).toHaveLength(6);
      const t = texts(r);
      expect(t).toHaveLength(3);
      expect(t.map((x) => x.region.y)).toEqual([30, 85, 140]);
      expect(t.every((x) => x.unread && x.text === '')).toBe(true);
    });

    it('a line that survives JPEG', () => {
      const img = make();
      overlayLine(img, { x0: 0, y0: 70, x1: img.width, y1: 70, color: ink });
      const r = check(jpegRoundTrip(img, 75), true);
      expect(r.candles).toHaveLength(6);
      expect(lines(r)).toHaveLength(1);
      expect(near((lines(r)[0] as LineExtra).y1, 70.5, 1)).toBe(true);
    });
  });
}

describe('slanted lines', () => {
  it('a thin slanted line is found with its two ends', () => {
    const c = layout(mixed(6), { style: TV_DEFAULT, pitch: 40, height: 300 });
    const img = copyImage(renderChart({ ...c, width: c.width + 50 }).image);
    // y = 20 + 0.4 x, drawn with a 1 px brush
    for (let x = 30; x <= 270; x++) {
      const y = 20 + 0.4 * (x - 30);
      const y0 = Math.floor(y);
      const f = y - y0;
      for (const [dy, a] of [
        [0, 1 - f],
        [1, f],
      ] as const) {
        const i = ((y0 + dy) * img.width + x) * 4;
        for (let k = 0; k < 3; k++) {
          img.data[i + k] = Math.round(
            (img.data[i + k] as number) * (1 - a) + ([200, 60, 60][k] as number) * a,
          );
        }
      }
    }
    const r = detect(img);
    expect(r.candles).toHaveLength(6);
    expect(lines(r)).toHaveLength(1);
    const l = lines(r)[0] as LineExtra;
    expect(near(l.x1, 30, 2) && near(l.x2, 271, 2)).toBe(true);
    expect(near(l.y1, 20.5, 1.5) && near(l.y2, 20.5 + 0.4 * 240, 2)).toBe(true);
  });
});

describe('what is not found', () => {
  it('a chart of only candles has no extras', () => {
    const c = layout(mixed(7), { style: TV_DEFAULT, pitch: 40, height: 300 });
    const r = detect(renderChart(c).image);
    expect(r.extras).toEqual([]);
  });
});
