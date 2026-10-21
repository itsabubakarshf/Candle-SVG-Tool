import type { Extra } from './types';

/** What the user sees when the chart has more than candles on it. One wording, used everywhere. */
export const UNCLEAN_TITLE = 'This chart is not clean';
export const UNCLEAN_HELP =
  'Only candles are allowed. Remove lines, boxes, labels, prices or watermarks, then upload again.';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 lines, 1 box and 1 label" */
export function describeExtras(extras: Extra[]): string {
  const n = (k: Extra['kind']) => extras.filter((e) => e.kind === k).length;
  const parts = [
    n('line') > 0 ? plural(n('line'), 'line', 'lines') : '',
    n('box') > 0 ? plural(n('box'), 'box', 'boxes') : '',
    n('text') > 0 ? plural(n('text'), 'label', 'labels') : '',
    n('marker') > 0 ? plural(n('marker'), 'sticker', 'stickers') : '',
  ].filter(Boolean);
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    : (parts[0] ?? '');
}
