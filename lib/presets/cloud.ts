import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parsePreset } from './storage';
import type { Preset } from './types';

/**
 * Optional online copy of the user's presets. Visitors are signed in anonymously (no email,
 * no password), so presets follow the browser without a login. Only presets are stored,
 * never screenshots. Everything here fails soft: if the service is missing, blocked or
 * offline the app keeps using the presets saved in this browser.
 */

const TABLE = 'presets';

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

async function session(c: SupabaseClient): Promise<boolean> {
  const { data } = await c.auth.getSession();
  if (data.session) return true;
  const { data: created, error } = await c.auth.signInAnonymously();
  return !error && Boolean(created.session);
}

/** The user's saved presets, or null when the cloud is unavailable. */
export async function pullPresets(): Promise<Preset[] | null> {
  const c = getClient();
  if (!c) return null;
  try {
    if (!(await session(c))) return null;
    const { data, error } = await c.from(TABLE).select('id, data');
    if (error || !data) return null;
    const out: Preset[] = [];
    for (const row of data as { id: string; data: unknown }[]) {
      const parsed = parsePreset({ ...(row.data as object), id: row.id });
      if (parsed) out.push(parsed);
    }
    return out;
  } catch {
    return null;
  }
}

/** Saves (adds or updates) the given presets. Returns false if it did not go through. */
export async function pushPresets(presets: Preset[]): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    if (!(await session(c))) return false;
    if (presets.length === 0) return true;
    const rows = presets.map((p) => ({
      id: p.id,
      name: p.name,
      data: p,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await c.from(TABLE).upsert(rows, { onConflict: 'user_id,id' });
    return !error;
  } catch {
    return false;
  }
}

export async function deleteCloudPreset(id: string): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    if (!(await session(c))) return false;
    const { error } = await c.from(TABLE).delete().eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

/** Presets that exist online but not here are added; ones in both keep this browser's copy. */
export function mergeRemote(local: Preset[], remote: Preset[]): Preset[] {
  const have = new Set(local.map((p) => p.id));
  const names = new Set(local.map((p) => p.name.toLowerCase()));
  const added = remote.filter((p) => !have.has(p.id) && !names.has(p.name.toLowerCase()));
  return [...local, ...added];
}
