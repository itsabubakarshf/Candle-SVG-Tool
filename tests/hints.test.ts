import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanHints,
  currentSourceStyle,
  currentUpGroup,
  matchHint,
  withHint,
  withUpGroup,
} from '@/lib/detect/hints';
import type { Candle, DetectionResult, Direction } from '@/lib/detect/types';
import { useChartStore } from '@/store/chartStore';
import { useHintStore } from '@/store/hintStore';

const col = (hex: string) => ({ body: hex, border: hex, wick: hex });
const direction = (a: string, b: string | null, upGroup: 0 | 1 = 0): Direction => ({
  groups: [
    { colours: col(a), count: 3 },
    { colours: b ? col(b) : null, count: b ? 3 : 0 },
  ],
  upGroup,
  source: 'prior',
  sure: false,
});
function candle(id: string, group: number, type: Candle['type']): Candle {
  return {
    id,
    group,
    type,
    centerX: 10,
    bodyLeft: 0,
    bodyRight: 20,
    bodyTop: 100,
    bodyBottom: 160,
    wickTop: 60,
    wickBottom: 200,
    isDoji: false,
    confidence: 1,
  };
}
const result = (d: Direction, candles: Candle[]): DetectionResult =>
  ({
    candles,
    direction: d,
    sourceStyle: {
      bull: col('#111111'),
      bear: col('#222222'),
      borderWidth: 1,
      wickWidth: 1,
      background: '#FFFFFF',
    },
  }) as unknown as DetectionResult;

describe('remembered answers', () => {
  it('recognises the same colours again, in either order, with a little drift', () => {
    const hints = withHint([], direction('#FFFFFF', '#E61E32'), 0);
    expect(hints).toEqual([{ up: '#FFFFFF', down: '#E61E32' }]);
    expect(matchHint(direction('#FFFFFF', '#E61E32'), hints)).toBe(0);
    expect(matchHint(direction('#E61E32', '#FFFFFF'), hints)).toBe(1); // groups the other way round
    expect(matchHint(direction('#FDFDFD', '#E82033'), hints)).toBe(0);
    expect(matchHint(direction('#2962FF', '#FF9800'), hints)).toBeNull();
  });

  it('a later answer for the same colours replaces the earlier one', () => {
    let hints = withHint([], direction('#2962FF', '#FF9800'), 0);
    hints = withHint(hints, direction('#2962FF', '#FF9800'), 1);
    expect(hints).toEqual([{ up: '#FF9800', down: '#2962FF' }]);
    expect(matchHint(direction('#2962FF', '#FF9800'), hints)).toBe(1);
  });

  it('does not remember a chart with only one colour, and drops malformed entries', () => {
    expect(withHint([], direction('#FFFFFF', null), 0)).toEqual([]);
    expect(cleanHints([{ up: '#ffffff', down: '#e61e32' }, { up: 'red' }, null, 5])).toEqual([
      { up: '#FFFFFF', down: '#E61E32' },
    ]);
    expect(cleanHints('nope')).toEqual([]);
  });
});

describe('which group is rising now', () => {
  it('sets every candle from its colour group', () => {
    const r = withUpGroup(
      result(direction('#FFFFFF', '#E61E32'), [
        candle('a', 0, 'bear'),
        candle('b', 1, 'bull'),
        candle('c', 0, 'bear'),
      ]),
      0,
      'remembered',
    );
    expect(r.candles.map((c) => c.type)).toEqual(['bull', 'bear', 'bull']);
    expect(r.direction).toMatchObject({ upGroup: 0, source: 'remembered', sure: true });
  });

  it('follows the candles themselves, so an undo is honoured', () => {
    const d = direction('#FFFFFF', '#E61E32', 0);
    expect(currentUpGroup([candle('a', 0, 'bull'), candle('b', 1, 'bear')], d)).toBe(0);
    expect(currentUpGroup([candle('a', 0, 'bear'), candle('b', 1, 'bull')], d)).toBe(1);
  });

  it('gives "Original colours" the colours of the group that is rising now', () => {
    const d = direction('#FFFFFF', '#E61E32', 0);
    const r = result(d, []);
    expect(
      currentSourceStyle(r, [candle('a', 0, 'bull'), candle('b', 1, 'bear')])?.bull?.body,
    ).toBe('#FFFFFF');
    const swapped = currentSourceStyle(r, [candle('a', 0, 'bear'), candle('b', 1, 'bull')]);
    expect(swapped?.bull?.body).toBe('#E61E32');
    expect(swapped?.bear?.body).toBe('#FFFFFF');
  });
});

describe('the store', () => {
  const data: Record<string, string> = {};
  beforeEach(() => {
    for (const k of Object.keys(data)) delete data[k];
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => data[k] ?? null,
        setItem: (k: string, v: string) => {
          data[k] = v;
        },
      },
    };
    useHintStore.setState({ hints: [], inAccount: false });
    const candles = [candle('a', 0, 'bull'), candle('b', 1, 'bear'), candle('c', 0, 'bull')];
    useChartStore.setState({
      status: 'done',
      candles,
      past: [],
      future: [],
      result: result(direction('#FFFFFF', '#E61E32', 0), candles),
    });
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('Swap flips every candle in one undo step and remembers the answer', () => {
    useChartStore.getState().swapDirection();
    expect(useChartStore.getState().candles.map((c) => c.type)).toEqual(['bear', 'bull', 'bear']);
    expect(useChartStore.getState().result?.direction).toMatchObject({
      upGroup: 1,
      source: 'user',
      sure: true,
    });
    expect(useHintStore.getState().hints).toEqual([{ up: '#E61E32', down: '#FFFFFF' }]);
    expect(JSON.parse(data['candlesvg:directionHints:v1'] ?? '[]')).toHaveLength(1);
    useChartStore.getState().undo();
    expect(useChartStore.getState().candles.map((c) => c.type)).toEqual(['bull', 'bear', 'bull']);
  });

  it('picking the colour that is already treated as rising only stops the question', () => {
    useChartStore.getState().chooseRising(0);
    expect(useChartStore.getState().candles.map((c) => c.type)).toEqual(['bull', 'bear', 'bull']);
    expect(useChartStore.getState().result?.direction).toMatchObject({
      source: 'user',
      sure: true,
    });
    expect(useHintStore.getState().recall(direction('#FFFFFF', '#E61E32'))).toBe(0);
  });

  it('picking the other colour swaps', () => {
    useChartStore.getState().chooseRising(1);
    expect(useChartStore.getState().candles.map((c) => c.type)).toEqual(['bear', 'bull', 'bear']);
  });

  it('answers are read back from storage on the next visit', () => {
    useChartStore.getState().chooseRising(1);
    useHintStore.setState({ hints: [] });
    useHintStore.getState().hydrate();
    expect(useHintStore.getState().recall(direction('#FFFFFF', '#E61E32'))).toBe(1);
  });
});
