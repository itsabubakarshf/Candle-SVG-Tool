'use client';

import { useChartStore } from '@/store/chartStore';

export function CanvasView() {
  const image = useChartStore((s) => s.image);
  if (!image) return null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="text-xs text-muted-foreground">
        {image.name} · {image.width} × {image.height} px
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-muted p-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, must stay untouched */}
        <img
          src={image.url}
          alt="Uploaded candle screenshot"
          width={image.width}
          height={image.height}
          draggable={false}
          className="block max-w-none"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>
    </div>
  );
}
