import { create } from 'zustand';

export type PanelTab = 'detect' | 'colors' | 'candle' | 'extras' | 'export';
export type PngScale = 2 | 3 | 4;

interface UiState {
  tab: PanelTab;
  setTab: (tab: PanelTab) => void;
  /** Opacity of the SVG drawn over the screenshot. */
  overlayOpacity: number;
  setOverlayOpacity: (v: number) => void;
  showScreenshot: boolean;
  setShowScreenshot: (v: boolean) => void;
  exportBackground: boolean;
  setExportBackground: (v: boolean) => void;
  pngScale: PngScale;
  setPngScale: (v: PngScale) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (v: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  tab: 'detect',
  setTab: (tab) => set({ tab }),
  overlayOpacity: 0.8,
  setOverlayOpacity: (overlayOpacity) => set({ overlayOpacity }),
  showScreenshot: true,
  setShowScreenshot: (showScreenshot) => set({ showScreenshot }),
  exportBackground: false,
  setExportBackground: (exportBackground) => set({ exportBackground }),
  pngScale: 2,
  setPngScale: (pngScale) => set({ pngScale }),
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
}));
