import type { BoxExtra, Extra } from '@/lib/detect/types';

/** A box colour as it was drawn in TradingView: a colour and how see-through it is. */
export interface BoxStyle {
  color: string;
  opacity: number;
}

const KEY = 'candlesvg:boxStyles:v1';
const MAX = 8;
/** Abbi's usual box: #B8B8B8 at 21 %. On white it looks #F0F0F0. */
export const DEFAULT_BOX_STYLES: BoxStyle[] = [{ color: '#B8B8B8', opacity: 0.21 }];

const hexRgb = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * A screenshot only shows a see-through box blended with the chart behind it. When that blend is
 * what a known style gives over this background, the box gets the style's own colour and opacity.
 */
export function matchBoxStyle(
  seen: string,
  background: readonly [number, number, number],
  styles: BoxStyle[],
): BoxStyle | null {
  const got = hexRgb(seen);
  if (!got) return null;
  for (const s of styles) {
    const c = hexRgb(s.color);
    if (!c || !(s.opacity > 0 && s.opacity < 1)) continue;
    const ok = c.every(
      (v, i) =>
        Math.abs(v * s.opacity + (background[i] as number) * (1 - s.opacity) - got[i]!) <= 1.5,
    );
    if (ok) return s;
  }
  return null;
}

/** The detected boxes, each in its own style when one is known. */
export function applyBoxStyles(
  extras: Extra[],
  background: readonly [number, number, number],
  styles: BoxStyle[],
): Extra[] {
  return extras.map((e) => {
    if (e.kind !== 'box' || e.opacity !== undefined) return e;
    const s = matchBoxStyle(e.fill, background, styles);
    return s ? ({ ...e, fill: s.color.toUpperCase(), opacity: s.opacity } as BoxExtra) : e;
  });
}

export function loadBoxStyles(): BoxStyle[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
    if (!Array.isArray(raw)) return DEFAULT_BOX_STYLES;
    const list = raw.filter(
      (s): s is BoxStyle =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as BoxStyle).color === 'string' &&
        typeof (s as BoxStyle).opacity === 'number',
    );
    return withStyle(DEFAULT_BOX_STYLES, ...list.slice().reverse());
  } catch {
    return DEFAULT_BOX_STYLES;
  }
}

/** Newest first, no repeats, at most MAX. */
export function withStyle(list: BoxStyle[], ...added: BoxStyle[]): BoxStyle[] {
  let out = list;
  for (const s of added) {
    const same = (t: BoxStyle) =>
      t.color.toUpperCase() === s.color.toUpperCase() && Math.abs(t.opacity - s.opacity) < 0.005;
    out = [s, ...out.filter((t) => !same(t))].slice(0, MAX);
  }
  return out;
}

/**
 * Remember a see-through box style the person set, for the next screenshot. `replaces` is the
 * style remembered a moment ago for the same box (while a colour is being picked): it goes.
 */
export function rememberBoxStyle(style: BoxStyle, replaces?: BoxStyle): void {
  if (!(style.opacity > 0 && style.opacity < 1)) return;
  try {
    const kept = replaces
      ? loadBoxStyles().filter(
          (t) =>
            t.color.toUpperCase() !== replaces.color.toUpperCase() ||
            Math.abs(t.opacity - replaces.opacity) >= 0.005 ||
            DEFAULT_BOX_STYLES.some((d) => d.color === t.color && d.opacity === t.opacity),
        )
      : loadBoxStyles();
    const next = withStyle(kept, style);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: the default style still works */
  }
}
