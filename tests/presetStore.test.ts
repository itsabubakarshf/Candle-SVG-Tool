import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACTIVE_KEY, PRESETS_KEY, loadUserPresets } from '@/lib/presets/storage';
import { DARK_ID, LIGHT_ID, BUILT_IN_PRESETS } from '@/lib/presets/builtins';
import { selectActivePreset, usePresetStore } from '@/store/presetStore';

const data: Record<string, string> = {};
const fake = {
  getItem: (k: string) => data[k] ?? null,
  setItem: (k: string, v: string) => {
    data[k] = v;
  },
};

const s = () => usePresetStore.getState();

/** A fresh page: the store starts from its defaults, but saved data stays in the browser. */
function reload() {
  usePresetStore.setState({
    presets: [...BUILT_IN_PRESETS],
    activeId: LIGHT_ID,
    draft: null,
    hydrated: false,
    storageOk: true,
  });
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { localStorage: fake };
  for (const k of Object.keys(data)) delete data[k];
  reload();
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('preset store', () => {
  it('starts with both built-ins and Light active', () => {
    expect(s().presets.map((p) => p.name)).toEqual(['Light', 'Dark']);
    expect(selectActivePreset(s()).id).toBe(LIGHT_ID);
  });

  it('shows draft edits live without saving them', () => {
    s().editDraft({ borderWidth: 3 });
    expect(selectActivePreset(s()).borderWidth).toBe(3);
    expect(data[PRESETS_KEY]).toBeUndefined();
    s().discardDraft();
    expect(selectActivePreset(s()).borderWidth).toBe(1);
  });

  it('never changes a built-in: saving edits makes a copy', () => {
    s().editDraft({ bull: { body: '#112233', border: '#112233', wick: '#112233' } });
    const saved = s().saveDraft()!;
    expect(saved.builtIn).toBe(false);
    expect(saved.id).not.toBe(LIGHT_ID);
    expect(saved.name).toBe('Light copy');
    expect(s().presets.find((p) => p.id === LIGHT_ID)!.bull.body).toBe('#FFFFFF');
    expect(s().activeId).toBe(saved.id);
  });

  it('a built-in saved under a new name keeps that name; Dark becomes "Dark copy"', () => {
    s().setActive(DARK_ID);
    s().editDraft({ borderWidth: 2 });
    expect(s().saveDraft()!.name).toBe('Dark copy');
    s().setActive(LIGHT_ID);
    s().editDraft({ name: 'Mine' });
    expect(s().saveDraft()!.name).toBe('Mine');
  });

  it('creates, duplicates, renames and deletes user presets', () => {
    const created = s().newPreset();
    expect(created.name).toBe('New preset');
    const dup = s().duplicate(created.id)!;
    expect(dup.name).toBe('New preset copy');
    s().editDraft({ name: 'Renamed' });
    expect(s().saveDraft()!.name).toBe('Renamed');
    expect(s().remove(dup.id)).toBe(true);
    expect(s().presets.some((p) => p.id === dup.id)).toBe(false);
  });

  it('cannot delete built-in presets', () => {
    expect(s().remove(LIGHT_ID)).toBe(false);
    expect(s().remove(DARK_ID)).toBe(false);
    expect(s().presets.length).toBe(2);
  });

  it('keeps names unique', () => {
    const a = s().newPreset();
    const b = s().newPreset();
    expect(a.name).not.toBe(b.name);
  });

  it('deleting the active preset falls back to Light', () => {
    const p = s().newPreset();
    expect(s().activeId).toBe(p.id);
    s().remove(p.id);
    expect(s().activeId).toBe(LIGHT_ID);
  });
});

describe('AC-5: saved presets and the active preset survive a reload', () => {
  it('restores a custom preset and keeps it active', () => {
    s().editDraft({ name: 'Mine', borderWidth: 2 });
    const saved = s().saveDraft()!;
    expect(data[ACTIVE_KEY]).toBe(saved.id);

    reload(); // simulate a fresh page: store starts from defaults
    expect(s().activeId).toBe(LIGHT_ID);
    s().hydrate();
    expect(s().activeId).toBe(saved.id);
    expect(selectActivePreset(s()).name).toBe('Mine');
    expect(selectActivePreset(s()).borderWidth).toBe(2);
    expect(s().presets.length).toBe(3);
  });

  it('remembers switching to a built-in too', () => {
    s().setActive(DARK_ID);
    reload();
    s().hydrate();
    expect(s().activeId).toBe(DARK_ID);
  });

  it('loads the built-ins when storage is empty, corrupt or missing', () => {
    data[PRESETS_KEY] = '{{{';
    data[ACTIVE_KEY] = 'does-not-exist';
    s().hydrate();
    expect(s().presets.length).toBe(2);
    expect(s().activeId).toBe(LIGHT_ID);
    delete (globalThis as { window?: unknown }).window;
    expect(() => s().hydrate()).not.toThrow();
  });

  it('flags when the browser refuses to save', () => {
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota');
        },
      },
    };
    s().newPreset();
    expect(s().storageOk).toBe(false);
  });
});

describe('import and export (FR-14)', () => {
  it('exports only user presets and imports them back', () => {
    s().editDraft({ name: 'Backup me' });
    s().saveDraft();
    const json = s().exportJson();
    expect(JSON.parse(json).presets.length).toBe(1);

    for (const k of Object.keys(data)) delete data[k];
    reload();
    const result = s().importJson(json, () => 'overwrite');
    expect(result).toEqual({ added: 1, overwritten: 0, skipped: 0 });
    expect(s().presets.some((p) => p.name === 'Backup me')).toBe(true);
    expect(loadUserPresets(fake).length).toBe(1);
  });

  it('asks before overwriting a preset with the same name', () => {
    s().editDraft({ name: 'Same', borderWidth: 2 });
    s().saveDraft();
    const json = s().exportJson();
    s().editDraft({ borderWidth: 5 });
    s().saveDraft();

    const asked: string[] = [];
    s().importJson(json, (name) => {
      asked.push(name);
      return 'skip';
    });
    expect(asked).toEqual(['Same']);
    expect(s().presets.find((p) => p.name === 'Same')!.borderWidth).toBe(5); // skipped

    s().importJson(json, () => 'overwrite');
    expect(s().presets.find((p) => p.name === 'Same')!.borderWidth).toBe(2);

    s().importJson(json, () => 'keep-both');
    expect(s().presets.filter((p) => p.name.startsWith('Same')).length).toBe(2);
  });

  it('rejects files that are not preset backups', () => {
    expect(s().importJson('nope', () => 'skip')).toBeNull();
    expect(s().importJson('{"x":1}', () => 'skip')).toBeNull();
  });
});
