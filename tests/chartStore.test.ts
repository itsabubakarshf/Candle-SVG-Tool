import { beforeEach, describe, expect, it } from 'vitest';
import type { Candle } from '@/lib/detect/types';
import { useChartStore } from '@/store/chartStore';

function make(id: string, centerX: number, patch: Partial<Candle> = {}): Candle {
  return {
    id,
    centerX,
    bodyLeft: centerX - 10,
    bodyRight: centerX + 10,
    bodyTop: 100,
    bodyBottom: 160,
    wickTop: 60,
    wickBottom: 200,
    type: 'bull',
    isDoji: false,
    confidence: 0.5,
    ...patch,
  };
}

const store = () => useChartStore.getState();
const byId = (id: string) => store().candles.find((c) => c.id === id)!;

beforeEach(() => {
  useChartStore.setState({
    image: null,
    status: 'done',
    candles: [make('a', 30), make('b', 60), make('c', 90)],
    past: [],
    future: [],
    selectedIds: [],
    activeHandle: null,
    lastClickX: null,
  });
});

describe('selection', () => {
  it('selects one, adds with shift, toggles off, and clears', () => {
    store().select('a', false);
    expect(store().selectedIds).toEqual(['a']);
    store().select('b', true);
    expect(store().selectedIds).toEqual(['a', 'b']);
    store().select('a', true);
    expect(store().selectedIds).toEqual(['b']);
    store().select('c', false);
    expect(store().selectedIds).toEqual(['c']);
    store().clearSelection();
    expect(store().selectedIds).toEqual([]);
  });
});

describe('AC-6: an edit changes only the selected candle', () => {
  it('flips one candle and leaves the others alone', () => {
    store().select('b', false);
    store().flipSelected();
    expect(byId('b').type).toBe('bear');
    expect(byId('a').type).toBe('bull');
    expect(byId('c').type).toBe('bull');
  });

  it('overrides one colour of one candle only', () => {
    store().select('a', false);
    store().setOverrideOfSelected('body', '#FF0000');
    expect(byId('a').colorOverride).toEqual({ body: '#FF0000' });
    expect(byId('b').colorOverride).toBeUndefined();
    store().resetOverrideOfSelected();
    expect(byId('a').colorOverride).toBeUndefined();
  });
});

describe('AC-7: undo restores the state before every edit type', () => {
  const edits: Array<[string, () => void]> = [
    ['flip', () => store().flipSelected()],
    ['set type', () => store().setTypeOfSelected('bear')],
    ['delete', () => store().deleteSelected()],
    ['colour override', () => store().setOverrideOfSelected('border', '#00FF00')],
    ['edge value', () => store().setEdgeValue('b', 'bodyTop', 120)],
    ['split', () => void store().splitSelected()],
  ];

  for (const [name, edit] of edits) {
    it(name, () => {
      store().select('b', false);
      const before = JSON.parse(JSON.stringify(store().candles));
      edit();
      expect(store().candles).not.toEqual(before);
      store().undo();
      expect(store().candles).toEqual(before);
      store().redo();
      expect(store().candles).not.toEqual(before);
    });
  }

  it('merge', () => {
    store().select('a', false);
    store().select('b', true);
    const before = JSON.parse(JSON.stringify(store().candles));
    expect(store().mergeSelected()).toBe(true);
    expect(store().candles.length).toBe(2);
    store().undo();
    expect(store().candles).toEqual(before);
  });

  it('a whole drag is one undo step, and an empty drag leaves no step', () => {
    store().beginEdit();
    store().dragEdge('b', 'bodyTop', 110);
    store().dragEdge('b', 'bodyTop', 115);
    store().dragEdge('b', 'bodyTop', 120);
    store().endEdit();
    expect(byId('b').bodyTop).toBe(120);
    expect(store().past.length).toBe(1);
    store().undo();
    expect(byId('b').bodyTop).toBe(100);

    store().beginEdit();
    store().endEdit(); // nothing moved
    expect(store().past.length).toBe(0);
  });

  it('keeps at least 50 steps', () => {
    for (let i = 0; i < 120; i++)
      store().setEdgeValue('a', i % 2 ? 'bodyTop' : 'bodyBottom', 100 + i);
    expect(store().past.length).toBeGreaterThanOrEqual(50);
    expect(store().past.length).toBeLessThanOrEqual(100);
  });

  it('a new edit after undo drops the redo steps', () => {
    store().select('a', false);
    store().flipSelected();
    store().undo();
    expect(store().future.length).toBe(1);
    store().flipSelected();
    expect(store().future.length).toBe(0);
  });

  it('undo with nothing to undo does nothing', () => {
    const before = store().candles;
    store().undo();
    store().redo();
    expect(store().candles).toBe(before);
  });
});

describe('split and merge', () => {
  it('splits at the clicked x and keeps candles in order', () => {
    store().select('b', false, 55);
    expect(store().splitSelected()).toBe(true);
    const xs = store().candles.map((c) => c.centerX);
    expect(xs).toEqual([...xs].sort((p, q) => p - q));
    expect(store().candles.length).toBe(4);
    expect(store().selectedIds.length).toBe(2);
    const [l, r] = store().candles.filter((c) => store().selectedIds.includes(c.id));
    expect(l!.bodyRight).toBe(55);
    expect(r!.bodyLeft).toBe(55);
  });

  it('refuses to merge candles that are not neighbours', () => {
    store().select('a', false);
    store().select('c', true);
    expect(store().mergeSelected()).toBe(false);
    expect(store().candles.length).toBe(3);
  });

  it('refuses to split with no single selection', () => {
    expect(store().splitSelected()).toBe(false);
    store().select('a', false);
    store().select('b', true);
    expect(store().splitSelected()).toBe(false);
  });
});

describe('colour override edits are coalesced', () => {
  it('dragging a colour picker is one undo step', () => {
    store().select('a', false);
    for (const hex of ['#111111', '#222222', '#333333']) store().setOverrideOfSelected('body', hex);
    expect(store().past.length).toBe(1);
    expect(byId('a').colorOverride).toEqual({ body: '#333333' });
    store().undo();
    expect(byId('a').colorOverride).toBeUndefined();
  });
});

describe('deleting', () => {
  it('removes the selection and clears it', () => {
    store().select('a', false);
    store().select('c', true);
    store().deleteSelected();
    expect(store().candles.map((c) => c.id)).toEqual(['b']);
    expect(store().selectedIds).toEqual([]);
  });
});
