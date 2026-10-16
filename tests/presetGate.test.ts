import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_PRESETS, LIGHT_ID, ORIGINAL_ID } from '@/lib/presets/builtins';
import { setCloudClient, takePending } from '@/lib/presets/cloud';
import type { Preset } from '@/lib/presets/types';
import { usePresetStore } from '@/store/presetStore';

const s = () => usePresetStore.getState();
const data: Record<string, string> = {};

const shared: Preset = {
  ...BUILT_IN_PRESETS[0]!,
  id: 'their-preset',
  name: 'Theirs',
  builtIn: true,
  community: { ownerName: 'Ada' },
};

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  setCloudClient(null); // the database is "configured" but nothing is reachable
  for (const k of Object.keys(data)) delete data[k];
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => {
        data[k] = v;
      },
      removeItem: (k: string) => {
        delete data[k];
      },
    },
  };
  usePresetStore.setState({
    presets: [...BUILT_IN_PRESETS, shared],
    activeId: LIGHT_ID,
    draft: null,
    hydrated: true,
    account: null,
    signInOpen: false,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  setCloudClient(undefined);
  delete (globalThis as { window?: unknown }).window;
});

describe('saving needs an account', () => {
  it('asks a signed-out visitor to sign in and keeps the preset for afterwards', () => {
    expect(s().newPreset()).toBeNull();
    expect(s().signInOpen).toBe(true);
    expect(s().presets.filter((p) => !p.builtIn)).toHaveLength(0);
    expect(takePending()?.name).toBe('New preset');
  });

  it('asks before saving edits, and keeps the edits on screen', () => {
    s().editDraft({ borderWidth: 3 });
    expect(s().saveDraft()).toBeNull();
    expect(s().signInOpen).toBe(true);
    expect(s().draft?.borderWidth).toBe(3);
  });

  it('asks before importing a backup', () => {
    expect(s().ensureSignedIn()).toBe(false);
    expect(s().signInOpen).toBe(true);
  });

  it('lets a signed-in account save', () => {
    usePresetStore.setState({ account: { id: 'me', email: null, name: 'Me' } });
    const created = s().newPreset();
    expect(created?.name).toBe('New preset');
    expect(s().signInOpen).toBe(false);
  });

  it('still lets anyone pick and look at presets', () => {
    s().setActive(ORIGINAL_ID);
    s().setActive('their-preset');
    expect(s().activeId).toBe('their-preset');
    expect(s().signInOpen).toBe(false);
  });
});

describe("other people's presets", () => {
  beforeEach(() => {
    usePresetStore.setState({ account: { id: 'me', email: null, name: 'Me' } });
    s().setActive('their-preset');
  });

  it('cannot be deleted', () => {
    expect(s().remove('their-preset')).toBe(false);
    expect(s().presets.some((p) => p.id === 'their-preset')).toBe(true);
  });

  it('are not changed by edits: saving makes a copy that belongs to the account', () => {
    s().editDraft({ borderWidth: 4 });
    const saved = s().saveDraft();
    expect(saved?.id).not.toBe('their-preset');
    expect(saved?.builtIn).toBe(false);
    expect(saved?.community).toBeUndefined();
    expect(s().presets.find((p) => p.id === 'their-preset')?.borderWidth).toBe(1);
  });

  it('can be duplicated into the account', () => {
    const copy = s().duplicate('their-preset');
    expect(copy?.builtIn).toBe(false);
    expect(copy?.community).toBeUndefined();
  });
});
