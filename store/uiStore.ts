import { create } from 'zustand';

export type PanelTab = 'detect' | 'colors' | 'candle' | 'extras' | 'export';
export type PngScale = 2 | 3 | 4;

interface UiState {
  tab: PanelTab;
  setTab: (tab: PanelTab) => void;
  /** Opacity of the SVG drawn over the screenshot. */
  overlayOpacity: number;
  setOverlayOpacity: (v: number) => void;
  /** Reads the remembered opacity. Called once on the client. */
  hydrate: () => void;
  showScreenshot: boolean;
  setShowScreenshot: (v: boolean) => void;
  exportBackground: boolean;
  setExportBackground: (v: boolean) => void;
  pngScale: PngScale;
  setPngScale: (v: PngScale) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (v: boolean) => void;
}

const OPACITY_KEY = 'candlesvg:overlayOpacity';

export const useUiStore = create<UiState>((set) => ({
  tab: 'detect',
  setTab: (tab) => set({ tab }),
  // Fully opaque: a preset shows its own colours, with none of the screenshot showing through.
  // Lower it to compare the SVG with the screenshot; the choice is remembered.
  overlayOpacity: 1,
  setOverlayOpacity: (overlayOpacity) => {
    set({ overlayOpacity });
    try {
      window.localStorage.setItem(OPACITY_KEY, String(overlayOpacity));
    } catch {
      /* storage blocked: it lasts until the page closes */
    }
  },
  hydrate: () => {
    try {
      const saved = Number(window.localStorage.getItem(OPACITY_KEY));
      if (window.localStorage.getItem(OPACITY_KEY) !== null && saved >= 0 && saved <= 1)
        set({ overlayOpacity: saved });
    } catch {
      /* keep the default */
    }
  },
  showScreenshot: true,
  setShowScreenshot: (showScreenshot) => set({ showScreenshot }),
  exportBackground: false,
  setExportBackground: (exportBackground) => set({ exportBackground }),
  pngScale: 2,
  setPngScale: (pngScale) => set({ pngScale }),
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
}));
