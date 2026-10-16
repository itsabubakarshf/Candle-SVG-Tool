import { deltaE, rgbToLab } from '@/lib/color/lab';
import type { Candle, DetectionResult, Direction } from './types';

/**
 * What a person told us about their chart's colours: "this colour is rising, that one falling".
 * Remembered, so the same colours are never asked about twice.
 */
export interface DirectionHint {
  /** Body colour of the rising candles, "#RRGGBB". */
  up: string;
  /** Body colour of the falling candles, "#RRGGBB". */
  down: string;
}

const MAX_HINTS = 50;
/** Colours this close count as the same colour. */
const MATCH = 14;

function lab(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255);
}
const near = (a: string, b: string) => deltaE(lab(a), lab(b)) <= MATCH;
const valid = (h: unknown): h is string => typeof h === 'string' && /^#[0-9a-fA-F]{6}$/.test(h);

/** Keeps only well-formed hints (they come from storage and from the network). */
export function cleanHints(raw: unknown): DirectionHint[] {
  if (!Array.isArray(raw)) return [];
  const out: DirectionHint[] = [];
  for (const h of raw) {
    if (
      typeof h === 'object' &&
      h !== null &&
      valid((h as DirectionHint).up) &&
      valid((h as DirectionHint).down)
    )
      out.push({
        up: (h as DirectionHint).up.toUpperCase(),
        down: (h as DirectionHint).down.toUpperCase(),
      });
  }
  return out.slice(-MAX_HINTS);
}

/** Which group is rising, if a remembered answer fits this chart's colours. Else null. */
export function matchHint(direction: Direction | undefined, hints: DirectionHint[]): 0 | 1 | null {
  if (!direction) return null;
  const colours = direction.groups.map((g) => g.colours?.body ?? null);
  for (const h of [...hints].reverse()) {
    for (const up of [0, 1] as const) {
      const a = colours[up];
      const b = colours[1 - up];
      if (a && b && near(a, h.up) && near(b, h.down)) return up;
      // a chart with one colour only: it is whichever side matches
      if (a && !b && near(a, h.up)) return up;
      if (a && !b && near(a, h.down)) return (1 - up) as 0 | 1;
    }
  }
  return null;
}

/** Remembers an answer. Replaces an older answer for the same colours. */
export function withHint(
  hints: DirectionHint[],
  direction: Direction,
  upGroup: 0 | 1,
): DirectionHint[] {
  const up = direction.groups[upGroup]?.colours?.body;
  const down = direction.groups[1 - upGroup]?.colours?.body;
  if (!up || !down) return hints; // one colour alone is too little to remember
  const kept = hints.filter(
    (h) => !(near(up, h.up) && near(down, h.down)) && !(near(up, h.down) && near(down, h.up)),
  );
  return [...kept, { up: up.toUpperCase(), down: down.toUpperCase() }].slice(-MAX_HINTS);
}

/** Sets which group is rising: every candle takes its type from its colour group. */
export function withUpGroup(
  result: DetectionResult,
  upGroup: 0 | 1,
  source: NonNullable<DetectionResult['direction']>['source'],
): DetectionResult {
  if (!result.direction) return result;
  const candles: Candle[] = result.candles.map((c) =>
    c.group === undefined ? c : { ...c, type: c.group === upGroup ? 'bull' : 'bear' },
  );
  return { ...result, candles, direction: { ...result.direction, upGroup, source, sure: true } };
}

/** The group whose candles are mostly typed as rising right now (follows edits and undo). */
export function currentUpGroup(candles: Candle[], direction: Direction | undefined): 0 | 1 {
  const fallback = direction?.upGroup ?? 0;
  const share = [0, 1].map((g) => {
    const members = candles.filter((c) => c.group === g);
    return members.length === 0
      ? null
      : members.filter((c) => c.type === 'bull').length / members.length;
  });
  const [a, b] = share;
  if (a === null || a === undefined)
    return b === null || b === undefined ? fallback : b >= 0.5 ? 1 : 0;
  if (b === null || b === undefined) return a >= 0.5 ? 0 : 1;
  if (a === b) return fallback;
  return a > b ? 0 : 1;
}

/** "Original colours" for the chart as it stands now (follows a swap, an edit and undo). */
export function currentSourceStyle(
  result: DetectionResult | null,
  candles: Candle[],
): DetectionResult['sourceStyle'] | null {
  if (!result) return null;
  const d = result.direction;
  if (!d) return result.sourceStyle;
  const up = currentUpGroup(candles, d);
  return {
    ...result.sourceStyle,
    bull: d.groups[up]?.colours ?? null,
    bear: d.groups[1 - up]?.colours ?? null,
  };
}
