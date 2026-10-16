import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIGHT_PRESET, MO_PRESET } from '@/lib/presets/builtins';
import {
  accountOf,
  deleteCloudPreset,
  mergeShared,
  cleanSearch,
  pullOwn,
  pullPresetById,
  pullShared,
  pullSettings,
  pushSettings,
  pushPresets,
  setCloudClient,
  signInWithGoogle,
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

/** A small stand-in for the Supabase client: one table, rows from several accounts. */
function fakeClient(opts: { failQueries?: boolean } = {}) {
  const rows: Row[] = [];
  const err = { message: 'boom' };
  const client = {
    from: () => {
      type Filter = (r: Row) => boolean;
      const filters: Filter[] = [];
      let order: { col: 'name' | 'updated_at'; asc: boolean } | null = null;
      let from = 0;
      let to = Infinity;
      const run = () => {
        if (opts.failQueries) return { data: null, error: err };
        let out = rows.filter((r) => filters.every((f) => f(r)));
        if (order) {
          const { col, asc } = order;
          out = [...out].sort((x, y) => {
            const a = String(x[col === 'name' ? 'name' : 'id']);
            const b = String(y[col === 'name' ? 'name' : 'id']);
            return asc ? a.localeCompare(b) : b.localeCompare(a);
          });
        }
        return { data: out.slice(from, to + 1), error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (col: keyof Row, v: string) => (filters.push((r) => r[col] === v), q),
        neq: (col: keyof Row, v: string) => (filters.push((r) => r[col] !== v), q),
        or: (expr: string) => {
          const m = /name\.ilike\.%(.*)%,owner_name/.exec(expr);
          const text = (m?.[1] ?? '').toLowerCase();
          filters.push(
            (r) =>
              r.name.toLowerCase().includes(text) ||
              (r.owner_name ?? '').toLowerCase().includes(text),
          );
          return q;
        },
        order: (col: 'name' | 'updated_at', o: { ascending: boolean }) => (
          (order = { col, asc: o.ascending }),
          q
        ),
        limit: (n: number) => ((to = n - 1), q),
        range: (a: number, b: number) => ((from = a), (to = b), q),
        then: (resolve: (v: unknown) => void) => resolve(run()),
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
      };
      return q;
    },
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
    expect(await pullOwn(me.id)).toBeNull();
    expect(await pullShared({ accountId: null })).toBeNull();
    expect(await pullPresetById('a', null)).toBeNull();
    expect(await pushPresets([mine('a', 'A')], me)).toBe(false);
    expect(await deleteCloudPreset('a', me)).toBe(false);
  });

  it('saves under the account, and other people see them as shared, read-only presets', async () => {
    const f = fakeClient();
    setCloudClient(f.client);
    expect(await pushPresets([mine('a', 'A'), mine('b', 'B')], me)).toBe(true);
    expect(f.rows.every((r) => r.user_id === me.id && r.owner_name === 'Me')).toBe(true);

    const own = await pullOwn(me.id);
    expect(own?.map((p) => [p.id, p.builtIn, p.community]).sort()).toEqual([
      ['a', false, undefined],
      ['b', false, undefined],
    ]);

    const visitor = await pullShared({ accountId: null });
    expect(visitor?.presets).toHaveLength(2);
    expect(visitor?.presets.every((p) => p.builtIn && p.community?.ownerName === 'Me')).toBe(true);
    // the account's own presets are not listed again as someone else's
    expect((await pullShared({ accountId: me.id }))?.presets).toHaveLength(0);
  });

  it('browses the shared presets one page at a time, and searches by name or author', async () => {
    const f = fakeClient();
    setCloudClient(f.client);
    const ada = { id: 'ada', email: null, name: 'Ada' };
    const bo = { id: 'bo', email: null, name: 'Bo' };
    await pushPresets(
      Array.from({ length: 5 }, (_, i) => mine(`ada-${i}`, `Neon ${i}`)),
      ada,
    );
    await pushPresets([mine('bo-1', 'Mono'), mine('bo-2', 'Pastel')], bo);

    const first = await pullShared({ accountId: me.id, limit: 3 });
    expect(first).toMatchObject({ fetched: 3, more: true });
    const next = await pullShared({ accountId: me.id, limit: 3, offset: first?.fetched });
    expect(next?.fetched).toBe(3);
    const last = await pullShared({ accountId: me.id, limit: 3, offset: 6 });
    expect(last).toMatchObject({ fetched: 1, more: false });

    expect((await pullShared({ accountId: me.id, query: 'neon' }))?.presets).toHaveLength(5);
    expect(
      (await pullShared({ accountId: me.id, query: 'bo' }))?.presets.map((p) => p.id).sort(),
    ).toEqual(['bo-1', 'bo-2']);
    const byName = await pullShared({ accountId: me.id, sort: 'name' });
    expect(byName?.presets.map((p) => p.name)).toEqual(
      [...(byName?.presets ?? [])].map((p) => p.name).sort((a, b) => a.localeCompare(b)),
    );
  });

  it('finds one shared preset by id', async () => {
    const f = fakeClient();
    setCloudClient(f.client);
    await pushPresets([mine('x1', 'Picked')], { id: 'ada', email: null, name: 'Ada' });
    const one = await pullPresetById('x1', me.id);
    expect(one?.name).toBe('Picked');
    expect(one?.community?.ownerName).toBe('Ada');
    expect(await pullPresetById('missing', me.id)).toBeNull();
  });

  it('keeps only quiet characters in a search', () => {
    expect(cleanSearch('  neon,(x)%_ "q"  ')).toBe('neon x _ q');
    expect(cleanSearch('a'.repeat(100))).toHaveLength(40);
    expect(cleanSearch('Ünïcode name')).toBe('Ünïcode name');
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
    expect(await pullOwn(me.id)).toBeNull();
    expect(await pullShared({ accountId: null })).toBeNull();
    expect(await pushPresets([mine('a', 'A')], me)).toBe(false);
  });

  it('ignores stored rows that are not valid presets', async () => {
    const f = fakeClient();
    f.rows.push({ id: 'x', user_id: 'u', name: 'X', owner_name: null, data: { nonsense: true } });
    setCloudClient(f.client);
    expect((await pullShared({ accountId: null }))?.presets).toEqual([]);
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

describe('Google sign-in', () => {
  const oauth = (url: string | null, error: object | null = null) =>
    ({
      auth: { signInWithOAuth: async () => ({ data: { url }, error }) },
    }) as unknown as SupabaseClient;
  let assigned: string | null;
  beforeEach(() => {
    assigned = null;
    vi.stubGlobal('window', {
      location: {
        origin: 'https://app.test',
        assign: (u: string) => {
          assigned = u;
        },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the visitor to Google when the provider answers with a redirect', async () => {
    setCloudClient(oauth('https://db.test/auth/v1/authorize?provider=google'));
    vi.stubGlobal('fetch', async () => ({ type: 'opaqueredirect', ok: false }));
    expect(await signInWithGoogle()).toBeNull();
    expect(assigned).toContain('provider=google');
  });

  it('shows a message, and does not leave the page, when Google is not switched on', async () => {
    setCloudClient(oauth('https://db.test/auth/v1/authorize?provider=google'));
    vi.stubGlobal('fetch', async () => ({ type: 'cors', ok: false, status: 400 }));
    expect(await signInWithGoogle()).toMatch(/not available yet/);
    expect(assigned).toBeNull();
  });

  it('still tries when the check itself cannot run', async () => {
    setCloudClient(oauth('https://db.test/auth/v1/authorize?provider=google'));
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('blocked');
    });
    expect(await signInWithGoogle()).toBeNull();
    expect(assigned).not.toBeNull();
  });

  it('reports a failed request for the sign-in address', async () => {
    setCloudClient(oauth(null, { message: 'nope' }));
    expect(await signInWithGoogle()).toMatch(/not available yet/);
  });
});

describe('account settings', () => {
  const settingsClient = (row: unknown, fail = false) => {
    const saved: unknown[] = [];
    const client = {
      from: (table: string) => {
        expect(table).toBe('user_settings');
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                fail ? { data: null, error: { message: 'x' } } : { data: row, error: null },
            }),
          }),
          upsert: async (r: unknown) => {
            saved.push(r);
            return { error: fail ? { message: 'x' } : null };
          },
        };
      },
    } as unknown as SupabaseClient;
    return { client, saved };
  };

  it('reads and saves what the account has told us', async () => {
    const f = settingsClient({ data: { directionHints: [1] } });
    setCloudClient(f.client);
    expect(await pullSettings(me)).toEqual({ directionHints: [1] });
    expect(await pushSettings(me, { directionHints: [2] })).toBe(true);
    expect(f.saved[0]).toMatchObject({ user_id: me.id, data: { directionHints: [2] } });
  });

  it('is empty for a new account and null when unreachable', async () => {
    setCloudClient(settingsClient(null).client);
    expect(await pullSettings(me)).toEqual({});
    setCloudClient(settingsClient(null, true).client);
    expect(await pullSettings(me)).toBeNull();
    expect(await pushSettings(me, {})).toBe(false);
  });
});
