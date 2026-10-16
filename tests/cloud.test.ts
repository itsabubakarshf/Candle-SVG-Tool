import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';
import { LIGHT_PRESET, MO_PRESET } from '@/lib/presets/builtins';
import {
  deleteCloudPreset,
  mergeRemote,
  pullPresets,
  pushPresets,
  setCloudClient,
} from '@/lib/presets/cloud';
import type { Preset } from '@/lib/presets/types';

const mine = (id: string, name: string): Preset => ({ ...LIGHT_PRESET, id, name, builtIn: false });

/** A tiny stand-in for the Supabase client: one table, anonymous sign-in. */
function fakeClient(opts: { signIn?: boolean; failQueries?: boolean } = {}) {
  const rows = new Map<string, { id: string; name: string; data: unknown }>();
  let signedIn = false;
  let signIns = 0;
  const err = { message: 'boom' };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: signedIn ? {} : null } }),
      signInAnonymously: async () => {
        signIns++;
        if (opts.signIn === false) return { data: { session: null }, error: err };
        signedIn = true;
        return { data: { session: {} }, error: null };
      },
    },
    from: () => ({
      select: async () =>
        opts.failQueries ? { data: null, error: err } : { data: [...rows.values()], error: null },
      upsert: async (list: { id: string; name: string; data: unknown }[]) => {
        if (opts.failQueries) return { error: err };
        for (const r of list) rows.set(r.id, r);
        return { error: null };
      },
      delete: () => ({
        eq: async (_col: string, id: string) => {
          rows.delete(id);
          return { error: null };
        },
      }),
    }),
  };
  return { client: client as unknown as SupabaseClient, rows, signIns: () => signIns };
}

afterEach(() => setCloudClient(undefined));

describe('online presets', () => {
  it('does nothing when the cloud is switched off', async () => {
    setCloudClient(null);
    expect(await pullPresets()).toBeNull();
    expect(await pushPresets([mine('a', 'A')])).toBe(false);
    expect(await deleteCloudPreset('a')).toBe(false);
  });

  it('signs in anonymously once, saves, reads back and deletes', async () => {
    const f = fakeClient();
    setCloudClient(f.client);
    expect(await pushPresets([mine('a', 'A'), mine('b', 'B')])).toBe(true);
    expect(await pullPresets()).toHaveLength(2);
    expect(f.signIns()).toBe(1);
    expect(await deleteCloudPreset('a')).toBe(true);
    expect((await pullPresets())?.map((p) => p.id)).toEqual(['b']);
  });

  it('fails soft when sign-in is refused or queries fail', async () => {
    setCloudClient(fakeClient({ signIn: false }).client);
    expect(await pullPresets()).toBeNull();
    expect(await pushPresets([mine('a', 'A')])).toBe(false);
    setCloudClient(fakeClient({ failQueries: true }).client);
    expect(await pullPresets()).toBeNull();
    expect(await pushPresets([mine('a', 'A')])).toBe(false);
  });

  it('ignores stored rows that are not valid presets', async () => {
    const f = fakeClient();
    f.rows.set('x', { id: 'x', name: 'X', data: { nonsense: true } });
    setCloudClient(f.client);
    expect(await pullPresets()).toEqual([]);
  });

  it("merges: adds missing online presets and keeps this browser's copy of shared ones", () => {
    const local = [LIGHT_PRESET, MO_PRESET, mine('a', 'A local')];
    const remote = [mine('a', 'A online'), mine('c', 'C'), mine('d', 'a local')];
    const merged = mergeRemote(local, remote);
    expect(merged.map((p) => p.id)).toEqual([LIGHT_PRESET.id, MO_PRESET.id, 'a', 'c']);
    expect(merged.find((p) => p.id === 'a')?.name).toBe('A local');
  });
});
