import type { BoxExtra, Extra, LineExtra, MarkerExtra, TextExtra } from '@/lib/detect/types';
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
      : e.kind === 'marker'
        ? e.cy * 10000 + e.cx
        : e.y * 10000 + e.x;
  return {
    boxes: sorted(extras.filter((e) => e.kind === 'box')) as BoxExtra[],
    lines: sorted(extras.filter((e) => e.kind === 'line')) as LineExtra[],
    // a label nobody has typed yet is drawn as it looked in the screenshot (traced), if known
    texts: sorted(
      extras.filter((e) => e.kind === 'text' && (e.text.trim() !== '' || e.trace)),
    ) as TextExtra[],
    markers: sorted(extras.filter((e) => e.kind === 'marker')) as MarkerExtra[],
  };
}

export function boxSvg(b: BoxExtra, index: number): string {
  return `    <rect id="Box ${pad(index + 1)}" x="${fmt(b.x)}" y="${fmt(b.y)}" width="${fmt(b.width)}" height="${fmt(b.height)}" fill="${b.fill}"/>`;
}

export function lineSvg(l: LineExtra, index: number): string {
  const dash = l.dash ? ` stroke-dasharray="${fmt(l.dash[0])} ${fmt(l.dash[1])}"` : '';
  return `    <line id="Line ${pad(index + 1)}" x1="${fmt(l.x1)}" y1="${fmt(l.y1)}" x2="${fmt(l.x2)}" y2="${fmt(l.y2)}" stroke="${l.color}" stroke-width="${fmt(l.width)}" stroke-linecap="butt"${dash}/>`;
}

/** font-weight only when it is not the normal one */
export function weightAttr(t: TextExtra): string {
  return t.weight && t.weight !== 400 ? ` font-weight="${t.weight}"` : '';
}

export function textSvg(t: TextExtra, index: number): string {
  if (t.text.trim() === '' && t.trace) {
    return `    <path id="Label ${pad(index + 1)} (not read)" d="${t.trace}" fill="${t.color}"/>`;
  }
  return `    <text id="Label ${pad(index + 1)}" x="${fmt(t.x)}" y="${fmt(t.y)}" font-family="${LABEL_FONT}" font-size="${fmt(t.size)}"${weightAttr(t)} fill="${t.color}">${escapeXml(t.text)}</text>`;
}

/** TradingView's dotted-circle sticker: 8 places round a circle, the one at `phase` empty. */
export const MARKER_PLACES = 8;
/** Its dot radius as a share of the ring radius, as TradingView draws it. */
export const MARKER_DOT_RATIO = 0.22;

/** Centres of the sticker's 7 dots, going round clockwise from the empty place. */
export function markerDots(m: MarkerExtra): { x: number; y: number }[] {
  return Array.from({ length: MARKER_PLACES - 1 }, (_, i) => {
    const a = m.phase + ((i + 1) * 2 * Math.PI) / MARKER_PLACES;
    return { x: m.cx + m.r * Math.cos(a), y: m.cy + m.r * Math.sin(a) };
  });
}

/** The whole ring as one path: every dot is a circle in the same shape, so it is one vector. */
export function markerPath(m: MarkerExtra): string {
  const r = Math.max(0.1, m.dotR);
  return markerDots(m)
    .map(
      ({ x, y }) =>
        `M${fmt(x - r)} ${fmt(y)}a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(2 * r)} 0a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-2 * r)} 0Z`,
    )
    .join('');
}

export function markerSvg(m: MarkerExtra, index: number): string {
  return `    <path id="Marker ${pad(index + 1)}" d="${markerPath(m)}" fill="${m.color}"/>`;
}

/** Boxes go behind the candles. */
export function boxesLayer(extras: Extra[]): string[] {
  const { boxes } = byKind(extras);
  if (boxes.length === 0) return [];
  return ['  <g id="Boxes">', ...boxes.map(boxSvg), '  </g>'];
}

/** Lines, markers and labels go in front. */
export function frontLayers(extras: Extra[]): string[] {
  const { lines, texts, markers } = byKind(extras);
  const out: string[] = [];
  if (lines.length > 0) out.push('  <g id="Lines">', ...lines.map(lineSvg), '  </g>');
  if (markers.length > 0) out.push('  <g id="Markers">', ...markers.map(markerSvg), '  </g>');
  if (texts.length > 0) out.push('  <g id="Labels">', ...texts.map(textSvg), '  </g>');
  return out;
}
