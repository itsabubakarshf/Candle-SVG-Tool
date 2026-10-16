export type Theme = 'system' | 'light' | 'dark';

export const THEME_KEY = 'candlesvg:theme';

/** Anything other than an explicit light or dark choice means "follow the system". */
export function parseTheme(value: unknown): Theme {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function readStoredTheme(): Theme {
  try {
    return parseTheme(window.localStorage.getItem(THEME_KEY));
  } catch {
    return 'system'; // storage blocked
  }
}

export function storeTheme(theme: Theme): void {
  try {
    if (theme === 'system') window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // The choice still applies for this visit; it just will not be remembered.
  }
}

/** "system" removes the override so the CSS media query decides. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/** Runs before the first paint so a saved theme never flashes the wrong colours. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}})();`;
