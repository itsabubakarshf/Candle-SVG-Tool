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
  mergeShared,
  cleanSearch,
  pullOwn,
  pullPresetById,
  pullShared,
  pushPresets,
  type SharedSort,
  signOut,
  stashPending,
  takePending,
  watchAccount,
  type Account,
} from '@/lib/presets/cloud';
import { toast } from 'sonner';
import { isAdmin } from '@/lib/admin/api';
import { clearPresetFromUrl, presetFromUrl } from '@/lib/presets/share';

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
  /** Browsing the presets other people shared: the search, the order, and what is loaded. */
  sharedQuery: string;
  sharedSort: SharedSort;
  sharedHasMore: boolean;
  sharedLoading: boolean;
  searchShared: (query: string) => void;
  setSharedSort: (sort: SharedSort) => void;
  loadMoreShared: () => void;
  /** True for the site owner: shows the dashboard button (the database checks it again). */
  isAdmin: boolean;
  /** The signed-in account. Saving a preset needs one whenever the online database is set up. */
  account: Account | null;
  /** The "sign in to save" dialog. */
  signInOpen: boolean;
  setSignInOpen: (open: boolean) => void;
  /** True if the visitor may save; otherwise opens the sign-in dialog. */
  ensureSignedIn: () => boolean;
  signOut: () => Promise<void>;

  /** Loads saved presets. Called once on the client; the server render uses the built-ins. */
  hydrate: () => void;
  setActive: (id: string) => void;
  editDraft: (patch: Partial<Preset>) => void;
  discardDraft: () => void;
  /** Saves the draft. A built-in is never changed: it is saved as a new preset instead. */
  saveDraft: () => Preset | null;
  /** The save actions return null when the visitor has to sign in first. */
  newPreset: () => Preset | null;
  /** Saves the colours measured from the screenshot as a preset of its own. */
  createFromSource: (style: SourceStyle) => Preset | null;
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
    pushSoon();
  };

  let pushTimer: ReturnType<typeof setTimeout> | undefined;
  const RETRY_AFTER = [3000, 8000, 20000, 60000];
  /** Saves the account's presets online. A failure is said out loud, and tried again. */
  const pushNow = async (account: Account, attempt: number): Promise<void> => {
    if (get().account?.id !== account.id) return;
    const ok = await pushPresets(
      get().presets.filter((p) => !p.builtIn),
      account,
    );
    if (ok) {
      set({ cloud: 'synced' });
      if (attempt > 0) toast.success('Saved to the shared library.');
      return;
    }
    set({ cloud: 'offline' });
    if (attempt === 0)
      toast.error("Couldn't reach the shared library.", {
        description: "Your preset is saved on this device. We'll keep trying.",
      });
    const wait = RETRY_AFTER[attempt];
    if (wait !== undefined) setTimeout(() => void pushNow(account, attempt + 1), wait);
  };
  const pushSoon = () => {
    const account = get().account;
    if (!cloudConfigured() || !account) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => void pushNow(account, 0), 600);
  };

  /** True if the visitor may save. Otherwise the sign-in dialog opens and the preset waits. */
  const maySave = (candidate?: Preset): boolean => {
    if (!cloudConfigured() || get().account) return true;
    if (candidate) stashPending(candidate);
    set({ signInOpen: true });
    return false;
  };

  let sharedToken = 0;
  let sharedOffset = 0;
  /** Loads one page of other people's presets. `reset` starts again (new search or order). */
  const loadShared = async (reset: boolean): Promise<void> => {
    if (!cloudConfigured()) return;
    const token = ++sharedToken;
    set({ sharedLoading: true });
    const page = await pullShared({
      accountId: get().account?.id ?? null,
      query: get().sharedQuery,
      sort: get().sharedSort,
      offset: reset ? 0 : sharedOffset,
    });
    if (token !== sharedToken) return; // a newer search took over
    if (!page) {
      set({ sharedLoading: false, cloud: 'offline' });
      return;
    }
    sharedOffset = (reset ? 0 : sharedOffset) + page.fetched;
    const { presets, activeId } = get();
    // A new search drops the old results, but never the preset in use.
    const keep = presets.filter((p) => !p.community || (!reset ? true : p.id === activeId));
    set({
      presets: mergeShared(keep, page.presets),
      sharedHasMore: page.more,
      sharedLoading: false,
    });
  };

  const syncFromCloud = async () => {
    if (!cloudConfigured()) return;
    set({ cloud: 'syncing' });
    const account = get().account;
    sharedOffset = 0;
    const [own, page] = await Promise.all([
      account ? pullOwn(account.id) : Promise.resolve([] as Preset[]),
      pullShared({
        accountId: account?.id ?? null,
        query: get().sharedQuery,
        sort: get().sharedSort,
      }),
    ]);
    if (own === null || page === null) {
      set({ cloud: 'offline' });
      return;
    }
    sharedOffset = page.fetched;
    const local = get().presets.filter((p) => !p.community);
    const active = get().presets.filter((p) => p.community && p.id === get().activeId);
    let presets = mergeShared(mergeShared(mergeShared(local, own), active), page.presets);
    // The preset picked last time may not be on the first page: fetch it by itself.
    const saved = loadActiveId();
    if (
      get().activeId === ORIGINAL_ID &&
      saved &&
      saved !== ORIGINAL_ID &&
      !presets.some((p) => p.id === saved)
    ) {
      const one = await pullPresetById(saved, account?.id ?? null);
      if (one) presets = mergeShared(presets, [one]);
    }
    const restore =
      get().activeId === ORIGINAL_ID && saved && presets.some((p) => p.id === saved) ? saved : null;
    set({ presets, sharedHasMore: page.more, ...(restore ? { activeId: restore } : {}) });
    saveUserPresets(presets);

    let ok = true;
    if (account) {
      // Presets made in this browser before signing in go up to the account.
      const online = new Set(own.map((p) => p.id));
      const missing = local.filter((p) => !p.builtIn && !online.has(p.id));
      if (missing.length > 0) {
        ok = await pushPresets(missing, account);
        if (!ok) {
          set({ cloud: 'offline' });
          void pushNow(account, 1);
        }
      }
      // A preset made just before signing in is saved now.
      const waiting = takePending();
      if (waiting) {
        const current = get().presets;
        const added: Preset = {
          ...waiting,
          id: newPresetId(),
          builtIn: false,
          community: undefined,
          name: uniqueName(waiting.name, current),
        };
        const next = [...current, added];
        set({ presets: next, activeId: added.id, draft: null });
        persist(next, added.id);
        toast.success(`Saved "${added.name}". Everyone can use it now.`);
      }
    }
    if (ok) set({ cloud: 'synced' });
  };

  let firstAccountEvent = true;
  const handleAccount = (next: Account | null) => {
    const prev = get().account;
    const unchanged = !firstAccountEvent && prev?.id === next?.id;
    firstAccountEvent = false;
    if (unchanged) {
      if (next) set({ account: next });
      return;
    }
    set({ account: next, isAdmin: false });
    if (next) void isAdmin().then((yes) => get().account?.id === next.id && set({ isAdmin: yes }));
    if (prev && !next) {
      // Signed out: this browser keeps none of that account's presets.
      const { presets, activeId } = get();
      const kept = presets.filter((p) => p.builtIn);
      const own = presets.some((p) => p.id === activeId && !p.builtIn);
      set({ presets: kept, activeId: own ? ORIGINAL_ID : activeId, draft: null });
      saveUserPresets(kept);
    }
    void syncFromCloud();
  };

  let watching = false;

  /** Opens a preset someone shared a link to. */
  const openShared = async (id: string) => {
    let found = id === ORIGINAL_ID ? null : get().presets.find((p) => p.id === id);
    if (!found && id !== ORIGINAL_ID && cloudConfigured()) {
      const one = await pullPresetById(id, get().account?.id ?? null);
      if (one) {
        set({ presets: mergeShared(get().presets, [one]) });
        found = get().presets.find((p) => p.id === id);
      }
    }
    clearPresetFromUrl();
    if (!found) {
      if (id !== ORIGINAL_ID) toast.error('That preset link no longer works.');
      return;
    }
    get().setActive(found.id);
    toast.success(
      found.community?.ownerName
        ? `Using "${found.name}" by ${found.community.ownerName}.`
        : `Using "${found.name}".`,
    );
  };

  return {
    presets: initialPresets(),
    // New visitors get their own chart's colours, not ours.
    activeId: ORIGINAL_ID,
    draft: null,
    hydrated: false,
    storageOk: true,
    cloud: 'off',
    sharedQuery: '',
    sharedSort: 'new',
    sharedHasMore: false,
    sharedLoading: false,
    searchShared: (query) => {
      const clean = cleanSearch(query);
      if (clean === get().sharedQuery) return;
      set({ sharedQuery: clean });
      void loadShared(true);
    },
    setSharedSort: (sort) => {
      if (sort === get().sharedSort) return;
      set({ sharedSort: sort });
      void loadShared(true);
    },
    loadMoreShared: () => {
      if (get().sharedHasMore && !get().sharedLoading) void loadShared(false);
    },
    account: null,
    isAdmin: false,
    signInOpen: false,
    setSignInOpen: (open) => set({ signInOpen: open }),
    ensureSignedIn: () => maySave(),
    signOut: async () => {
      await signOut();
    },

    hydrate: () => {
      const user = loadUserPresets();
      const presets = [...BUILT_IN_PRESETS, ...user];
      const saved = loadActiveId();
      const known = saved === ORIGINAL_ID || presets.some((p) => p.id === saved);
      const activeId = saved && known ? saved : ORIGINAL_ID;
      set({ presets, activeId, draft: null, hydrated: true });
      if (cloudConfigured() && !watching) {
        watching = true;
        watchAccount(handleAccount);
      }
      // A shared link: ?preset=<id> opens with that preset.
      const shared = presetFromUrl();
      if (shared) void openShared(shared);
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
        saved = { ...draft, id: newPresetId(), builtIn: false, community: undefined, name };
        next = [...presets, saved];
      } else {
        const name = uniqueName(draft.name.trim() || 'Preset', presets, draft.id);
        saved = { ...draft, name };
        next = presets.map((p) => (p.id === saved.id ? saved : p));
      }
      if (!maySave(saved)) return null;
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
        community: undefined,
      };
      if (!maySave(created)) return null;
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
      if (!maySave(created)) return null;
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
        community: undefined,
      };
      if (!maySave(copy)) return null;
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
      const account = get().account;
      if (cloudConfigured() && account) void deleteCloudPreset(id, account);
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
