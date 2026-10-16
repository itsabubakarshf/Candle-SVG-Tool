'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { CanvasView } from '@/components/CanvasView';
import { ShortcutsDialog } from '@/components/ShortcutsDialog';
import { TopBar } from '@/components/TopBar';
import { UploadZone } from '@/components/UploadZone';
import { SidePanel } from '@/components/panel/SidePanel';
import { Toaster } from '@/components/ui/sonner';
import { useImageIntake } from '@/lib/image/useImageIntake';
import { useShortcuts } from '@/lib/shortcuts/useShortcuts';
import { LOW_CONFIDENCE_THRESHOLD, useChartStore } from '@/store/chartStore';
import { usePresetStore } from '@/store/presetStore';

export function App() {
  const ingest = useImageIntake();
  useShortcuts();
  const image = useChartStore((s) => s.image);
  const status = useChartStore((s) => s.status);
  const error = useChartStore((s) => s.error);
  const hydrate = usePresetStore((s) => s.hydrate);

  // Saved presets are read on the client only, so the server render matches the first paint.
  useEffect(() => hydrate(), [hydrate]);

  // Tell the user what detection found (or why it found nothing).
  const announced = useRef<string>('');
  useEffect(() => {
    if (!image || (status !== 'done' && status !== 'error')) return;
    const key = `${image.url}:${status}:${useChartStore.getState().result ? 1 : 0}:${error ?? ''}`;
    if (announced.current === key) return;
    announced.current = key;
    if (status === 'error') {
      toast.error(error ?? 'Detection failed.');
      return;
    }
    const candles = useChartStore.getState().candles;
    const flagged = candles.filter((c) => c.confidence < LOW_CONFIDENCE_THRESHOLD).length;
    toast.success(
      `${candles.length} ${candles.length === 1 ? 'candle' : 'candles'} found${
        flagged ? `, ${flagged} flagged for review` : ''
      }.`,
    );
  }, [image, status, error]);

  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      <TopBar />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="min-h-[24rem] min-w-0 flex-1 p-4 lg:min-h-0">
          {image ? <CanvasView /> : <UploadZone onFile={(f) => void ingest(f)} />}
        </main>
        <SidePanel />
      </div>
      <ShortcutsDialog />
      <Toaster />
    </div>
  );
}
