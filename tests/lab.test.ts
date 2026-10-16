import { describe, expect, it } from 'vitest';
import { deltaE, rgbToHueSat, rgbToLab } from '@/lib/color/lab';

describe('rgbToLab', () => {
  it('maps white and black', () => {
    const w = rgbToLab(255, 255, 255);
    expect(w[0]).toBeCloseTo(100, 1);
    expect(Math.abs(w[1])).toBeLessThan(0.05);
    expect(Math.abs(w[2])).toBeLessThan(0.05);
    expect(rgbToLab(0, 0, 0)[0]).toBeCloseTo(0, 3);
  });

  it('matches reference values for sRGB red and mid grey', () => {
    const red = rgbToLab(255, 0, 0);
    expect(red[0]).toBeCloseTo(53.24, 1);
    expect(red[1]).toBeCloseTo(80.09, 0);
    expect(red[2]).toBeCloseTo(67.2, 0);
    expect(rgbToLab(119, 119, 119)[0]).toBeCloseTo(50, 0);
  });
});

describe('deltaE', () => {
  it('is zero for equal colours and symmetric', () => {
    const a = rgbToLab(10, 200, 30);
    const b = rgbToLab(200, 10, 30);
    expect(deltaE(a, a)).toBe(0);
    expect(deltaE(a, b)).toBeCloseTo(deltaE(b, a), 10);
  });

  it('sees white vs near-white as nearly identical (hollow bull on white)', () => {
    expect(deltaE(rgbToLab(255, 255, 255), rgbToLab(252, 252, 254))).toBeLessThan(2);
  });
});

describe('rgbToHueSat', () => {
  it('finds the TradingView green and red hues', () => {
    const green = rgbToHueSat(8, 153, 129);
    expect(green.hue).toBeGreaterThan(60);
    expect(green.hue).toBeLessThan(180);
    const red = rgbToHueSat(242, 54, 69);
    expect(red.hue > 330 || red.hue < 30).toBe(true);
    expect(rgbToHueSat(120, 120, 120).saturation).toBe(0);
  });
});
