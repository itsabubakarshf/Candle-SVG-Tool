import { normalizeHex } from '@/lib/svg/hex';
import { BUILT_IN_PRESETS } from './builtins';
import { PRESET_SCHEMA_VERSION, type Preset } from './types';

export const PRESETS_KEY = 'candlesvg:presets:v1';
export const ACTIVE_KEY = 'candlesvg:activePreset';

/** The slice of the Storage API we use, so tests can pass a fake (or a broken) one. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // blocked or private mode
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function parseColors(v: unknown): Preset['bull'] | null {
  if (!isRecord(v)) return null;
  const body = typeof v.body === 'string' ? normalizeHex(v.body) : null;
  const border = typeof v.border === 'string' ? normalizeHex(v.border) : null;
  const wick = typeof v.wick === 'string' ? normalizeHex(v.wick) : null;
  return body && border && wick ? { body, border, wick } : null;
}

const clampWidth = (n: unknown, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(20, Math.max(0.1, n)) : fallback;

/**
 * Validates one stored or imported preset. Objects from older schema versions are migrated
 * here (there is only version 1 so far). Returns null when the object is unusable.
 * Imported presets never keep builtIn = true.
 */
export function parsePreset(raw: unknown): Preset | null {
  if (!isRecord(raw)) return null;
  const version = raw.schemaVersion === undefined ? 1 : raw.schemaVersion;
  if (version !== PRESET_SCHEMA_VERSION) return null; // newer than we understand
  const bull = parseColors(raw.bull);
  const bear = parseColors(raw.bear);
  if (!bull || !bear) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 60) : '';
  if (!name) return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : newPresetId();
  const background =
    raw.background === null || raw.background === undefined
      ? null
      : typeof raw.background === 'string'
        ? normalizeHex(raw.background)
        : null;
  return {
    schemaVersion: PRESET_SCHEMA_VERSION,
    id,
    name,
    builtIn: false,
    bull,
    bear,
    borderWidth: clampWidth(raw.borderWidth, 1),
    wickWidth: clampWidth(raw.wickWidth, 1),
    background,
  };
}

export function newPresetId(): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `preset-${rnd}`;
}

/** Saved user presets. Any problem (empty, corrupt, blocked storage) yields an empty list. */
export function loadUserPresets(storage: KeyValueStorage | null = browserStorage()): Preset[] {
  try {
    const text = storage?.getItem(PRESETS_KEY);
    if (!text) return [];
    const data: unknown = JSON.parse(text);
    const list = isRecord(data) ? data.presets : data;
    if (!Array.isArray(list)) return [];
    const builtInIds = new Set(BUILT_IN_PRESETS.map((p) => p.id));
    return list.map(parsePreset).filter((p): p is Preset => p !== null && !builtInIds.has(p.id));
  } catch {
    return [];
  }
}

export function saveUserPresets(
  presets: Preset[],
  storage: KeyValueStorage | null = browserStorage(),
): boolean {
  try {
    if (!storage) return false;
    const user = presets.filter((p) => !p.builtIn);
    storage.setItem(
      PRESETS_KEY,
      JSON.stringify({ schemaVersion: PRESET_SCHEMA_VERSION, presets: user }),
    );
    return true;
  } catch {
    return false;
  }
}

export function loadActiveId(storage: KeyValueStorage | null = browserStorage()): string | null {
  try {
    return storage?.getItem(ACTIVE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveActiveId(
  id: string,
  storage: KeyValueStorage | null = browserStorage(),
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(ACTIVE_KEY, id);
    return true;
  } catch {
    return false;
  }
}

/** JSON text for the backup file. */
export function exportPresetsJson(presets: Preset[]): string {
  const user = presets.filter((p) => !p.builtIn);
  return JSON.stringify({ schemaVersion: PRESET_SCHEMA_VERSION, presets: user }, null, 2);
}

/** Reads a backup file. Skips unusable entries and reports how many were skipped. */
export function parseImportedPresets(text: string): { presets: Preset[]; skipped: number } | null {
  try {
    const data: unknown = JSON.parse(text);
    const list = isRecord(data) ? data.presets : data;
    if (!Array.isArray(list)) return null;
    const presets = list.map(parsePreset).filter((p): p is Preset => p !== null);
    return { presets, skipped: list.length - presets.length };
  } catch {
    return null;
  }
}
