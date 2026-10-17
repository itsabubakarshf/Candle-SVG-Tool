import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { parsePreset } from './storage';
import type { Preset } from './types';

/**
 * Shared presets in a Supabase table. Everyone can read and use every preset. Saving needs a
 * signed-in account (Google or an emailed link), and a preset can only be changed or deleted
 * by the account that made it; the database enforces that, not this code. Only presets are
 * stored, never screenshots. Everything here fails soft: if the service is missing, blocked or
 * offline the app keeps working with the presets in this browser.
 */

const TABLE = 'presets';

export interface Account {
  id: string;
  email: string | null;
  /** Shown to other people next to the presets this account shares. Null when unknown. */
  name: string | null;
}

let client: SupabaseClient | null | undefined;

export function cloudConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

function getClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  client =
    url && key && typeof window !== 'undefined'
      ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
      : null;
  return client;
}

/** The shared client (null when the database is not set up). */
export function getCloudClient(): SupabaseClient | null {
  return getClient();
}

/** Test hook: use a fake client (or null to switch the cloud off). */
export function setCloudClient(next: SupabaseClient | null | undefined): void {
  client = next;
}

export function accountOf(session: Session | null): Account | null {
  const user = session?.user;
  // An anonymous session is not an account: it cannot save.
  if (!user || user.is_anonymous) return null;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const raw = meta.full_name ?? meta.name;
  const name = typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 60) : null;
  return { id: user.id, email: user.email ?? null, name };
}

export async function currentAccount(): Promise<Account | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const { data } = await c.auth.getSession();
    return accountOf(data.session);
  } catch {
    return null;
  }
}

/** Calls back whenever the visitor signs in or out. Returns a function that stops listening. */
export function watchAccount(callback: (account: Account | null) => void): () => void {
  const c = getClient();
  if (!c) return () => {};
  const { data } = c.auth.onAuthStateChange((_event, session) => callback(accountOf(session)));
  return () => data.subscription.unsubscribe();
}

const returnUrl = () => (typeof window === 'undefined' ? undefined : window.location.origin);

/**
 * Opens Google's sign-in. The page leaves and comes back signed in. The address is checked
 * first: when Google is not switched on for the project the server answers with an error page,
 * and the visitor should see a message here instead of that page.
 */
export async function signInWithGoogle(): Promise<string | null> {
  const c = getClient();
  if (!c) return 'Sign-in is not available right now.';
  const unavailable = 'Google sign-in is not available yet. Use the email link instead.';
  try {
    const { data, error } = await c.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: returnUrl(), skipBrowserRedirect: true },
    });
    if (error || !data.url) return unavailable;
    try {
      const probe = await fetch(data.url, { redirect: 'manual' });
      // A working provider answers with a redirect to Google (opaque to the page).
      if (probe.type !== 'opaqueredirect' && !probe.ok) return unavailable;
    } catch {
      /* the check itself was blocked (CORS, offline): go ahead and let the browser try */
    }
    window.location.assign(data.url);
    return null;
  } catch {
    return 'Could not reach the sign-in service. Check your connection and try again.';
  }
}

/** Emails a one-time sign-in link. Returns an error message, or null when the email was sent. */
export async function signInWithEmail(email: string): Promise<string | null> {
  const c = getClient();
  if (!c) return 'Sign-in is not available right now.';
  try {
    const { error } = await c.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: returnUrl() },
    });
    if (!error) return null;
    return error.status === 429
      ? 'Too many emails sent. Wait a few minutes and try again.'
      : 'Could not send the email. Check the address and try again.';
  } catch {
    return 'Could not reach the sign-in service. Check your connection and try again.';
  }
}

export async function signOut(): Promise<void> {
  try {
    await getClient()?.auth.signOut();
  } catch {
    /* already signed out as far as this browser is concerned */
  }
}

interface Row {
  id: string;
  user_id: string;
  owner_name: string | null;
  data: unknown;
}

function toPreset(row: Row, mine: boolean): Preset | null {
  const parsed = parsePreset({ ...(row.data as object), id: row.id });
  if (!parsed) return null;
  return mine ? parsed : { ...parsed, builtIn: true, community: { ownerName: row.owner_name } };
}

/** Everything the signed-in account has saved (at most 100). Null when unreachable. */
export async function pullOwn(accountId: string): Promise<Preset[] | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const { data, error } = await c
      .from(TABLE)
      .select('id, user_id, owner_name, data')
      .eq('user_id', accountId)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (error || !data) return null;
    return (data as Row[]).flatMap((r) => toPreset(r, true) ?? []);
  } catch {
    return null;
  }
}

export type SharedSort = 'new' | 'name';
export const SHARED_PAGE = 40;

/** What the search box may send: letters, digits, spaces and a few quiet marks. */
export function cleanSearch(text: string): string {
  return text
    .replace(/[^\p{L}\p{N} ._'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

export interface SharedPage {
  presets: Preset[];
  /** How many rows came back (continue from here for the next page). */
  fetched: number;
  /** True when a full page came back, so there may be more. */
  more: boolean;
}

/**
 * One page of other people's presets, newest first or by name, optionally filtered by a name
 * or an author. Presets made by `accountId` are left out (they are listed as the account's own).
 * Null when unreachable.
 */
export async function pullShared(opts: {
  accountId: string | null;
  query?: string;
  sort?: SharedSort;
  offset?: number;
  limit?: number;
}): Promise<SharedPage | null> {
  const c = getClient();
  if (!c) return null;
  const limit = opts.limit ?? SHARED_PAGE;
  const offset = opts.offset ?? 0;
  try {
    let q = c.from(TABLE).select('id, user_id, owner_name, data');
    if (opts.accountId) q = q.neq('user_id', opts.accountId);
    const text = cleanSearch(opts.query ?? '');
    if (text) q = q.or(`name.ilike.%${text}%,owner_name.ilike.%${text}%`);
    q =
      opts.sort === 'name'
        ? q.order('name', { ascending: true })
        : q.order('updated_at', { ascending: false });
    const { data, error } = await q.range(offset, offset + limit - 1);
    if (error || !data) return null;
    const rows = data as Row[];
    return {
      presets: rows.flatMap((r) => toPreset(r, false) ?? []),
      fetched: rows.length,
      more: rows.length === limit,
    };
  } catch {
    return null;
  }
}

/** One preset by id (a shared one the person picked last time), or null. */
export async function pullPresetById(id: string, accountId: string | null): Promise<Preset | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const { data, error } = await c
      .from(TABLE)
      .select('id, user_id, owner_name, data')
      .eq('id', id)
      .limit(1);
    const row = (data as Row[] | null)?.[0];
    if (error || !row) return null;
    return toPreset(row, row.user_id === accountId);
  } catch {
    return null;
  }
}

/** Saves (adds or updates) the signed-in account's presets. False if it did not go through. */
export async function pushPresets(presets: Preset[], account: Account): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    if (presets.length === 0) return true;
    const rows = presets.map((p) => ({
      id: p.id,
      user_id: account.id,
      name: p.name,
      owner_name: account.name,
      data: { ...p, community: undefined },
      updated_at: new Date().toISOString(),
    }));
    const { error } = await c.from(TABLE).upsert(rows, { onConflict: 'user_id,id' });
    return !error;
  } catch {
    return false;
  }
}

export async function deleteCloudPreset(id: string, account: Account): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    const { error } = await c.from(TABLE).delete().eq('id', id).eq('user_id', account.id);
    return !error;
  } catch {
    return false;
  }
}

/** The signed-in account's own settings (what it has told us about its charts). */
export async function pullSettings(account: Account): Promise<Record<string, unknown> | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const { data, error } = await c
      .from('user_settings')
      .select('data')
      .eq('user_id', account.id)
      .maybeSingle();
    if (error) return null;
    const d = (data as { data?: unknown } | null)?.data;
    return typeof d === 'object' && d !== null && !Array.isArray(d)
      ? (d as Record<string, unknown>)
      : {};
  } catch {
    return null;
  }
}

export async function pushSettings(
  account: Account,
  data: Record<string, unknown>,
): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    const { error } = await c
      .from('user_settings')
      .upsert(
        { user_id: account.id, data, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    return !error;
  } catch {
    return false;
  }
}

const PENDING_KEY = 'candlesvg:pendingPreset';

/**
 * A preset waiting for sign-in. Google and email sign-in both leave the page, so the preset
 * the visitor just made is kept here and saved when they come back signed in.
 */
export function stashPending(preset: Preset): void {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(preset));
  } catch {
    /* storage blocked: the visitor will have to make the preset again */
  }
}

export function takePending(): Preset | null {
  try {
    const text = window.localStorage.getItem(PENDING_KEY);
    window.localStorage.removeItem(PENDING_KEY);
    return text ? parsePreset(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

/** Shared presets are added after the visitor's own; ones already in the list are skipped. */
export function mergeShared(local: Preset[], shared: Preset[]): Preset[] {
  const have = new Set(local.map((p) => p.id));
  return [...local, ...shared.filter((p) => !have.has(p.id))];
}
