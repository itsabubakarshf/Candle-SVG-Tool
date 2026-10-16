import { create } from 'zustand';
import { BUILT_IN_PRESETS, LIGHT_PRESET, ORIGINAL_ID } from '@/lib/presets/builtins';
import type { SourceStyle } from '@/lib/detect/types';
import {
  exportPresetsJson,
  loadActiveId,
  loadUserPresets,
  newPresetId,
  parseImportedPresets,
  saveActiveId,
  saveUserPresets,
} from '@/lib/presets/storage';
import type { Preset } from '@/lib/presets/types';
import {
  cloudConfigured,
  deleteCloudPreset,
  mergeRemote,
  pullPresets,
  pushPresets,
} from '@/lib/presets/cloud';

export type CloudStatus = 'off' | 'syncing' | 'synced' | 'offline';

export type ImportConflictChoice = 'overwrite' | 'keep-both' | 'skip';

interface PresetState {
  /** Built-ins first, then the user's presets. */
  presets: Preset[];
  activeId: string;
  /** Unsaved edits to the active preset. They show live in the preview. */
  draft: Preset | null;
  hydrated: boolean;
  /** False if the browser refused to save (storage blocked). */
  storageOk: boolean;
  /** Online copy of the presets: off when not set up, offline when it could not be reached. */
  cloud: CloudStatus;

  /** Loads saved presets. Called once on the client; the server render uses the built-ins. */
  hydrate: () => void;
  setActive: (id: string) => void;
  editDraft: (patch: Partial<Preset>) => void;
  discardDraft: () => void;
  /** Saves the draft. A built-in is never changed: it is saved as a new preset instead. */
  saveDraft: () => Preset | null;
  newPreset: () => Preset;
  /** Saves the colours measured from the screenshot as a preset of its own. */
  createFromSource: (style: SourceStyle) => Preset;
  duplicate: (id: string) => Preset | null;
  remove: (id: string) => boolean;
  importJson: (
    text: string,
    onConflict: (name: string) => ImportConflictChoice,
  ) => { added: number; overwritten: number; skipped: number } | null;
  exportJson: () => string;
}

const initialPresets = (): Preset[] => [...BUILT_IN_PRESETS];

function uniqueName(base: string, presets: Preset[], ignoreId?: string): string {
  const taken = new Set(presets.filter((p) => p.id !== ignoreId).map((p) => p.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export const usePresetStore = create<PresetState>((set, get) => {
  const persist = (presets: Preset[], activeId: string) => {
    const a = saveUserPresets(presets);
    const b = saveActiveId(activeId);
    set({ storageOk: a && b });
    pushSoon(presets);
  };

  let pushTimer: ReturnType<typeof setTimeout> | undefined;
  const pushSoon = (presets: Preset[]) => {
    if (!cloudConfigured()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      const ok = await pushPresets(presets.filter((p) => !p.builtIn));
      set({ cloud: ok ? 'synced' : 'offline' });
    }, 600);
  };

  const syncFromCloud = async () => {
    if (!cloudConfigured()) return;
    set({ cloud: 'syncing' });
    const remote = await pullPresets();
    if (!remote) {
      set({ cloud: 'offline' });
      return;
    }
    const { presets } = get();
    const merged = mergeRemote(presets, remote);
    if (merged.length !== presets.length) {
      set({ presets: merged });
      saveUserPresets(merged);
    }
    // Presets made before the cloud was on (or while offline) go up now.
    const have = new Set(remote.map((p) => p.id));
    const missing = merged.filter((p) => !p.builtIn && !have.has(p.id));
    const ok = missing.length === 0 || (await pushPresets(missing));
    set({ cloud: ok ? 'synced' : 'offline' });
  };

  return {
    presets: initialPresets(),
    // New visitors get their own chart's colours, not ours.
    activeId: ORIGINAL_ID,
    draft: null,
    hydrated: false,
    storageOk: true,
    cloud: 'off',

    hydrate: () => {
      const user = loadUserPresets();
      const presets = [...BUILT_IN_PRESETS, ...user];
      const saved = loadActiveId();
      const known = saved === ORIGINAL_ID || presets.some((p) => p.id === saved);
      const activeId = saved && known ? saved : ORIGINAL_ID;
      set({ presets, activeId, draft: null, hydrated: true });
      void syncFromCloud();
    },

    setActive: (id) => {
      if (id !== ORIGINAL_ID && !get().presets.some((p) => p.id === id)) return;
      set({ activeId: id, draft: null });
      saveActiveId(id);
    },

    editDraft: (patch) => {
      const { presets, activeId, draft } = get();
      if (activeId === ORIGINAL_ID) return; // Original colours come from the image; copy them to a preset to edit
      const base = draft ?? presets.find((p) => p.id === activeId) ?? LIGHT_PRESET;
      set({ draft: { ...base, ...patch, id: base.id, builtIn: base.builtIn } });
    },
    discardDraft: () => set({ draft: null }),

    saveDraft: () => {
      const { draft, presets } = get();
      if (!draft) return null;
      let saved: Preset;
      let next: Preset[];
      if (draft.builtIn) {
        // A built-in saved without renaming becomes "<name> copy"; a renamed one keeps its name.
        const original = presets.find((p) => p.id === draft.id);
        const name = uniqueName(
          draft.name === original?.name ? `${draft.name} copy` : draft.name,
          presets,
        );
        saved = { ...draft, id: newPresetId(), builtIn: false, name };
        next = [...presets, saved];
      } else {
        const name = uniqueName(draft.name.trim() || 'Preset', presets, draft.id);
        saved = { ...draft, name };
        next = presets.map((p) => (p.id === saved.id ? saved : p));
      }
      set({ presets: next, activeId: saved.id, draft: null });
      persist(next, saved.id);
      return saved;
    },

    newPreset: () => {
      const { presets } = get();
      const base = presets.find((p) => p.id === get().activeId) ?? LIGHT_PRESET;
      const created: Preset = {
        ...base,
        id: newPresetId(),
        builtIn: false,
        name: uniqueName('New preset', presets),
      };
      const next = [...presets, created];
      set({ presets: next, activeId: created.id, draft: null });
      persist(next, created.id);
      return created;
    },

    createFromSource: (style) => {
      const { presets } = get();
      const created: Preset = {
        ...LIGHT_PRESET,
        id: newPresetId(),
        builtIn: false,
        name: uniqueName('From screenshot', presets),
        bull: style.bull ?? LIGHT_PRESET.bull,
        bear: style.bear ?? LIGHT_PRESET.bear,
        borderWidth: style.borderWidth,
        wickWidth: style.wickWidth,
        background: null,
      };
      const next = [...presets, created];
      set({ presets: next, activeId: created.id, draft: null });
      persist(next, created.id);
      return created;
    },

    duplicate: (id) => {
      const { presets } = get();
      const source = presets.find((p) => p.id === id);
      if (!source) return null;
      const copy: Preset = {
        ...source,
        bull: { ...source.bull },
        bear: { ...source.bear },
        id: newPresetId(),
        builtIn: false,
        name: uniqueName(`${source.name} copy`, presets),
      };
      const next = [...presets, copy];
      set({ presets: next, activeId: copy.id, draft: null });
      persist(next, copy.id);
      return copy;
    },

    remove: (id) => {
      const { presets, activeId } = get();
      const target = presets.find((p) => p.id === id);
      if (!target || target.builtIn) return false; // built-ins cannot be deleted
      const next = presets.filter((p) => p.id !== id);
      const nextActive = activeId === id ? ORIGINAL_ID : activeId;
      set({ presets: next, activeId: nextActive, draft: null });
      persist(next, nextActive);
      if (cloudConfigured()) void deleteCloudPreset(id);
      return true;
    },

    importJson: (text, onConflict) => {
      const parsed = parseImportedPresets(text);
      if (!parsed) return null;
      let presets = [...get().presets];
      let added = 0;
      let overwritten = 0;
      let skipped = parsed.skipped;
      for (const incoming of parsed.presets) {
        const clash = presets.find((p) => p.name.toLowerCase() === incoming.name.toLowerCase());
        if (!clash) {
          presets.push({
            ...incoming,
            id: presets.some((p) => p.id === incoming.id) ? newPresetId() : incoming.id,
          });
          added++;
          continue;
        }
        const choice = clash.builtIn ? 'keep-both' : onConflict(incoming.name);
        if (choice === 'skip') {
          skipped++;
        } else if (choice === 'overwrite') {
          presets = presets.map((p) => (p.id === clash.id ? { ...incoming, id: clash.id } : p));
          overwritten++;
        } else {
          presets.push({
            ...incoming,
            id: newPresetId(),
            name: uniqueName(incoming.name, presets),
          });
          added++;
        }
      }
      set({ presets, draft: null });
      persist(presets, get().activeId);
      return { added, overwritten, skipped };
    },

    exportJson: () => exportPresetsJson(get().presets),
  };
});

/** The preset to draw with: unsaved edits win so the preview is live. */
export function selectActivePreset(s: PresetState): Preset {
  return s.draft ?? s.presets.find((p) => p.id === s.activeId) ?? LIGHT_PRESET;
}
