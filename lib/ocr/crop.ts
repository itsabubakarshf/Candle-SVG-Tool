import { deltaE, rgbToLab, type Lab, type Rgb } from '@/lib/color/lab';
import { overWhite } from '@/lib/detect/background';
import type { PixelImage } from '@/lib/detect/types';

export interface Crop {
  width: number;
  height: number;
  /** RGBA, black letters on white. */
  data: Uint8ClampedArray<ArrayBuffer>;
}

/** Plain margin around the letters, in output pixels: the recogniser reads edges badly. */
const MARGIN = 24;

/**
 * A picture of one label that a text recogniser can read: dark letters on a white page, enlarged.
 * It works from "how different is this pixel from what is behind the letters", so light text on
 * a dark chart, grey text on white and text on a coloured box all come out the same way.
 */
export function labelCrop(
  image: PixelImage,
  region: { x: number; y: number; width: number; height: number },
  options: { pad?: number; scale?: number } = {},
): Crop {
  const pad = options.pad ?? 3;
  const x0 = Math.max(0, Math.floor(region.x) - pad);
  const y0 = Math.max(0, Math.floor(region.y) - pad);
  const x1 = Math.min(image.width, Math.ceil(region.x + region.width) + pad);
  const y1 = Math.min(image.height, Math.ceil(region.y + region.height) + pad);
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const scale =
    options.scale ?? Math.max(3, Math.min(8, Math.round(28 / Math.max(1, region.height))));

  const colour = (x: number, y: number): Rgb => {
    const i = ((y0 + y) * image.width + x0 + x) * 4;
    const a = image.data[i + 3] as number;
    return [
      overWhite(image.data[i] as number, a),
      overWhite(image.data[i + 1] as number, a),
      overWhite(image.data[i + 2] as number, a),
    ];
  };

  // What is behind the letters: the commonest colour on the rim of the picture.
  const counts = new Map<number, { n: number; c: Rgb }>();
  const rim = (x: number, y: number) => {
    const c = colour(x, y);
    const key = ((c[0] >> 3) << 10) | ((c[1] >> 3) << 5) | (c[2] >> 3);
    const e = counts.get(key);
    if (e) e.n++;
    else counts.set(key, { n: 1, c });
  };
  for (let x = 0; x < w; x++) {
    rim(x, 0);
    rim(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    rim(0, y);
    rim(w - 1, y);
  }
  let back: Rgb = [255, 255, 255];
  let best = 0;
  for (const e of counts.values()) {
    if (e.n > best) {
      best = e.n;
      back = e.c;
    }
  }
  const backLab: Lab = rgbToLab(...(back.map(Math.round) as Rgb));

  const ink = new Float32Array(w * h);
  let max = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = colour(x, y).map(Math.round) as Rgb;
      const d = deltaE(rgbToLab(...c), backLab);
      ink[y * w + x] = d;
      if (d > max) max = d;
    }
  }
  // below a few ΔE it is noise, not a letter
  const floor = Math.min(3, 0.15 * max);

  const W = w * scale + 2 * MARGIN;
  const H = h * scale + 2 * MARGIN;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const at = (x: number, y: number) =>
    Math.min(1, Math.max(0, ((ink[y * w + x] as number) - floor) / (max - floor)));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = (x - MARGIN) / scale - 0.5;
      const sy = (y - MARGIN) / scale - 0.5;
      if (sx < -0.5 || sy < -0.5 || sx > w - 0.5 || sy > h - 0.5) continue;
      const fx0 = Math.max(0, Math.floor(sx));
      const fy0 = Math.max(0, Math.floor(sy));
      const fx1 = Math.min(w - 1, fx0 + 1);
      const fy1 = Math.min(h - 1, fy0 + 1);
      const tx = Math.min(1, Math.max(0, sx - fx0));
      const ty = Math.min(1, Math.max(0, sy - fy0));
      const v =
        at(fx0, fy0) * (1 - tx) * (1 - ty) +
        at(fx1, fy0) * tx * (1 - ty) +
        at(fx0, fy1) * (1 - tx) * ty +
        at(fx1, fy1) * tx * ty;
      const g = Math.round(255 * (1 - v));
      const i = (y * W + x) * 4;
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g;
    }
  }
  return { width: W, height: H, data };
}

/** What a recogniser said, tidied: one line, no stray symbols at the ends. */
export function tidyText(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^[\s|_~`'"^*•·.,;-]+(?=[\w$€£#+−-])/, '')
    .replace(/[\s|_~`^]+$/, '')
    .trim();
}
