import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIGHT_PRESET, MO_PRESET } from '@/lib/presets/builtins';
import {
  accountOf,
  deleteCloudPreset,
  mergeShared,
  pullPresets,
  pushPresets,
  setCloudClient,
  stashPending,
  takePending,
  type Account,
} from '@/lib/presets/cloud';
import type { Preset } from '@/lib/presets/types';

const mine = (id: string, name: string): Preset => ({ ...LIGHT_PRESET, id, name, builtIn: false });
const me: Account = { id: 'user-me', email: 'me@example.com', name: 'Me' };

interface Row {
  id: string;
  user_id: string;
  name: string;
  owner_name: string | null;
  data: unknown;
}

/** A tiny stand-in for the Supabase client: one table, rows from several accounts. */
function fakeClient(opts: { failQueries?: boolean } = {}) {
  const rows: Row[] = [];
  const err = { message: 'boom' };
  const client = {
    from: () => ({
      select: async () =>
        opts.failQueries ? { data: null, error: err } : { data: [...rows], error: null },
      upsert: async (list: Row[]) => {
        if (opts.failQueries) return { error: err };
        for (const r of list) {
          const at = rows.findIndex((x) => x.id === r.id && x.user_id === r.user_id);
          if (at >= 0) rows[at] = r;
          else rows.push(r);
        }
        return { error: null };
      },
      delete: () => ({
        eq: (_c1: string, id: string) => ({
          eq: async (_c2: string, userId: string) => {
            const at = rows.findIndex((x) => x.id === id && x.user_id === userId);
            if (at >= 0) rows.splice(at, 1);
            return { error: null };
          },
        }),
      }),
    }),
  };
  return { client: client as unknown as SupabaseClient, rows };
}

afterEach(() => setCloudClient(undefined));

describe('accounts', () => {
  const session = (user: object) => ({ user }) as unknown as Session;

  it('is no account without a session or for an anonymous one', () => {
    expect(accountOf(null)).toBeNull();
    expect(accountOf(session({ id: 'a', is_anonymous: true }))).toBeNull();
  });

  it('reads the display name from the sign-in provider, never from the email', () => {
    const g = accountOf(
      session({ id: 'g', email: 'x@y.z', user_metadata: { full_name: ' Ada Lovelace ' } }),
    );
    expect(g).toEqual({ id: 'g', email: 'x@y.z', name: 'Ada Lovelace' });
    expect(accountOf(session({ id: 'e', email: 'x@y.z' }))?.name).toBeNull();
  });
});

describe('shared presets online', () => {
  it('does nothing when the database is switched off', async () => {
    setCloudClient(null);
    expect(await pullPresets(null)).toBeNull();
    expect(await pushPresets([mine('a', 'A')], me)).toBe(false);
    expect(await deleteCloudPreset('a', me)).toBe(false);
  });

  it('saves under the account, and other people see them as shared, read-only presets', async () => {
    const f = fakeClient();
    setCloudClient(f.client);
    expect(await pushPresets([mine('a', 'A'), mine('b', 'B')], me)).toBe(true);
    expect(f.rows.every((r) => r.user_id === me.id && r.owner_name === 'Me')).toBe(true);

    const own = await pullPresets(me.id);
    expect(own?.map((p) => [p.id, p.builtIn, p.community])).toEqual([
      ['a', false, undefined],
      ['b', false, undefined],
    ]);

    const visitor = await pullPresets(null);
    expect(visitor).toHaveLength(2);
    expect(visitor?.every((p) => p.builtIn && p.community?.ownerName === 'Me')).toBe(true);
  });

  it("only deletes the account's own row", async () => {
    const f = fakeClient();
    setCloudClient(f.client);
    await pushPresets([mine('a', 'A')], me);
    await pushPresets([mine('a', 'A')], { id: 'other', email: null, name: null });
    expect(await deleteCloudPreset('a', me)).toBe(true);
    expect(f.rows.map((r) => r.user_id)).toEqual(['other']);
  });

  it('fails soft when queries fail', async () => {
    setCloudClient(fakeClient({ failQueries: true }).client);
    expect(await pullPresets(me.id)).toBeNull();
    expect(await pushPresets([mine('a', 'A')], me)).toBe(false);
  });

  it('ignores stored rows that are not valid presets', async () => {
    const f = fakeClient();
    f.rows.push({ id: 'x', user_id: 'u', name: 'X', owner_name: null, data: { nonsense: true } });
    setCloudClient(f.client);
    expect(await pullPresets(null)).toEqual([]);
  });

  it("adds shared presets after the visitor's own and skips ids already in the list", () => {
    const local = [LIGHT_PRESET, MO_PRESET, mine('a', 'A local')];
    const merged = mergeShared(local, [mine('a', 'A online'), mine('c', 'C')]);
    expect(merged.map((p) => p.id)).toEqual([LIGHT_PRESET.id, MO_PRESET.id, 'a', 'c']);
    expect(merged.find((p) => p.id === 'a')?.name).toBe('A local');
  });
});

describe('a preset waiting for sign-in', () => {
  const data: Record<string, string> = {};
  beforeEach(() => {
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
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('is kept across the sign-in redirect and handed over once', () => {
    stashPending(mine('p', 'Waiting'));
    expect(takePending()?.name).toBe('Waiting');
    expect(takePending()).toBeNull();
  });
});
