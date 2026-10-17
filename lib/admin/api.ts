import type { SupabaseClient } from '@supabase/supabase-js';
import { getCloudClient } from '@/lib/presets/cloud';

/**
 * The owner's dashboard. Every call is checked again inside the database (only accounts in
 * public.admins may run these functions), so hiding the button is a convenience, not the guard.
 */

export interface AdminUser {
  id: string;
  email: string | null;
  name: string | null;
  provider: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  blocked: boolean;
  presets: number;
}

export interface AdminPreset {
  id: string;
  user_id: string;
  name: string;
  owner_name: string | null;
  email: string | null;
  data: unknown;
  updated_at: string;
  hidden: boolean;
  blocked: boolean;
}

async function call<T>(
  fn: (c: SupabaseClient) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T | null> {
  const c = getCloudClient();
  if (!c) return null;
  try {
    const { data, error } = await fn(c);
    if (error) return null;
    return data as T;
  } catch {
    return null;
  }
}

export async function isAdmin(): Promise<boolean> {
  return (await call<boolean>((c) => c.rpc('is_admin'))) === true;
}

export const adminUsers = () => call<AdminUser[]>((c) => c.rpc('admin_users'));
export const adminPresets = () => call<AdminPreset[]>((c) => c.rpc('admin_presets'));

async function act(fn: string, args: Record<string, unknown>): Promise<boolean> {
  const c = getCloudClient();
  if (!c) return false;
  try {
    const { error } = await c.rpc(fn, args);
    return !error;
  } catch {
    return false;
  }
}

export const adminSetBlocked = (userId: string, block: boolean) =>
  act('admin_set_blocked', { target: userId, block });

export const adminSetPresetHidden = (owner: string, presetId: string, hide: boolean) =>
  act('admin_set_preset_hidden', { owner, preset_id: presetId, hide });
