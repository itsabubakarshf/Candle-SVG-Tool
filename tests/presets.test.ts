import { describe, expect, it } from 'vitest';
import { DARK_PRESET, LIGHT_PRESET, MO_PRESET, BUILT_IN_PRESETS } from '@/lib/presets/builtins';
import {
  ACTIVE_KEY,
  PRESETS_KEY,
  exportPresetsJson,
  loadActiveId,
  loadUserPresets,
  parseImportedPresets,
  parsePreset,
  saveActiveId,
  saveUserPresets,
  type KeyValueStorage,
} from '@/lib/presets/storage';
import type { Preset } from '@/lib/presets/types';

function fakeStorage(
  initial: Record<string, string> = {},
): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const broken: KeyValueStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

const custom: Preset = {
  ...LIGHT_PRESET,
  id: 'preset-1',
  name: 'Mine',
  builtIn: false,
  bull: { body: '#112233', border: '#445566', wick: '#778899' },
  borderWidth: 2,
  background: '#101010',
};

describe('built-in presets', () => {
  it('ship "Light" with the default values from the spec, and a dark mirror', () => {
    expect(LIGHT_PRESET.name).toBe('Light');
    expect(LIGHT_PRESET.bull).toEqual({ body: '#FFFFFF', border: '#2B2F36', wick: '#2B2F36' });
    expect(LIGHT_PRESET.bear).toEqual({ body: '#2B2F36', border: '#2B2F36', wick: '#2B2F36' });
    expect(LIGHT_PRESET.borderWidth).toBe(1);
    expect(LIGHT_PRESET.wickWidth).toBe(1);
    expect(LIGHT_PRESET.background).toBeNull();
    expect(DARK_PRESET.name).toBe('Dark');
    expect(BUILT_IN_PRESETS.every((p) => p.builtIn)).toBe(true);
  });

  it('has the Mo preset with its grey colours', () => {
    expect(MO_PRESET.name).toBe('Mo');
    expect(MO_PRESET.bull).toEqual({ body: '#F4F4F4', border: '#B0B0B0', wick: '#B0B0B0' });
    expect(MO_PRESET.bear).toEqual({ body: '#3A3A3A', border: '#4A4A4A', wick: '#4A4A4A' });
  });
});

describe('persistence (FR-13)', () => {
  it('saves and loads user presets and the active id', () => {
    const s = fakeStorage();
    expect(saveUserPresets([LIGHT_PRESET, custom], s)).toBe(true);
    expect(loadUserPresets(s)).toEqual([custom]); // built-ins are never stored
    expect(saveActiveId('preset-1', s)).toBe(true);
    expect(loadActiveId(s)).toBe('preset-1');
    expect(Object.keys(s.data).sort()).toEqual([ACTIVE_KEY, PRESETS_KEY].sort());
  });

  it('stores a schema version so later versions can migrate', () => {
    const s = fakeStorage();
    saveUserPresets([custom], s);
    const stored = JSON.parse(s.data[PRESETS_KEY] as string);
    expect(stored.schemaVersion).toBe(1);
    expect(stored.presets[0].schemaVersion).toBe(1);
  });

  it('falls back to nothing (so the built-ins load) when storage is empty, corrupt or blocked', () => {
    expect(loadUserPresets(fakeStorage())).toEqual([]);
    expect(loadUserPresets(fakeStorage({ [PRESETS_KEY]: '{not json' }))).toEqual([]);
    expect(loadUserPresets(fakeStorage({ [PRESETS_KEY]: '{"presets":"nope"}' }))).toEqual([]);
    expect(loadUserPresets(broken)).toEqual([]);
    expect(loadUserPresets(null)).toEqual([]);
    expect(loadActiveId(broken)).toBeNull();
    expect(saveUserPresets([custom], broken)).toBe(false);
    expect(saveActiveId('x', broken)).toBe(false);
    expect(saveUserPresets([custom], null)).toBe(false);
  });

  it('drops invalid entries and keeps the good ones', () => {
    const s = fakeStorage({
      [PRESETS_KEY]: JSON.stringify({ presets: [custom, { name: 'bad', bull: {} }, 42] }),
    });
    expect(loadUserPresets(s)).toEqual([custom]);
  });
});

describe('parsePreset', () => {
  it('normalises colours and clamps widths', () => {
    const p = parsePreset({
      ...custom,
      bull: { body: '#abc', border: 'def', wick: '#123456' },
      borderWidth: 500,
      wickWidth: -3,
    });
    expect(p?.bull.body).toBe('#AABBCC');
    expect(p?.bull.border).toBe('#DDEEFF');
    expect(p?.borderWidth).toBe(20);
    expect(p?.wickWidth).toBe(0.1);
  });
  it('never trusts builtIn from a file, and rejects unknown future versions', () => {
    expect(parsePreset({ ...custom, builtIn: true })?.builtIn).toBe(false);
    expect(parsePreset({ ...custom, schemaVersion: 99 })).toBeNull();
    expect(parsePreset({ ...custom, name: '   ' })).toBeNull();
    expect(parsePreset(null)).toBeNull();
  });
});

describe('backup file (FR-14)', () => {
  it('round-trips through export and import', () => {
    const text = exportPresetsJson([LIGHT_PRESET, custom]);
    const parsed = parseImportedPresets(text);
    expect(parsed?.presets).toEqual([custom]);
    expect(parsed?.skipped).toBe(0);
  });
  it('reports skipped entries and rejects non-preset files', () => {
    const parsed = parseImportedPresets(JSON.stringify({ presets: [custom, { nope: true }] }));
    expect(parsed?.presets.length).toBe(1);
    expect(parsed?.skipped).toBe(1);
    expect(parseImportedPresets('garbage')).toBeNull();
    expect(parseImportedPresets('{"a":1}')).toBeNull();
  });
});
