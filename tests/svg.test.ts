import { describe, expect, it } from 'vitest';
import type { Candle } from '@/lib/detect/types';
import { DARK_PRESET, LIGHT_PRESET } from '@/lib/presets/builtins';
import { buildSvg, fmt } from '@/lib/svg/buildSvg';
import { normalizeHex } from '@/lib/svg/hex';

function candle(patch: Partial<Candle> = {}): Candle {
  return {
    id: 'a',
    centerX: 40.5,
    bodyLeft: 27.5,
    bodyRight: 53.5,
    bodyTop: 30,
    bodyBottom: 88,
    wickTop: 12.3,
    wickBottom: 104.7,
    type: 'bull',
    isDoji: false,
    confidence: 1,
    ...patch,
  };
}

const SIZE = { width: 282, height: 547 };

describe('buildSvg structure', () => {
  const svg = buildSvg([candle()], LIGHT_PRESET, SIZE);

  it('matches the example in the spec for one bull candle', () => {
    expect(svg).toContain('<g id="Candle 01">');
    expect(svg).toContain(
      '<line id="Upper wick" x1="40.5" y1="12.3" x2="40.5" y2="30" stroke="#2B2F36" stroke-width="1" stroke-linecap="butt"/>',
    );
    expect(svg).toContain(
      '<line id="Lower wick" x1="40.5" y1="88" x2="40.5" y2="104.7" stroke="#2B2F36" stroke-width="1" stroke-linecap="butt"/>',
    );
    expect(svg).toContain(
      '<rect id="Body" x="28" y="30.5" width="25" height="57" fill="#FFFFFF" stroke="#2B2F36" stroke-width="1"/>',
    );
  });

  it('sets size and viewBox to the crop size', () => {
    expect(
      svg.startsWith(
        '<svg xmlns="http://www.w3.org/2000/svg" width="282" height="547" viewBox="0 0 282 547">',
      ),
    ).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('orders wicks first, then the body, inside one group', () => {
    const g = svg.slice(svg.indexOf('<g id="Candle 01">'), svg.indexOf('</g>'));
    const order = [...g.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['Candle 01', 'Upper wick', 'Lower wick', 'Body']);
  });

  it('uses only plain attributes (nothing Figma ignores or breaks on)', () => {
    for (const bad of [
      '<style',
      'class=',
      'transform',
      'filter',
      'vector-effect',
      'href',
      'url(',
    ]) {
      expect(svg.includes(bad), bad).toBe(false);
    }
  });

  it('is well-formed: every tag opens and closes', () => {
    const opens = (svg.match(/<(svg|g)\b/g) ?? []).length;
    const closes = (svg.match(/<\/(svg|g)>/g) ?? []).length;
    expect(opens).toBe(closes);
    expect(svg.match(/<(line|rect)\b[^>]*\/>/g)?.length).toBe(3);
  });
});

describe('buildSvg details', () => {
  it('insets the body by half the border width so the outer edge stays put', () => {
    const preset = { ...LIGHT_PRESET, borderWidth: 4 };
    const svg = buildSvg(
      [candle({ bodyLeft: 10, bodyRight: 40, bodyTop: 20, bodyBottom: 80 })],
      preset,
      SIZE,
    );
    expect(svg).toContain('x="12" y="22" width="26" height="56"');
    expect(svg).toContain('stroke-width="4"');
  });

  it('draws two wick segments, never a line through the body', () => {
    const svg = buildSvg([candle()], LIGHT_PRESET, SIZE);
    expect((svg.match(/<line /g) ?? []).length).toBe(2);
  });

  it('omits a wick that is absent', () => {
    const svg = buildSvg([candle({ wickTop: null })], LIGHT_PRESET, SIZE);
    expect(svg).not.toContain('Upper wick');
    expect(svg).toContain('Lower wick');
    expect(
      buildSvg([candle({ wickTop: null, wickBottom: null })], LIGHT_PRESET, SIZE),
    ).not.toContain('<line');
  });

  it('draws a flat candle as a solid bar as thick as the border', () => {
    const svg = buildSvg(
      [candle({ isDoji: true, bodyTop: 50, bodyBottom: 51, wickTop: 20, wickBottom: 90 })],
      { ...LIGHT_PRESET, borderWidth: 2 },
      SIZE,
    );
    expect(svg).toContain(
      '<rect id="Body" x="27.5" y="49.5" width="26" height="2" fill="#2B2F36"/>',
    );
    expect(svg).toContain('y2="49.5"'); // upper wick stops at the bar
    expect(svg).toContain('y1="51.5"'); // lower wick starts under it
  });

  it('rounds to 2 decimals without trailing zeros', () => {
    expect(fmt(40.5)).toBe('40.5');
    expect(fmt(12.3456)).toBe('12.35');
    expect(fmt(30)).toBe('30');
    expect(fmt(0.004)).toBe('0');
    expect(fmt(-1.5)).toBe('-1.5');
    expect(fmt(100)).toBe('100');
  });

  it('numbers candles left to right whatever the input order', () => {
    const svg = buildSvg(
      [
        candle({ id: 'r', centerX: 90, bodyLeft: 77, bodyRight: 103, type: 'bear' }),
        candle({ id: 'l' }),
      ],
      LIGHT_PRESET,
      SIZE,
    );
    expect(svg.indexOf('Candle 01')).toBeLessThan(svg.indexOf('Candle 02'));
    // 01 is the left (bull, white) one, 02 the right (bear, dark)
    const first = svg.slice(svg.indexOf('Candle 01'), svg.indexOf('Candle 02'));
    expect(first).toContain('fill="#FFFFFF"');
  });

  it('uses the preset colours for bear candles and for another preset', () => {
    const bear = buildSvg([candle({ type: 'bear' })], LIGHT_PRESET, SIZE);
    expect(bear).toContain('fill="#2B2F36" stroke="#2B2F36"');
    const dark = buildSvg([candle()], DARK_PRESET, SIZE);
    expect(dark).toContain('fill="#14161A" stroke="#E6E8EC"');
  });

  it('applies a per-candle override to that candle only', () => {
    const svg = buildSvg(
      [
        candle({ colorOverride: { body: '#FF0000', wick: '#00FF00' } }),
        candle({ id: 'b', centerX: 100, bodyLeft: 87, bodyRight: 113 }),
      ],
      LIGHT_PRESET,
      SIZE,
    );
    const [first, second] = svg.split('<g id="Candle 02">') as [string, string];
    expect(first).toContain('fill="#FF0000"');
    expect(first).toContain('stroke="#00FF00"');
    expect(first).toContain('stroke="#2B2F36"'); // border not overridden
    expect(second).not.toContain('#FF0000');
  });

  it('is transparent by default and adds a named Background rect on request', () => {
    expect(buildSvg([candle()], LIGHT_PRESET, SIZE)).not.toContain('Background');
    const withBg = buildSvg([candle()], { ...LIGHT_PRESET, background: '#101010' }, SIZE, {
      background: true,
    });
    expect(withBg).toContain(
      '<rect id="Background" x="0" y="0" width="282" height="547" fill="#101010"/>',
    );
    expect(withBg.indexOf('Background')).toBeLessThan(withBg.indexOf('Candle 01'));
    expect(buildSvg([candle()], LIGHT_PRESET, SIZE, { background: true })).toContain(
      'fill="#FFFFFF"/>',
    );
  });

  it('produces an empty but valid svg for no candles', () => {
    expect(buildSvg([], LIGHT_PRESET, SIZE)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="282" height="547" viewBox="0 0 282 547">\n</svg>',
    );
  });
});

describe('normalizeHex', () => {
  it('accepts short and long forms, with or without #', () => {
    expect(normalizeHex('#abc')).toBe('#AABBCC');
    expect(normalizeHex('2b2f36')).toBe('#2B2F36');
    expect(normalizeHex(' #FfFfFf ')).toBe('#FFFFFF');
  });
  it('rejects anything else', () => {
    for (const bad of ['', '#12', '#12345', 'red', '#GGGGGG', '#1234567']) {
      expect(normalizeHex(bad), bad).toBeNull();
    }
  });
});
