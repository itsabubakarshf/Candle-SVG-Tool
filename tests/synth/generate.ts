/**
 * Synthetic candle charts with known geometry.
 *
 * Shapes are axis-aligned rectangles rendered with exact area coverage per pixel, so
 * the true edge positions are known to floating-point precision (pixel i covers [i, i+1]).
 * Degradations (scale, blur, JPEG, offset) simulate real screenshots.
 */
import jpeg from 'jpeg-js';
import type { PixelImage } from '@/lib/detect/types';

export type Rgb = [number, number, number];
export type SynthType = 'bull' | 'bear';

export interface SynthCandle {
  /** Centre of the candle in 1x pixels. May be fractional. */
  centerX: number;
  bodyWidth: number;
  bodyTop: number;
  bodyBottom: number;
  /** null = no wick on that side */
  wickTop: number | null;
  wickBottom: number | null;
  type: SynthType;
}

export interface SynthColors {
  fill: Rgb;
  border: Rgb;
  wick: Rgb;
}

export interface SynthStyle {
  background: Rgb;
  bull: SynthColors;
  bear: SynthColors;
  borderWidth: number;
  wickWidth: number;
}

export interface SynthChart {
  width: number;
  height: number;
  candles: SynthCandle[];
  style: SynthStyle;
}

/** True geometry of one candle in the final image's pixel space. */
export interface TruthCandle {
  centerX: number;
  bodyLeft: number;
  bodyRight: number;
  bodyTop: number;
  bodyBottom: number;
  wickTop: number | null;
  wickBottom: number | null;
  type: SynthType;
  isDoji: boolean;
}

export interface RenderOptions {
  /** Multiplies all geometry (including line widths). 1.25 = Windows 125%. */
  scale?: number;
  offsetX?: number;
  offsetY?: number;
}

export interface Rendered {
  image: PixelImage;
  truth: TruthCandle[];
}

// ---------------------------------------------------------------- styles

/** Abbi's style: hollow (white) bull, dark bear, thin dark borders. */
export const ABBI_LIGHT: SynthStyle = {
  background: [255, 255, 255],
  bull: { fill: [252, 252, 254], border: [43, 47, 54], wick: [43, 47, 54] },
  bear: { fill: [43, 47, 54], border: [43, 47, 54], wick: [43, 47, 54] },
  borderWidth: 1,
  wickWidth: 1,
};

/** TradingView default green and red, solid fills. */
export const TV_DEFAULT: SynthStyle = {
  background: [255, 255, 255],
  bull: { fill: [8, 153, 129], border: [8, 153, 129], wick: [8, 153, 129] },
  bear: { fill: [242, 54, 69], border: [242, 54, 69], wick: [242, 54, 69] },
  borderWidth: 1,
  wickWidth: 1,
};

// ---------------------------------------------------------------- rendering

class Canvas {
  readonly data: Float64Array; // RGB, 3 floats per pixel

  constructor(
    readonly width: number,
    readonly height: number,
    bg: Rgb,
  ) {
    this.data = new Float64Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      this.data[i * 3] = bg[0];
      this.data[i * 3 + 1] = bg[1];
      this.data[i * 3 + 2] = bg[2];
    }
  }

  /** Paints a rectangle using exact per-pixel overlap area as alpha. */
  rect(x0: number, y0: number, x1: number, y1: number, color: Rgb): void {
    if (x1 <= x0 || y1 <= y0) return;
    const ix0 = Math.max(0, Math.floor(x0));
    const ix1 = Math.min(this.width, Math.ceil(x1));
    const iy0 = Math.max(0, Math.floor(y0));
    const iy1 = Math.min(this.height, Math.ceil(y1));
    for (let y = iy0; y < iy1; y++) {
      const oy = Math.min(y1, y + 1) - Math.max(y0, y);
      if (oy <= 0) continue;
      for (let x = ix0; x < ix1; x++) {
        const ox = Math.min(x1, x + 1) - Math.max(x0, x);
        if (ox <= 0) continue;
        const a = ox * oy;
        const i = (y * this.width + x) * 3;
        this.data[i] = (this.data[i] as number) * (1 - a) + color[0] * a;
        this.data[i + 1] = (this.data[i + 1] as number) * (1 - a) + color[1] * a;
        this.data[i + 2] = (this.data[i + 2] as number) * (1 - a) + color[2] * a;
      }
    }
  }

  toImage(): PixelImage {
    const out = new Uint8ClampedArray(this.width * this.height * 4);
    for (let p = 0; p < this.width * this.height; p++) {
      out[p * 4] = Math.round(this.data[p * 3] as number);
      out[p * 4 + 1] = Math.round(this.data[p * 3 + 1] as number);
      out[p * 4 + 2] = Math.round(this.data[p * 3 + 2] as number);
      out[p * 4 + 3] = 255;
    }
    return { width: this.width, height: this.height, data: out };
  }
}

export function renderChart(chart: SynthChart, options: RenderOptions = {}): Rendered {
  const s = options.scale ?? 1;
  const dx = options.offsetX ?? 0;
  const dy = options.offsetY ?? 0;
  const width = Math.round(chart.width * s);
  const height = Math.round(chart.height * s);
  const canvas = new Canvas(width, height, chart.style.background);
  const truth: TruthCandle[] = [];
  const bw = chart.style.borderWidth * s;
  const ww = chart.style.wickWidth * s;

  for (const c of chart.candles) {
    const colors = chart.style[c.type];
    const cx = c.centerX * s + dx;
    const half = (c.bodyWidth * s) / 2;
    const left = cx - half;
    const right = cx + half;
    const top = c.bodyTop * s + dy;
    // A flat candle (open = close) is drawn as a line one border thick.
    const bottom = Math.max(c.bodyBottom * s + dy, top + bw);
    const wickTop = c.wickTop === null ? null : c.wickTop * s + dy;
    const wickBottom = c.wickBottom === null ? null : c.wickBottom * s + dy;

    if (wickTop !== null) canvas.rect(cx - ww / 2, wickTop, cx + ww / 2, top, colors.wick);
    if (wickBottom !== null) canvas.rect(cx - ww / 2, bottom, cx + ww / 2, wickBottom, colors.wick);
    canvas.rect(left, top, right, bottom, colors.border);
    canvas.rect(left + bw, top + bw, right - bw, bottom - bw, colors.fill);

    truth.push({
      centerX: cx,
      bodyLeft: left,
      bodyRight: right,
      bodyTop: top,
      bodyBottom: bottom,
      wickTop,
      wickBottom,
      type: c.type,
      isDoji: bottom - top < 2,
    });
  }
  return { image: canvas.toImage(), truth };
}

// ---------------------------------------------------------------- degradations

function gaussianKernel(sigma: number): number[] {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const k: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(v);
    sum += v;
  }
  return k.map((v) => v / sum);
}

/** Slight blur (separable Gaussian). Edge positions of the true shapes are unchanged. */
export function blur(image: PixelImage, sigma = 0.6): PixelImage {
  const { width, height, data } = image;
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) / 2;
  const tmp = new Float64Array(width * height * 3);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let j = -r; j <= r; j++) {
          const xx = Math.min(width - 1, Math.max(0, x + j));
          acc += (k[j + r] as number) * (data[(y * width + xx) * 4 + c] as number);
        }
        tmp[(y * width + x) * 3 + c] = acc;
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let j = -r; j <= r; j++) {
          const yy = Math.min(height - 1, Math.max(0, y + j));
          acc += (k[j + r] as number) * (tmp[(yy * width + x) * 3 + c] as number);
        }
        out[(y * width + x) * 4 + c] = Math.round(acc);
      }
      out[(y * width + x) * 4 + 3] = 255;
    }
  }
  return { width, height, data: out };
}

/** Encode as JPEG and decode again (quality 70 by default). */
export function jpegRoundTrip(image: PixelImage, quality = 70): PixelImage {
  const encoded = jpeg.encode(
    { data: Buffer.from(image.data), width: image.width, height: image.height },
    quality,
  );
  const decoded = jpeg.decode(encoded.data, { useTArray: true });
  return { width: decoded.width, height: decoded.height, data: decoded.data };
}

/** Bilinear resize, like a screenshot that was scaled after capture. */
export function resizeBilinear(image: PixelImage, scale: number): PixelImage {
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(image.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(image.width - 1, x0 + 1);
      const fx = sx - x0;
      for (let c = 0; c < 4; c++) {
        const p = (xx: number, yy: number) => image.data[(yy * image.width + xx) * 4 + c] as number;
        const top = p(x0, y0) * (1 - fx) + p(x1, y0) * fx;
        const bot = p(x0, y1) * (1 - fx) + p(x1, y1) * fx;
        out[(y * width + x) * 4 + c] = Math.round(top * (1 - fy) + bot * fy);
      }
    }
  }
  return { width, height, data: out };
}

// ---------------------------------------------------------------- helpers

/** Deterministic random numbers so tests are repeatable. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lays candles out left to right with a fixed pitch. */
export function layout(
  specs: Array<Omit<SynthCandle, 'centerX'>>,
  opts: { style: SynthStyle; pitch: number; margin?: number; height: number; startX?: number },
): SynthChart {
  const margin = opts.margin ?? 12;
  // Real renderers snap 1 px lines to whole pixels. Put the first centre on a pixel centre
  // (x.5) so a 1 px wick is crisp, as in a real screenshot.
  const startX = opts.startX ?? Math.floor(margin + (specs[0]?.bodyWidth ?? 0) / 2) + 0.5;
  const candles = specs.map((s, i) => ({ ...s, centerX: startX + i * opts.pitch }));
  const last = candles[candles.length - 1];
  const width = Math.ceil((last ? last.centerX + last.bodyWidth / 2 : 0) + margin);
  return { width, height: opts.height, candles, style: opts.style };
}

/** Random but plausible chart: a walk of open/close with wicks. */
export function randomChart(
  count: number,
  seed: number,
  style: SynthStyle,
  bodyWidth = 20,
  pitch = bodyWidth + 8,
): SynthChart {
  const rnd = seededRandom(seed);
  const specs: Array<Omit<SynthCandle, 'centerX'>> = [];
  let price = 300;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = Math.max(60, Math.min(540, open + (rnd() - 0.5) * 90));
    price = close;
    const top = Math.min(open, close);
    const bottom = Math.max(open, close);
    specs.push({
      bodyWidth,
      bodyTop: top,
      bodyBottom: bottom,
      wickTop: rnd() < 0.9 ? top - 4 - rnd() * 40 : null,
      wickBottom: rnd() < 0.9 ? bottom + 4 + rnd() * 40 : null,
      type: close >= open ? 'bull' : 'bear',
    });
  }
  return layout(specs, { style, pitch, height: 600 });
}
