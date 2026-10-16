import { describe, expect, it } from 'vitest';
import type { Candle } from '@/lib/detect/types';
import {
  flipType,
  mergeCandles,
  resetOverride,
  setColorOverride,
  setEdge,
  splitCandle,
} from '@/lib/edit/ops';

const base: Candle = {
  id: 'c1',
  centerX: 50,
  bodyLeft: 30,
  bodyRight: 70,
  bodyTop: 100,
  bodyBottom: 160,
  wickTop: 60,
  wickBottom: 200,
  type: 'bull',
  isDoji: false,
  confidence: 0.4,
};

describe('flip and overrides', () => {
  it('flips the type of that candle and clears its review flag', () => {
    const f = flipType(base);
    expect(f.type).toBe('bear');
    expect(f.confidence).toBe(1);
    expect(base.type).toBe('bull'); // original untouched
  });

  it('sets, removes and resets colour overrides', () => {
    const a = setColorOverride(base, 'body', '#112233');
    expect(a.colorOverride).toEqual({ body: '#112233' });
    const b = setColorOverride(a, 'wick', '#445566');
    expect(b.colorOverride).toEqual({ body: '#112233', wick: '#445566' });
    expect(setColorOverride(b, 'body', null).colorOverride).toEqual({ wick: '#445566' });
    expect(resetOverride(b).colorOverride).toBeUndefined();
    expect(setColorOverride(a, 'body', null).colorOverride).toBeUndefined();
  });
});

describe('setEdge', () => {
  it('keeps the top above the bottom and pulls wicks along', () => {
    expect(setEdge(base, 'bodyTop', 170).bodyTop).toBe(160);
    expect(setEdge(base, 'bodyBottom', 90).bodyBottom).toBe(100);
    const lowered = setEdge(base, 'bodyTop', 50);
    expect(lowered.bodyTop).toBe(50);
    expect(lowered.wickTop).toBe(50); // wick can't stay inside the body
  });

  it('keeps wicks outside the body, and can create or remove them', () => {
    expect(setEdge(base, 'wickTop', 120).wickTop).toBe(100);
    expect(setEdge(base, 'wickBottom', 120).wickBottom).toBe(160);
    expect(setEdge({ ...base, wickTop: null }, 'wickTop', 70).wickTop).toBe(70);
    expect(setEdge(base, 'wickBottom', null).wickBottom).toBeNull();
  });

  it('moves left and right edges and keeps the centre in step', () => {
    const l = setEdge(base, 'bodyLeft', 20);
    expect(l.bodyLeft).toBe(20);
    expect(l.centerX).toBe(45);
    expect(setEdge(base, 'bodyRight', 25).bodyRight).toBeGreaterThan(base.bodyLeft);
  });

  it('rounds to 2 decimals and updates the flat flag', () => {
    expect(setEdge(base, 'bodyTop', 100.12345).bodyTop).toBe(100.12);
    const flat = setEdge(setEdge(base, 'bodyBottom', 100.5), 'bodyTop', 100);
    expect(flat.isDoji).toBe(true);
  });
});

describe('split and merge', () => {
  it('splits at x into two candles that fill the old width', () => {
    const parts = splitCandle(base, 45);
    expect(parts).not.toBeNull();
    const [a, b] = parts!;
    expect([a.bodyLeft, a.bodyRight]).toEqual([30, 45]);
    expect([b.bodyLeft, b.bodyRight]).toEqual([45, 70]);
    expect(a.centerX).toBe(37.5);
    expect(b.centerX).toBe(57.5);
    expect(a.id).not.toBe(b.id);
    expect(a.type).toBe(base.type);
  });

  it('refuses to split too close to an edge', () => {
    expect(splitCandle(base, 31)).toBeNull();
    expect(splitCandle(base, 69.5)).toBeNull();
  });

  it('merges two candles into their union', () => {
    const [a, b] = splitCandle(base, 45)!;
    const left: Candle = { ...a, bodyTop: 110, wickTop: 70, wickBottom: null };
    const right: Candle = { ...b, bodyBottom: 150, wickTop: null, wickBottom: 210 };
    const m = mergeCandles(left, right);
    expect([m.bodyLeft, m.bodyRight]).toEqual([30, 70]);
    expect(m.centerX).toBe(50);
    expect(m.bodyTop).toBe(100);
    expect(m.bodyBottom).toBe(160);
    expect(m.wickTop).toBe(70);
    expect(m.wickBottom).toBe(210);
  });
});
