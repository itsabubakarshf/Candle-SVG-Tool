'use client';

import { CanvasView } from '@/components/CanvasView';
import { TopBar } from '@/components/TopBar';
import { UploadZone } from '@/components/UploadZone';
import { SidePanel } from '@/components/panel/SidePanel';
import { Toaster } from '@/components/ui/sonner';
import { useImageIntake } from '@/lib/image/useImageIntake';
import { useChartStore } from '@/store/chartStore';

export function App() {
  const ingest = useImageIntake();
  const hasImage = useChartStore((s) => s.image !== null);

  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      <TopBar />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="min-h-0 flex-1 p-4">
          {hasImage ? <CanvasView /> : <UploadZone onFile={(f) => void ingest(f)} />}
        </main>
        <SidePanel />
      </div>
      <Toaster />
    </div>
  );
}
