import type { BoxExtra, Extra, LineExtra, TextExtra } from '@/lib/detect/types';
import { fmt } from './format';

/** Font stack for labels. Figma replaces it with the nearest font it has. */
export const LABEL_FONT = 'Inter, Arial, Helvetica, sans-serif';

const pad = (n: number) => String(n).padStart(2, '0');

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The shapes a candle chart may carry besides candles, in drawing order within each kind. */
export function byKind(extras: Extra[]) {
  const sorted = (list: Extra[]) => [...list].sort((a, b) => key(a) - key(b));
  const key = (e: Extra) =>
    e.kind === 'line'
      ? e.y1 * 10000 + e.x1
      : e.kind === 'box'
        ? e.y * 10000 + e.x
        : e.y * 10000 + e.x;
  return {
    boxes: sorted(extras.filter((e) => e.kind === 'box')) as BoxExtra[],
    lines: sorted(extras.filter((e) => e.kind === 'line')) as LineExtra[],
    // labels with nothing in them have nothing to draw
    texts: sorted(extras.filter((e) => e.kind === 'text' && e.text.trim() !== '')) as TextExtra[],
  };
}

export function boxSvg(b: BoxExtra, index: number): string {
  return `    <rect id="Box ${pad(index + 1)}" x="${fmt(b.x)}" y="${fmt(b.y)}" width="${fmt(b.width)}" height="${fmt(b.height)}" fill="${b.fill}"/>`;
}

export function lineSvg(l: LineExtra, index: number): string {
  const dash = l.dash ? ` stroke-dasharray="${fmt(l.dash[0])} ${fmt(l.dash[1])}"` : '';
  return `    <line id="Line ${pad(index + 1)}" x1="${fmt(l.x1)}" y1="${fmt(l.y1)}" x2="${fmt(l.x2)}" y2="${fmt(l.y2)}" stroke="${l.color}" stroke-width="${fmt(l.width)}" stroke-linecap="butt"${dash}/>`;
}

export function textSvg(t: TextExtra, index: number): string {
  return `    <text id="Label ${pad(index + 1)}" x="${fmt(t.x)}" y="${fmt(t.y)}" font-family="${LABEL_FONT}" font-size="${fmt(t.size)}" fill="${t.color}">${escapeXml(t.text)}</text>`;
}

/** Boxes go behind the candles. */
export function boxesLayer(extras: Extra[]): string[] {
  const { boxes } = byKind(extras);
  if (boxes.length === 0) return [];
  return ['  <g id="Boxes">', ...boxes.map(boxSvg), '  </g>'];
}

/** Lines and labels go in front. */
export function frontLayers(extras: Extra[]): string[] {
  const { lines, texts } = byKind(extras);
  const out: string[] = [];
  if (lines.length > 0) out.push('  <g id="Lines">', ...lines.map(lineSvg), '  </g>');
  if (texts.length > 0) out.push('  <g id="Labels">', ...texts.map(textSvg), '  </g>');
  return out;
}
