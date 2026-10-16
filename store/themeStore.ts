import { create } from 'zustand';
import { applyTheme, readStoredTheme, storeTheme, type Theme } from '@/lib/theme';

interface ThemeState {
  theme: Theme;
  /** Reads the saved choice. Called once on the client. */
  hydrate: () => void;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'system',
  hydrate: () => {
    const theme = readStoredTheme();
    applyTheme(theme);
    set({ theme });
  },
  setTheme: (theme) => {
    applyTheme(theme);
    storeTheme(theme);
    set({ theme });
  },
}));
