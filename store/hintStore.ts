import { create } from 'zustand';
import { cleanHints, matchHint, withHint, type DirectionHint } from '@/lib/detect/hints';
import type { Direction } from '@/lib/detect/types';
import { cloudConfigured, pullSettings, pushSettings, type Account } from '@/lib/presets/cloud';

const KEY = 'candlesvg:directionHints:v1';

function load(): DirectionHint[] {
  try {
    const text = window.localStorage.getItem(KEY);
    return text ? cleanHints(JSON.parse(text)) : [];
  } catch {
    return [];
  }
}
function save(hints: DirectionHint[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(hints));
  } catch {
    /* storage blocked: it is remembered until the page closes */
  }
}

interface HintState {
  /** What the person has said about their charts' colours (rising / falling). */
  hints: DirectionHint[];
  /** True when the hints are also kept in the signed-in account. */
  inAccount: boolean;
  hydrate: () => void;
  /** A signed-in account's saved answers are merged in; signing out stops saving there. */
  setAccount: (account: Account | null) => Promise<void>;
  /** Which group is rising according to what was remembered. Null when nothing fits. */
  recall: (direction: Direction | undefined) => 0 | 1 | null;
  remember: (direction: Direction, upGroup: 0 | 1) => void;
}

let account: Account | null = null;

export const useHintStore = create<HintState>((set, get) => ({
  hints: [],
  inAccount: false,

  hydrate: () => set({ hints: load() }),

  setAccount: async (next) => {
    account = next;
    if (!next || !cloudConfigured()) {
      set({ inAccount: false });
      return;
    }
    const saved = await pullSettings(next);
    if (account?.id !== next.id) return; // signed out or switched while waiting
    if (saved === null) return; // unreachable: keep going with what this browser has
    const merged = cleanHints([...cleanHints(saved.directionHints), ...get().hints]);
    // dedupe: later entries win for the same pair of colours
    let hints: DirectionHint[] = [];
    for (const h of merged) {
      hints = withHint(
        hints,
        {
          groups: [
            { colours: { body: h.up, border: h.up, wick: h.up }, count: 1 },
            { colours: { body: h.down, border: h.down, wick: h.down }, count: 1 },
          ],
          upGroup: 0,
          source: 'user',
          sure: true,
        },
        0,
      );
    }
    set({ hints, inAccount: true });
    save(hints);
    void pushSettings(next, { ...saved, directionHints: hints });
  },

  recall: (direction) => matchHint(direction, get().hints),

  remember: (direction, upGroup) => {
    const hints = withHint(get().hints, direction, upGroup);
    if (hints === get().hints) return;
    set({ hints });
    save(hints);
    const a = account;
    if (a && cloudConfigured()) {
      void pullSettings(a).then((saved) =>
        pushSettings(a, { ...(saved ?? {}), directionHints: hints }),
      );
    }
  },
}));
