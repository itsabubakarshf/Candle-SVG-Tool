'use client';

import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useChartStore } from '@/store/chartStore';
import { loadImage } from './loadImage';

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

/** Returns `ingest(file)` and wires Ctrl+V / Cmd+V paste for the whole page. */
export function useImageIntake(): (file: Blob, name?: string) => Promise<void> {
  const setImage = useChartStore((s) => s.setImage);

  const ingest = useCallback(
    async (file: Blob, name?: string) => {
      try {
        const image = await loadImage(file, name ?? (file as File).name ?? 'pasted-image');
        setImage(image);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not load this image.');
      }
    },
    [setImage],
  );

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      if (isEditable(event.target)) return;
      const items = Array.from(event.clipboardData?.items ?? []);
      const item = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (!file) return;
      event.preventDefault();
      void ingest(file);
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [ingest]);

  return ingest;
}
