import { create } from 'zustand';
import type { LoadedImage } from '@/lib/image/loadImage';

interface ChartState {
  image: LoadedImage | null;
  setImage: (image: LoadedImage) => void;
  clear: () => void;
}

export const useChartStore = create<ChartState>((set, get) => ({
  image: null,
  setImage: (image) => {
    const previous = get().image;
    if (previous) URL.revokeObjectURL(previous.url);
    set({ image });
  },
  clear: () => {
    const previous = get().image;
    if (previous) URL.revokeObjectURL(previous.url);
    set({ image: null });
  },
}));
