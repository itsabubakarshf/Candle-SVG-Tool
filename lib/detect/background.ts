import type { Rgb } from '@/lib/color/lab';
import type { PixelImage } from './types';

const RING = 3;

/** Alpha-composites a channel over white, so transparent PNGs behave like a white page. */
export function overWhite(c: number, a: number): number {
  return a === 255 ? c : (c * a + 255 * (255 - a)) / 255;
}

/**
 * Background colour = the most common colour in the outer 3 px ring.
 * Colours are bucketed (8 levels per channel) and the winning bucket's average is returned.
 */
export function findBackground(image: PixelImage): Rgb {
  const { width, height, data } = image;
  const ring = Math.min(RING, Math.floor(Math.min(width, height) / 2)) || 1;
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();

  const add = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    const a = data[i + 3] as number;
    const r = overWhite(data[i] as number, a);
    const g = overWhite(data[i + 1] as number, a);
    const b = overWhite(data[i + 2] as number, a);
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const entry = counts.get(key);
    if (entry) {
      entry.n++;
      entry.r += r;
      entry.g += g;
      entry.b += b;
    } else {
      counts.set(key, { n: 1, r, g, b });
    }
  };

  for (let y = 0; y < height; y++) {
    const edgeRow = y < ring || y >= height - ring;
    if (edgeRow) {
      for (let x = 0; x < width; x++) add(x, y);
    } else {
      for (let x = 0; x < ring; x++) add(x, y);
      for (let x = Math.max(ring, width - ring); x < width; x++) add(x, y);
    }
  }

  let best: { n: number; r: number; g: number; b: number } | undefined;
  for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
  if (!best) return [255, 255, 255];
  return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
}
