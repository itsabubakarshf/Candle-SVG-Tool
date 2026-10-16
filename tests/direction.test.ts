import { describe, expect, it } from 'vitest';
import { detect } from '@/lib/detect';
import { groupCandles, structureMisfit } from '@/lib/detect/direction';
import { DEFAULT_SETTINGS } from '@/lib/detect/types';
import {
  layout,
  randomChart,
  renderChart,
  seededRandom,
  type SynthCandle,
  type SynthStyle,
} from './synth/generate';

const style = (
  bg: number[],
  bull: [number[], number[]],
  bear: [number[], number[]],
): SynthStyle => ({
  background: bg as never,
  bull: { fill: bull[0] as never, border: bull[1] as never, wick: bull[1] as never },
  bear: { fill: bear[0] as never, border: bear[1] as never, wick: bear[1] as never },
  borderWidth: 1,
  wickWidth: 1,
});
const solid = (c: number[]): [number[], number[]] => [c, c];

const SCHEMES: Record<string, SynthStyle> = {
  'white up, red down (the friend case), light chart': style(
    [255, 255, 255],
    [
      [255, 255, 255],
      [60, 60, 60],
    ],
    solid([230, 30, 50]),
  ),
  'white up, red down, dark chart': style(
    [19, 23, 34],
    solid([255, 255, 255]),
    solid([230, 30, 50]),
  ),
  'blue up, orange down': style([255, 255, 255], solid([41, 98, 255]), solid([255, 152, 0])),
  'red up, green down (Asian convention)': style(
    [255, 255, 255],
    solid([242, 54, 69]),
    solid([8, 153, 129]),
  ),
  'black up, white down': style([128, 128, 128], solid([20, 20, 20]), solid([245, 245, 245])),
  'yellow up, purple down': style([19, 23, 34], solid([250, 204, 21]), solid([168, 85, 247])),
  'green up, red down (the usual)': style(
    [255, 255, 255],
    solid([8, 153, 129]),
    solid([242, 54, 69]),
  ),
};

describe('which colour is rising', () => {
  for (const [name, s] of Object.entries(SCHEMES)) {
    it(`gets it right for ${name}, without asking`, () => {
      let wrong = 0;
      let asked = 0;
      let total = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const chart = randomChart(10, seed, s);
        const r = detect(renderChart(chart).image, DEFAULT_SETTINGS);
        expect(r.candles.length).toBe(10);
        if (!r.direction?.sure) asked++;
        r.candles.forEach((c, i) => {
          total++;
          if (c.type !== chart.candles[i]?.type) wrong++;
        });
      }
      expect(wrong).toBe(0);
      expect(asked).toBe(0);
      expect(total).toBe(100);
    });
  }

  it('says which group is rising, and how it knows', () => {
    const chart = randomChart(10, 3, SCHEMES['blue up, orange down'] as SynthStyle);
    const r = detect(renderChart(chart).image, DEFAULT_SETTINGS);
    expect(r.direction?.source).toBe('structure');
    const up = r.direction?.groups[r.direction.upGroup]?.colours?.body;
    expect(up).toBe('#2962FF');
    const usual = detect(
      renderChart(randomChart(10, 3, SCHEMES['green up, red down (the usual)'] as SynthStyle))
        .image,
      DEFAULT_SETTINGS,
    );
    expect(usual.direction?.sure).toBe(true);
  });

  it('trusts the layout over the green-is-up convention when they disagree', () => {
    const chart = randomChart(
      12,
      5,
      SCHEMES['red up, green down (Asian convention)'] as SynthStyle,
    );
    const r = detect(renderChart(chart).image, DEFAULT_SETTINGS);
    expect(r.direction?.source).toBe('structure');
    expect(r.candles.every((c, i) => c.type === chart.candles[i]?.type)).toBe(true);
  });

  it('asks when the colours are unusual and the layout says nothing (gappy, short chart)', () => {
    const rnd = seededRandom(9);
    const specs: Array<Omit<SynthCandle, 'centerX'>> = [];
    for (let i = 0; i < 3; i++) {
      const top = 120 + rnd() * 200;
      specs.push({
        bodyWidth: 20,
        bodyTop: top,
        bodyBottom: top + 30 + rnd() * 60,
        wickTop: top - 20,
        wickBottom: top + 120,
        type: i % 2 ? 'bear' : 'bull',
      });
    }
    const s = SCHEMES['blue up, orange down'] as SynthStyle;
    const r = detect(
      renderChart(layout(specs, { style: s, pitch: 30, height: 600 })).image,
      DEFAULT_SETTINGS,
    );
    expect(r.candles.length).toBe(3);
    expect(r.direction?.sure).toBe(false);
    expect(r.direction?.source).toBe('prior');
  });

  it('does not ask for the usual green and red even when the layout is unclear', () => {
    const s = SCHEMES['green up, red down (the usual)'] as SynthStyle;
    const specs: Array<Omit<SynthCandle, 'centerX'>> = [
      { bodyWidth: 20, bodyTop: 100, bodyBottom: 160, wickTop: 70, wickBottom: 190, type: 'bull' },
      { bodyWidth: 20, bodyTop: 250, bodyBottom: 300, wickTop: 220, wickBottom: 330, type: 'bear' },
    ];
    const r = detect(
      renderChart(layout(specs, { style: s, pitch: 30, height: 400 })).image,
      DEFAULT_SETTINGS,
    );
    expect(r.direction?.sure).toBe(true);
    expect(r.candles.map((c) => c.type)).toEqual(['bull', 'bear']);
  });

  it('is never confidently wrong on a chart with gaps (it asks instead)', () => {
    const s = SCHEMES['blue up, orange down'] as SynthStyle;
    let confidentlyWrong = 0;
    let total = 0;
    for (const gap of [0.6, 1, 2]) {
      for (let seed = 1; seed <= 15; seed++) {
        const rnd = seededRandom(seed * 13);
        const specs: Array<Omit<SynthCandle, 'centerX'>> = [];
        let price = 300;
        for (let i = 0; i < 10; i++) {
          const open = Math.max(80, Math.min(520, price + (rnd() - 0.5) * 2 * gap * 40));
          const close = Math.max(60, Math.min(540, open + (rnd() - 0.5) * 90));
          price = close;
          const top = Math.min(open, close);
          const bottom = Math.max(open, close);
          specs.push({
            bodyWidth: 20,
            bodyTop: top,
            bodyBottom: bottom,
            wickTop: top - 6,
            wickBottom: bottom + 6,
            type: close <= open ? 'bull' : 'bear',
          });
        }
        const chart = layout(specs, { style: s, pitch: 28, height: 600 });
        const r = detect(renderChart(chart).image, DEFAULT_SETTINGS);
        if (r.candles.length !== 10) continue;
        total++;
        const right = r.candles.every((c, i) => c.type === chart.candles[i]?.type);
        if (r.direction?.sure && !right) confidentlyWrong++;
      }
    }
    expect(total).toBeGreaterThan(35);
    expect(confidentlyWrong).toBeLessThanOrEqual(2);
  });
});

describe('colour groups', () => {
  it('keeps a candle highlighted in another shade of green in the green group', () => {
    const s = SCHEMES['green up, red down (the usual)'] as SynthStyle;
    const specs: Array<Omit<SynthCandle, 'centerX'>> = [0, 1, 2, 3].map((i) => ({
      bodyWidth: 20,
      bodyTop: 100 + i * 10,
      bodyBottom: 160 + i * 10,
      wickTop: 70,
      wickBottom: 220,
      type: 'bull' as const,
    }));
    const { image } = renderChart(layout(specs, { style: s, pitch: 40, height: 300 }));
    // repaint candle 3 in another green
    const x0 = 12 + 10 + 2 * 40 - 14;
    for (let y = 0; y < image.height; y++)
      for (let x = x0; x < x0 + 28; x++) {
        const i = (y * image.width + x) * 4;
        if (image.data[i] !== 255 || image.data[i + 1] !== 255 || image.data[i + 2] !== 255) {
          image.data[i] = 0;
          image.data[i + 1] = 200;
          image.data[i + 2] = 83;
        }
      }
    const r = detect(image, DEFAULT_SETTINGS);
    expect(new Set(r.candles.map((c) => c.group)).size).toBe(1);
  });

  it('puts a lone flat candle of another colour in its own group', () => {
    const s = SCHEMES['blue up, orange down'] as SynthStyle;
    const chart = randomChart(8, 4, s);
    const r = detect(renderChart(chart).image, DEFAULT_SETTINGS);
    expect(r.candles.length).toBe(8);
    expect(new Set(r.candles.map((c) => c.group)).size).toBe(2);
  });

  it('a layout that lines up has a much smaller misfit one way than the other', () => {
    // bull then bear: the bear opens where the bull closed
    const m = structureMisfit(
      [0, 1, 0, 1],
      [
        { bodyTop: 100, bodyBottom: 160 },
        { bodyTop: 100, bodyBottom: 140 },
        { bodyTop: 100, bodyBottom: 140 },
        { bodyTop: 100, bodyBottom: 130 },
      ],
    );
    expect(m.pairs).toBe(3);
    expect(m.misfit[0]).toBeLessThan(m.misfit[1]);
  });

  it('is a single group when every candle looks the same', () => {
    expect(
      groupCandles(
        [0, 1, 2].map(() => ({
          rgb: [8, 153, 129] as [number, number, number],
          borderOnly: false,
        })),
        [0, 1, 2].map(() => ({ borderRgb: [8, 153, 129] as [number, number, number] })) as never,
      ).counts,
    ).toEqual([3, 0]);
  });
});
