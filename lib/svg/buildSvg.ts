import type { Candle, Extra } from '@/lib/detect/types';
import type { Preset } from '@/lib/presets/types';
import { boxesLayer, frontLayers } from './extras';
import { fmt } from './format';
import { candleShape } from './geometry';

export interface SvgSize {
  width: number;
  height: number;
}

export interface BuildSvgOptions {
  /** Add a rect named "Background". Uses the preset's background colour, else white. */
  background?: boolean;
  /** Lines, boxes and labels found next to the candles. */
  extras?: Extra[];
}

export { fmt };

/**
 * Figma-ready SVG: plain shapes, inline attributes, named layers. No <style>, classes,
 * transforms, filters or vector-effect. Pure function: no DOM.
 */
export function buildSvg(
  candles: Candle[],
  preset: Preset,
  size: SvgSize,
  options: BuildSvgOptions = {},
): string {
  const w = fmt(size.width);
  const h = fmt(size.height);
  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
  ];
  if (options.background) {
    lines.push(
      `  <rect id="Background" x="0" y="0" width="${w}" height="${h}" fill="${preset.background ?? '#FFFFFF'}"/>`,
    );
  }
  const extras = options.extras ?? [];
  lines.push(...boxesLayer(extras));
  const ordered = [...candles].sort((a, b) => a.centerX - b.centerX);
  ordered.forEach((candle, i) => {
    const s = candleShape(candle, i, preset);
    lines.push(`  <g id="${s.name}">`);
    for (const wick of s.wicks) {
      lines.push(
        `    <line id="${wick.id}" x1="${fmt(wick.x)}" y1="${fmt(wick.y1)}" x2="${fmt(wick.x)}" y2="${fmt(wick.y2)}" stroke="${wick.stroke}" stroke-width="${fmt(wick.strokeWidth)}" stroke-linecap="butt"/>`,
      );
    }
    const b = s.body;
    const paint = b.bar
      ? `fill="${b.fill}"`
      : `fill="${b.fill}" stroke="${b.stroke}" stroke-width="${fmt(b.strokeWidth)}"`;
    lines.push(
      `    <rect id="Body" x="${fmt(b.x)}" y="${fmt(b.y)}" width="${fmt(b.width)}" height="${fmt(b.height)}" ${paint}/>`,
    );
    lines.push('  </g>');
  });
  lines.push(...frontLayers(extras));
  lines.push('</svg>');
  return lines.join('\n');
}
