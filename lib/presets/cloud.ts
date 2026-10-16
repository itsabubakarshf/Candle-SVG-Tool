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

/** Opens Google's sign-in. The page leaves and comes back signed in. */
export async function signInWithGoogle(): Promise<string | null> {
  const c = getClient();
  if (!c) return 'Sign-in is not available right now.';
  try {
    const { error } = await c.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: returnUrl() },
    });
    return error ? 'Google sign-in is not available yet. Try the email link instead.' : null;
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

/** Every shared preset. Another account's are marked `community`. Null when unreachable. */
export async function pullPresets(accountId: string | null): Promise<Preset[] | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const { data, error } = await c.from(TABLE).select('id, user_id, owner_name, data');
    if (error || !data) return null;
    const out: Preset[] = [];
    const rows = data as {
      id: string;
      user_id: string;
      owner_name: string | null;
      data: unknown;
    }[];
    for (const row of rows) {
      const parsed = parsePreset({ ...(row.data as object), id: row.id });
      if (!parsed) continue;
      out.push(
        row.user_id === accountId
          ? parsed
          : { ...parsed, builtIn: true, community: { ownerName: row.owner_name } },
      );
    }
    return out;
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
