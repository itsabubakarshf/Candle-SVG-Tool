import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACTIVE_KEY, PRESETS_KEY, loadUserPresets } from '@/lib/presets/storage';
import { BUILT_IN_PRESETS, LIGHT_ID, MO_ID, ORIGINAL_ID } from '@/lib/presets/builtins';
import type { SourceStyle } from '@/lib/detect/types';
import { resolvePreset } from '@/store/resolvePreset';
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
    activeId: ORIGINAL_ID, // the real default
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
  beforeEach(() => s().setActive(LIGHT_ID)); // these tests edit the Abbi preset

  it('starts with both built-ins', () => {
    expect(s().presets.map((p) => p.name)).toEqual(['Abbi', 'Mo']);
    expect(selectActivePreset(s()).id).toBe(LIGHT_ID); // active in this block
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
    expect(saved.name).toBe('Abbi copy');
    expect(s().presets.find((p) => p.id === LIGHT_ID)!.bull.body).toBe('#FFFFFF');
    expect(s().activeId).toBe(saved.id);
  });

  it('a built-in saved under a new name keeps that name; Mo becomes "Mo copy"', () => {
    s().setActive(MO_ID);
    s().editDraft({ borderWidth: 2 });
    expect(s().saveDraft()!.name).toBe('Mo copy');
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
    expect(s().remove(MO_ID)).toBe(false);
    expect(s().presets.length).toBe(2);
  });

  it('keeps names unique', () => {
    const a = s().newPreset();
    const b = s().newPreset();
    expect(a.name).not.toBe(b.name);
  });

  it('deleting the active preset falls back to Original colours', () => {
    const p = s().newPreset();
    expect(s().activeId).toBe(p.id);
    s().remove(p.id);
    expect(s().activeId).toBe(ORIGINAL_ID);
  });
});

describe('AC-5: saved presets and the active preset survive a reload', () => {
  beforeEach(() => s().setActive(LIGHT_ID)); // start on an editable preset

  it('restores a custom preset and keeps it active', () => {
    s().editDraft({ name: 'Mine', borderWidth: 2 });
    const saved = s().saveDraft()!;
    expect(data[ACTIVE_KEY]).toBe(saved.id);

    reload(); // simulate a fresh page: store starts from defaults
    expect(s().activeId).toBe(ORIGINAL_ID);
    s().hydrate();
    expect(s().activeId).toBe(saved.id);
    expect(selectActivePreset(s()).name).toBe('Mine');
    expect(selectActivePreset(s()).borderWidth).toBe(2);
    expect(s().presets.length).toBe(3);
  });

  it('remembers switching to a built-in too', () => {
    s().setActive(MO_ID);
    reload();
    s().hydrate();
    expect(s().activeId).toBe(MO_ID);
  });

  it('loads the built-ins when storage is empty, corrupt or missing', () => {
    data[PRESETS_KEY] = '{{{';
    data[ACTIVE_KEY] = 'does-not-exist';
    s().hydrate();
    expect(s().presets.length).toBe(2);
    expect(s().activeId).toBe(ORIGINAL_ID);
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
  beforeEach(() => s().setActive(LIGHT_ID)); // start on an editable preset

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

const SOURCE: SourceStyle = {
  bull: { body: '#089981', border: '#089981', wick: '#089981' },
  bear: { body: '#F23645', border: '#393939', wick: '#F23645' },
  borderWidth: 1.25,
  wickWidth: 1,
  background: '#131722',
};

describe('Original colours (the default: keep the uploaded chart as it is)', () => {
  it('is the default for a first-time visitor, with or without saved data', () => {
    expect(s().activeId).toBe(ORIGINAL_ID);
    s().hydrate();
    expect(s().activeId).toBe(ORIGINAL_ID);
  });

  it('draws with the colours and widths found in the screenshot', () => {
    const p = resolvePreset(s(), SOURCE);
    expect(p.bull).toEqual(SOURCE.bull);
    expect(p.bear).toEqual(SOURCE.bear);
    expect(p.borderWidth).toBe(1.25);
    expect(p.wickWidth).toBe(1);
    expect(p.background).toBe('#131722');
  });

  it('uses the Abbi colours only for a type the screenshot does not have', () => {
    const p = resolvePreset(s(), { ...SOURCE, bear: null });
    expect(p.bull).toEqual(SOURCE.bull);
    expect(p.bear).toEqual(BUILT_IN_PRESETS[0]!.bear);
    expect(resolvePreset(s(), null).bull).toEqual(BUILT_IN_PRESETS[0]!.bull);
  });

  it('a chosen preset replaces it, and choosing Original again brings it back', () => {
    s().setActive(MO_ID);
    expect(resolvePreset(s(), SOURCE).id).toBe(MO_ID);
    s().setActive(ORIGINAL_ID);
    expect(resolvePreset(s(), SOURCE).id).toBe(ORIGINAL_ID);
  });

  it('remembers the choice across a reload, either way', () => {
    s().setActive(LIGHT_ID);
    reload();
    s().hydrate();
    expect(s().activeId).toBe(LIGHT_ID);
    s().setActive(ORIGINAL_ID);
    reload();
    s().hydrate();
    expect(s().activeId).toBe(ORIGINAL_ID);
  });

  it('cannot be edited in place: edits would be lost, so copy it to a preset first', () => {
    s().editDraft({ borderWidth: 9 });
    expect(s().draft).toBeNull();
  });

  it('can be saved as a preset of its own, which then becomes active', () => {
    const saved = s().createFromSource(SOURCE);
    expect(saved.builtIn).toBe(false);
    expect(saved.name).toBe('From screenshot');
    expect(saved.bear).toEqual(SOURCE.bear);
    expect(saved.borderWidth).toBe(1.25);
    expect(s().activeId).toBe(saved.id);
    expect(data[PRESETS_KEY]).toContain('From screenshot');
    expect(s().createFromSource(SOURCE).name).toBe('From screenshot 2');
  });
});
