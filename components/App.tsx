'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { CanvasView } from '@/components/CanvasView';
import { DirectionPrompt } from '@/components/DirectionPrompt';
import { ShortcutsDialog } from '@/components/ShortcutsDialog';
import { SignInDialog } from '@/components/SignInDialog';
import { TopBar } from '@/components/TopBar';
import { UploadZone } from '@/components/UploadZone';
import { SidePanel } from '@/components/panel/SidePanel';
import { Toaster } from '@/components/ui/sonner';
import { useImageIntake } from '@/lib/image/useImageIntake';
import { useReadLabels } from '@/lib/ocr/useReadLabels';
import { useShortcuts } from '@/lib/shortcuts/useShortcuts';
import { UNCLEAN_HELP, UNCLEAN_TITLE, describeExtras } from '@/lib/detect/notice';
import { LOW_CONFIDENCE_THRESHOLD, useChartStore } from '@/store/chartStore';
import { useHintStore } from '@/store/hintStore';
import { usePresetStore } from '@/store/presetStore';
import { useThemeStore } from '@/store/themeStore';

export function App() {
  const ingest = useImageIntake();
  useShortcuts();
  useReadLabels();
  const image = useChartStore((s) => s.image);
  const status = useChartStore((s) => s.status);
  const error = useChartStore((s) => s.error);
  const hydrate = usePresetStore((s) => s.hydrate);
  const hydrateTheme = useThemeStore((s) => s.hydrate);

  // Saved presets are read on the client only, so the server render matches the first paint.
  useEffect(() => hydrate(), [hydrate]);
  useEffect(() => hydrateTheme(), [hydrateTheme]);
  // What the person has said about their charts' colours, kept in the account when signed in.
  const accountId = usePresetStore((s) => s.account?.id ?? null);
  useEffect(() => useHintStore.getState().hydrate(), []);
  useEffect(() => {
    void useHintStore.getState().setAccount(usePresetStore.getState().account);
  }, [accountId]);

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
    const { candles, result } = useChartStore.getState();
    // One notice, and only one: an unclean chart gets this instead of the usual summary.
    if (result && !result.cleanliness.clean) {
      toast.warning(UNCLEAN_TITLE, { description: UNCLEAN_HELP, duration: 10000 });
      return;
    }
    const flagged = candles.filter((c) => c.confidence < LOW_CONFIDENCE_THRESHOLD).length;
    const extras = result?.extras ?? [];
    toast.success(
      `${candles.length} ${candles.length === 1 ? 'candle' : 'candles'} found${
        flagged ? `, ${flagged} flagged for review` : ''
      }.`,
      extras.length > 0
        ? {
            description: `Also found ${describeExtras(extras)}. They are in the SVG too: check the Extras tab.`,
          }
        : undefined,
    );
  }, [image, status, error]);

  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      <TopBar />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="flex min-h-[24rem] min-w-0 flex-1 flex-col p-4 lg:min-h-0">
          {image && <DirectionPrompt />}
          <div className="min-h-0 flex-1">
            {image ? <CanvasView /> : <UploadZone onFile={(f) => void ingest(f)} />}
          </div>
        </main>
        <SidePanel />
      </div>
      <ShortcutsDialog />
      <SignInDialog />
      <Toaster />
    </div>
  );
}
