'use client';

import { useDevicePixelRatio } from '@/lib/image/useDevicePixelRatio';
import { useChartStore } from '@/store/chartStore';

export function CanvasView() {
  const image = useChartStore((s) => s.image);
  const dpr = useDevicePixelRatio();
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
          // One source pixel = one screen pixel at any Windows scaling or browser zoom.
          // Stretching by a fractional ratio (1.25, 1.5) makes 1 px wicks look 2 px wide.
          width={image.width / dpr}
          height={image.height / dpr}
          draggable={false}
          className="block max-w-none"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>
    </div>
  );
}
