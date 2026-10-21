import { create } from 'zustand';
import { detectInWorker } from '@/lib/detect/client';
import {
  DEFAULT_SETTINGS,
  type Candle,
  type CandleColors,
  type DetectSettings,
  type DetectionResult,
  type Extra,
  type MarkerExtra,
  type TextExtra,
} from '@/lib/detect/types';
import { MARKER_DOT_RATIO } from '@/lib/svg/extras';
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
import { useHintStore } from '@/store/hintStore';
import { currentUpGroup, withUpGroup } from '@/lib/detect/hints';
import type { LoadedImage } from '@/lib/image/loadImage';

/** One undo step: the candles and the extras together. */
interface Snap {
  candles: Candle[];
  extras: Extra[];
}

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
  /** Lines, boxes and labels next to the candles. */
  extras: Extra[];
  past: Snap[];
  future: Snap[];
  selectedIds: string[];
  /** The selected line, box or label (never together with selected candles). */
  selectedExtraId: string | null;
  /** The label being typed into on the canvas. */
  editingExtraId: string | null;
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

  selectExtra: (id: string | null) => void;
  setEditingExtra: (id: string | null) => void;
  /** An edit that is one undo step (coalesced per field while typing or dragging a colour). */
  updateExtra: (id: string, patch: Partial<Extra>, coalesceKey?: string) => void;
  /** Live change while dragging: wrap in beginEdit / endEdit. */
  dragExtra: (id: string, patch: Partial<Extra>) => void;
  deleteExtra: (id: string) => void;
  addText: (x: number, y: number) => string;
  /** A dotted-circle sticker (PSP) centred at x, y. */
  addMarker: (x: number, y: number) => string;
  /** What OCR read. Not an undo step; never overwrites what the user typed. */
  applyReadText: (id: string, text: string | null) => void;

  undo: () => void;
  redo: () => void;
  /** Start of a drag: remember the state so the whole drag undoes in one step. */
  beginEdit: () => void;
  /** End of a drag: drop the undo step again if nothing moved. */
  endEdit: () => void;
  dragEdge: (id: string, key: EdgeKey, value: number) => void;

  setEdgeValue: (id: string, key: EdgeKey, value: number | null) => void;
  /** Swaps which colour means rising and which falling, for the whole chart. One undo step. */
  swapDirection: () => void;
  /** Which colour group is rising, as the person says. Remembered for next time. */
  chooseRising: (group: 0 | 1) => void;
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
  const commit = (next: Candle[], coalesceKey?: string) =>
    commitAll({ candles: next }, coalesceKey);

  const commitAll = (patch: Partial<Snap>, coalesceKey?: string) => {
    const { candles, extras, past } = get();
    const now = Date.now();
    const merge =
      coalesceKey !== undefined &&
      coalesceKey === lastCoalesceKey &&
      now - lastCoalesceAt < COALESCE_MS &&
      past.length > 0;
    lastCoalesceKey = coalesceKey ?? '';
    lastCoalesceAt = now;
    set({
      candles: patch.candles ?? candles,
      extras: patch.extras ?? extras,
      past: merge ? past : [...past, { candles, extras }].slice(-HISTORY_LIMIT),
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
    extras: [],
    past: [],
    future: [],
    selectedIds: [],
    selectedExtraId: null,
    editingExtraId: null,
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
        extras: [],
        past: [],
        future: [],
        selectedIds: [],
        selectedExtraId: null,
        editingExtraId: null,
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
        extras: [],
        past: [],
        future: [],
        selectedIds: [],
        selectedExtraId: null,
        editingExtraId: null,
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
        // JPEG and WebP can be lossy: tell detection so it does not trust 1 px line colours.
        const lossySource = image.file.type !== 'image/png';
        let result = await detectInWorker(image.file, { ...settings, lossySource });
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
        // A colour pair the person has already answered for is never asked about again.
        const recalled = useHintStore.getState().recall(result.direction);
        if (recalled !== null) result = withUpGroup(result, recalled, 'remembered');
        if (opts?.undoable) commitAll({ candles: result.candles, extras: result.extras });
        else set({ candles: result.candles, extras: result.extras, past: [], future: [] });
        set({
          status: 'done',
          result,
          selectedIds: [],
          selectedExtraId: null,
          editingExtraId: null,
          activeHandle: null,
        });
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
        selectedExtraId: null,
        editingExtraId: null,
        activeHandle: next.length === 1 && next[0] === selectedIds[0] ? get().activeHandle : null,
        lastClickX: clickX ?? get().lastClickX,
      });
    },
    clearSelection: () =>
      set({ selectedIds: [], selectedExtraId: null, editingExtraId: null, activeHandle: null }),
    setActiveHandle: (activeHandle) => set({ activeHandle }),

    undo: () => {
      const { past, future, candles, extras, selectedIds, selectedExtraId } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      lastCoalesceKey = '';
      const ids = new Set(prev.candles.map((c) => c.id));
      set({
        candles: prev.candles,
        extras: prev.extras,
        past: past.slice(0, -1),
        future: [{ candles, extras }, ...future].slice(0, HISTORY_LIMIT),
        selectedIds: selectedIds.filter((id) => ids.has(id)),
        selectedExtraId: prev.extras.some((e) => e.id === selectedExtraId) ? selectedExtraId : null,
        editingExtraId: null,
      });
    },
    redo: () => {
      const { past, future, candles, extras, selectedIds, selectedExtraId } = get();
      const next = future[0];
      if (!next) return;
      lastCoalesceKey = '';
      const ids = new Set(next.candles.map((c) => c.id));
      set({
        candles: next.candles,
        extras: next.extras,
        past: [...past, { candles, extras }].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        selectedIds: selectedIds.filter((id) => ids.has(id)),
        selectedExtraId: next.extras.some((e) => e.id === selectedExtraId) ? selectedExtraId : null,
        editingExtraId: null,
      });
    },

    beginEdit: () => {
      lastCoalesceKey = '';
      const { candles, extras, past } = get();
      set({ past: [...past, { candles, extras }].slice(-HISTORY_LIMIT), future: [] });
    },
    endEdit: () => {
      const { candles, extras, past } = get();
      const last = past[past.length - 1];
      if (last && last.candles === candles && last.extras === extras) {
        set({ past: past.slice(0, -1) });
      }
    },
    dragEdge: (id, key, value) =>
      set((s) => ({ candles: s.candles.map((c) => (c.id === id ? setEdge(c, key, value) : c)) })),

    setEdgeValue: (id, key, value) =>
      commit(
        get().candles.map((c) => (c.id === id ? setEdge(c, key, value) : c)),
        `edge:${id}:${key}`,
      ),
    swapDirection: () => {
      const { result, candles } = get();
      if (!result?.direction || candles.length === 0) return;
      const flipped = candles.map(
        (c) => ({ ...c, type: c.type === 'bull' ? 'bear' : 'bull' }) as Candle,
      );
      commit(flipped);
      const up = currentUpGroup(flipped, result.direction);
      set({
        result: {
          ...result,
          direction: { ...result.direction, upGroup: up, source: 'user', sure: true },
        },
      });
      useHintStore.getState().remember(result.direction, up);
    },

    chooseRising: (group) => {
      const { result, candles } = get();
      if (!result?.direction) return;
      if (currentUpGroup(candles, result.direction) !== group) {
        get().swapDirection();
        return;
      }
      // the guess was right: just stop asking
      set({
        result: { ...result, direction: { ...result.direction, source: 'user', sure: true } },
      });
      useHintStore.getState().remember(result.direction, group);
    },

    setTypeOfSelected: (type) => {
      if (get().selectedIds.length === 0) return;
      commit(mapSelected((c) => setType(c, type)));
    },
    flipSelected: () => {
      if (get().selectedIds.length === 0) return;
      commit(mapSelected(flipType));
    },
    deleteSelected: () => {
      const extraId = get().selectedExtraId;
      if (extraId !== null) {
        get().deleteExtra(extraId);
        return;
      }
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
    selectExtra: (id) =>
      set({
        selectedExtraId: id,
        selectedIds: [],
        activeHandle: null,
        editingExtraId: id === get().editingExtraId ? id : null,
      }),
    setEditingExtra: (id) =>
      set(
        id === null
          ? { editingExtraId: null }
          : { editingExtraId: id, selectedExtraId: id, selectedIds: [] },
      ),
    updateExtra: (id, patch, coalesceKey) =>
      commitAll(
        { extras: get().extras.map((e) => (e.id === id ? ({ ...e, ...patch } as Extra) : e)) },
        coalesceKey ?? `extra:${id}`,
      ),
    dragExtra: (id, patch) =>
      set((s) => ({
        extras: s.extras.map((e) => (e.id === id ? ({ ...e, ...patch } as Extra) : e)),
      })),
    deleteExtra: (id) => {
      commitAll({ extras: get().extras.filter((e) => e.id !== id) });
      set({ selectedExtraId: null, editingExtraId: null });
    },
    addText: (x, y) => {
      const used = new Set(get().extras.map((e) => e.id));
      let n = 1;
      while (used.has(`text-${String(n).padStart(2, '0')}`)) n++;
      const id = `text-${String(n).padStart(2, '0')}`;
      const size = 14;
      const color = readableOn(get().result?.background);
      const text: TextExtra = {
        kind: 'text',
        id,
        x,
        y: y + size / 2,
        text: 'Label',
        size,
        color,
        region: { x, y: y - size / 2, width: size * 3, height: size },
        unread: false,
      };
      commitAll({ extras: [...get().extras, text] });
      set({ selectedExtraId: id, selectedIds: [], activeHandle: null, editingExtraId: id });
      return id;
    },
    addMarker: (x, y) => {
      const used = new Set(get().extras.map((e) => e.id));
      let n = 1;
      while (used.has(`marker-${String(n).padStart(2, '0')}`)) n++;
      const id = `marker-${String(n).padStart(2, '0')}`;
      const marker: MarkerExtra = {
        kind: 'marker',
        id,
        cx: x,
        cy: y,
        r: 8,
        dotR: 8 * MARKER_DOT_RATIO,
        phase: -Math.PI / 4, // the empty place at the top right, as TradingView draws it
        color: readableOn(get().result?.background),
      };
      commitAll({ extras: [...get().extras, marker] });
      set({ selectedExtraId: id, selectedIds: [], activeHandle: null, editingExtraId: null });
      return id;
    },
    applyReadText: (id, text) =>
      set((s) => ({
        extras: s.extras.map((e) =>
          e.id === id && e.kind === 'text' && e.unread && e.text === ''
            ? { ...e, text: text ?? '', unread: text === null || text.trim() === '' }
            : e,
        ),
      })),

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

/** Black on a light chart, white on a dark one. */
function readableOn(background?: [number, number, number]): string {
  if (!background) return '#000000';
  const lum = 0.2126 * background[0] + 0.7152 * background[1] + 0.0722 * background[2];
  return lum > 140 ? '#000000' : '#FFFFFF';
}
