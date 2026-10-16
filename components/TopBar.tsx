'use client';

import { Button } from '@/components/ui/button';
import { useChartStore } from '@/store/chartStore';

export function TopBar() {
  const hasImage = useChartStore((s) => s.image !== null);
  const clear = useChartStore((s) => s.clear);

  return (
    <header className="flex items-center gap-3 border-b border-border px-4 py-2">
      <h1 className="text-base font-semibold">Candle SVG Tool</h1>
      <Button variant="outline" size="sm" onClick={clear} disabled={!hasImage}>
        New
      </Button>
      <div className="ml-auto flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Preset
          <select
            disabled
            aria-label="Active preset"
            className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          >
            <option>Abbi Light</option>
          </select>
        </label>
        <Button disabled title="Available after detection and export are built">
          Copy SVG
        </Button>
      </div>
    </header>
  );
}
