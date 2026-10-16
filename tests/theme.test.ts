import { afterEach, describe, expect, it } from 'vitest';
import { THEME_INIT_SCRIPT, THEME_KEY, parseTheme, readStoredTheme, storeTheme } from '@/lib/theme';

const data: Record<string, string> = {};
function installStorage(broken = false) {
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => {
        if (broken) throw new Error('blocked');
        return data[k] ?? null;
      },
      setItem: (k: string, v: string) => {
        if (broken) throw new Error('blocked');
        data[k] = v;
      },
      removeItem: (k: string) => {
        if (broken) throw new Error('blocked');
        delete data[k];
      },
    },
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  for (const k of Object.keys(data)) delete data[k];
});

describe('theme', () => {
  it('only accepts light or dark; everything else follows the system', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    for (const v of ['system', '', null, undefined, 'blue', 3])
      expect(parseTheme(v)).toBe('system');
  });

  it('remembers an explicit choice and forgets it for "system"', () => {
    installStorage();
    storeTheme('dark');
    expect(data[THEME_KEY]).toBe('dark');
    expect(readStoredTheme()).toBe('dark');
    storeTheme('system');
    expect(data[THEME_KEY]).toBeUndefined();
    expect(readStoredTheme()).toBe('system');
  });

  it('falls back to the system theme when storage is blocked or missing', () => {
    installStorage(true);
    expect(readStoredTheme()).toBe('system');
    expect(() => storeTheme('light')).not.toThrow();
    delete (globalThis as { window?: unknown }).window;
    expect(readStoredTheme()).toBe('system');
  });

  it('the early script reads the same key it saves under', () => {
    expect(THEME_INIT_SCRIPT).toContain(THEME_KEY);
    expect(THEME_INIT_SCRIPT).toContain('data-theme');
  });
});
