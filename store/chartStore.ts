import { create } from 'zustand';
import { detectInWorker } from '@/lib/detect/client';
import {
  DEFAULT_SETTINGS,
  type Candle,
  type CandleColors,
  type DetectSettings,
  type DetectionResult,
} from '@/lib/detect/types';
import {
  flipType,
  mergeCandles,
  resetOverride,
  setColorOverride,
  setEdge,
  setType,
  sortByX,
  splitCandle,
  type EdgeKey,
} from '@/lib/edit/ops';
import type { LoadedImage } from '@/lib/image/loadImage';

export type HandleKey = 'bodyTop' | 'bodyBottom' | 'wickTop' | 'wickBottom';
export type DetectStatus = 'idle' | 'running' | 'done' | 'error';

/** Undo steps kept (the SRS asks for at least 50). */
const HISTORY_LIMIT = 100;
/** Edits of the same kind closer together than this share one undo step (colour dragging). */
const COALESCE_MS = 900;

interface ChartState {
  image: LoadedImage | null;
  status: DetectStatus;
  error: string | null;
  result: DetectionResult | null;
  settings: DetectSettings;
  candles: Candle[];
  past: Candle[][];
  future: Candle[][];
  selectedIds: string[];
  activeHandle: HandleKey | null;
  /** Source x of the last click on a candle; "Split here" cuts at this x. */
  lastClickX: number | null;

  setImage: (image: LoadedImage) => void;
  clear: () => void;
  setSettings: (patch: Partial<DetectSettings>) => void;
  runDetection: (opts?: { undoable?: boolean }) => Promise<void>;

  select: (id: string, additive: boolean, clickX?: number) => void;
  clearSelection: () => void;
  setActiveHandle: (h: HandleKey | null) => void;

  undo: () => void;
  redo: () => void;
  /** Start of a drag: remember the state so the whole drag undoes in one step. */
  beginEdit: () => void;
  /** End of a drag: drop the undo step again if nothing moved. */
  endEdit: () => void;
  dragEdge: (id: string, key: EdgeKey, value: number) => void;

  setEdgeValue: (id: string, key: EdgeKey, value: number | null) => void;
  setTypeOfSelected: (type: Candle['type']) => void;
  flipSelected: () => void;
  deleteSelected: () => void;
  setOverrideOfSelected: (key: keyof CandleColors, value: string | null) => void;
  resetOverrideOfSelected: () => void;
  splitSelected: () => boolean;
  mergeSelected: () => boolean;
}

let detectToken = 0;
let lastCoalesceKey = '';
let lastCoalesceAt = 0;

export const useChartStore = create<ChartState>((set, get) => {
  /** Applies an edit as one undo step. */
  const commit = (next: Candle[], coalesceKey?: string) => {
    const { candles, past } = get();
    const now = Date.now();
    const merge =
      coalesceKey !== undefined &&
      coalesceKey === lastCoalesceKey &&
      now - lastCoalesceAt < COALESCE_MS &&
      past.length > 0;
    lastCoalesceKey = coalesceKey ?? '';
    lastCoalesceAt = now;
    set({
      candles: next,
      past: merge ? past : [...past, candles].slice(-HISTORY_LIMIT),
      future: [],
    });
  };

  const mapSelected = (fn: (c: Candle) => Candle): Candle[] => {
    const ids = new Set(get().selectedIds);
    return get().candles.map((c) => (ids.has(c.id) ? fn(c) : c));
  };

  return {
    image: null,
    status: 'idle',
    error: null,
    result: null,
    settings: DEFAULT_SETTINGS,
    candles: [],
    past: [],
    future: [],
    selectedIds: [],
    activeHandle: null,
    lastClickX: null,

    setImage: (image) => {
      const previous = get().image;
      if (previous) URL.revokeObjectURL(previous.url);
      detectToken++;
      // Edits are cleared only when a new screenshot is loaded.
      set({
        image,
        status: 'idle',
        error: null,
        result: null,
        candles: [],
        past: [],
        future: [],
        selectedIds: [],
        activeHandle: null,
        lastClickX: null,
      });
      void get().runDetection();
    },

    clear: () => {
      const previous = get().image;
      if (previous) URL.revokeObjectURL(previous.url);
      detectToken++;
      set({
        image: null,
        status: 'idle',
        error: null,
        result: null,
        candles: [],
        past: [],
        future: [],
        selectedIds: [],
        activeHandle: null,
        lastClickX: null,
      });
    },

    setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

    runDetection: async (opts) => {
      const { image, settings } = get();
      if (!image) return;
      const token = ++detectToken;
      set({ status: 'running', error: null });
      try {
        const result = await detectInWorker(image.file, settings);
        if (token !== detectToken || get().image !== image) return; // a newer run took over
        if (result.candles.length === 0) {
          set({
            status: 'error',
            error:
              'No candles found. Crop tightly around the candles on a plain background, or lower the detection thresholds.',
            result,
          });
          return;
        }
        if (opts?.undoable) commit(result.candles);
        else set({ candles: result.candles, past: [], future: [] });
        set({ status: 'done', result, selectedIds: [], activeHandle: null });
      } catch (e) {
        if (token !== detectToken) return;
        set({ status: 'error', error: e instanceof Error ? e.message : 'Detection failed.' });
      }
    },

    select: (id, additive, clickX) => {
      const { selectedIds } = get();
      let next: string[];
      if (additive) {
        next = selectedIds.includes(id)
          ? selectedIds.filter((s) => s !== id)
          : [...selectedIds, id];
      } else {
        next = [id];
      }
      set({
        selectedIds: next,
        activeHandle: next.length === 1 && next[0] === selectedIds[0] ? get().activeHandle : null,
        lastClickX: clickX ?? get().lastClickX,
      });
    },
    clearSelection: () => set({ selectedIds: [], activeHandle: null }),
    setActiveHandle: (activeHandle) => set({ activeHandle }),

    undo: () => {
      const { past, future, candles, selectedIds } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      lastCoalesceKey = '';
      const ids = new Set(prev.map((c) => c.id));
      set({
        candles: prev,
        past: past.slice(0, -1),
        future: [candles, ...future].slice(0, HISTORY_LIMIT),
        selectedIds: selectedIds.filter((id) => ids.has(id)),
      });
    },
    redo: () => {
      const { past, future, candles, selectedIds } = get();
      const next = future[0];
      if (!next) return;
      lastCoalesceKey = '';
      const ids = new Set(next.map((c) => c.id));
      set({
        candles: next,
        past: [...past, candles].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        selectedIds: selectedIds.filter((id) => ids.has(id)),
      });
    },

    beginEdit: () => {
      lastCoalesceKey = '';
      const { candles, past } = get();
      set({ past: [...past, candles].slice(-HISTORY_LIMIT), future: [] });
    },
    endEdit: () => {
      const { candles, past } = get();
      if (past[past.length - 1] === candles) set({ past: past.slice(0, -1) });
    },
    dragEdge: (id, key, value) =>
      set((s) => ({ candles: s.candles.map((c) => (c.id === id ? setEdge(c, key, value) : c)) })),

    setEdgeValue: (id, key, value) =>
      commit(
        get().candles.map((c) => (c.id === id ? setEdge(c, key, value) : c)),
        `edge:${id}:${key}`,
      ),
    setTypeOfSelected: (type) => {
      if (get().selectedIds.length === 0) return;
      commit(mapSelected((c) => setType(c, type)));
    },
    flipSelected: () => {
      if (get().selectedIds.length === 0) return;
      commit(mapSelected(flipType));
    },
    deleteSelected: () => {
      const ids = new Set(get().selectedIds);
      if (ids.size === 0) return;
      commit(get().candles.filter((c) => !ids.has(c.id)));
      set({ selectedIds: [], activeHandle: null });
    },
    setOverrideOfSelected: (key, value) => {
      if (get().selectedIds.length === 0) return;
      commit(
        mapSelected((c) => setColorOverride(c, key, value)),
        `override:${key}`,
      );
    },
    resetOverrideOfSelected: () => {
      if (get().selectedIds.length === 0) return;
      commit(mapSelected(resetOverride));
    },

    splitSelected: () => {
      const { selectedIds, candles, lastClickX } = get();
      if (selectedIds.length !== 1) return false;
      const target = candles.find((c) => c.id === selectedIds[0]);
      if (!target) return false;
      const x =
        lastClickX !== null && lastClickX > target.bodyLeft && lastClickX < target.bodyRight
          ? lastClickX
          : target.centerX;
      const parts = splitCandle(target, x);
      if (!parts) return false;
      const next = sortByX(candles.flatMap((c) => (c.id === target.id ? parts : [c])));
      commit(next);
      set({ selectedIds: parts.map((p) => p.id), activeHandle: null });
      return true;
    },
    mergeSelected: () => {
      const { selectedIds, candles } = get();
      if (selectedIds.length !== 2) return false;
      const sorted = sortByX(candles);
      const idx = selectedIds
        .map((id) => sorted.findIndex((c) => c.id === id))
        .sort((a, b) => a - b);
      const [i, j] = idx;
      // Only adjacent candles can be merged.
      if (i === undefined || j === undefined || i < 0 || j !== i + 1) return false;
      const merged = mergeCandles(sorted[i] as Candle, sorted[j] as Candle);
      commit([...sorted.slice(0, i), merged, ...sorted.slice(j + 1)]);
      set({ selectedIds: [merged.id], activeHandle: null });
      return true;
    },
  };
});

/** Number of candles flagged for review (confidence below the threshold). */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;
