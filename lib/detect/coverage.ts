import { deltaE, rgbToLab, type Rgb } from '@/lib/color/lab';
import { overWhite } from './background';
import type { PixelImage } from './types';

const CACHE_SIZE = 1 << 16;

/**
 * ΔE (CIE76, in Lab) between every pixel and the background colour.
 * Works on the original pixels: no resizing, no smoothing.
 */
export function deltaEMap(image: PixelImage, bg: Rgb): Float32Array {
  const { width, height, data } = image;
  const out = new Float32Array(width * height);
  const bgLab = rgbToLab(bg[0], bg[1], bg[2]);

  // Small direct-mapped cache: charts have few distinct colours, JPEG noise adds more.
  const keys = new Int32Array(CACHE_SIZE).fill(-1);
  const vals = new Float32Array(CACHE_SIZE);

  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    const a = data[i + 3] as number;
    const r = Math.round(overWhite(data[i] as number, a));
    const g = Math.round(overWhite(data[i + 1] as number, a));
    const b = Math.round(overWhite(data[i + 2] as number, a));
    if (r === bg[0] && g === bg[1] && b === bg[2]) continue; // out[p] stays 0
    const key = (r << 16) | (g << 8) | b;
    const slot = (Math.imul(key, 2654435761) >>> 16) & (CACHE_SIZE - 1);
    if (keys[slot] === key) {
      out[p] = vals[slot] as number;
    } else {
      const v = deltaE(rgbToLab(r, g, b), bgLab);
      keys[slot] = key;
      vals[slot] = v;
      out[p] = v;
    }
  }
  return out;
}

/** Coverage = clamp((ΔE − T_low) / (T_high − T_low), 0, 1). */
export function coverageOf(de: number, tLow: number, tHigh: number): number {
  const c = (de - tLow) / (tHigh - tLow);
  return c <= 0 ? 0 : c >= 1 ? 1 : c;
}
