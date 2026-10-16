'use client';

import { Copy, Download, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { copySvg, downloadPngFile, downloadSvgFile } from '@/lib/export/actions';
import { useChartStore } from '@/store/chartStore';
import { useUiStore, type PngScale } from '@/store/uiStore';
import { cn } from '@/lib/utils';

const SCALES: PngScale[] = [2, 3, 4];

export function ExportTab() {
  const image = useChartStore((s) => s.image);
  const count = useChartStore((s) => s.candles.length);
  const pngScale = useUiStore((s) => s.pngScale);
  const setPngScale = useUiStore((s) => s.setPngScale);
  const background = useUiStore((s) => s.exportBackground);
  const setBackground = useUiStore((s) => s.setExportBackground);
  const ready = !!image && count > 0;

  return (
    <div className="space-y-5">
      <section aria-label="SVG" className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">SVG</h3>
        <Button className="w-full" onClick={() => void copySvg()} disabled={!ready}>
          <Copy className="h-4 w-4" aria-hidden />
          Copy SVG
        </Button>
        <Button variant="outline" className="w-full" onClick={downloadSvgFile} disabled={!ready}>
          <Download className="h-4 w-4" aria-hidden />
          Download SVG
        </Button>
        <label className="flex items-center justify-between gap-3 pt-1 text-sm">
          Background rectangle
          <Switch checked={background} onCheckedChange={setBackground} />
        </label>
        <p className="text-xs text-muted-foreground">
          Transparent by default. When on, a rect named &quot;Background&quot; uses the
          preset&apos;s background colour (white if none).
        </p>
      </section>

      <section aria-label="PNG" className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">PNG</h3>
        <div
          role="radiogroup"
          aria-label="PNG scale"
          className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1"
        >
          {SCALES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={pngScale === s}
              onClick={() => setPngScale(s)}
              className={cn(
                'rounded px-2 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                pngScale === s
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground',
              )}
            >
              {s}x
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => void downloadPngFile()}
          disabled={!ready}
        >
          <ImageIcon className="h-4 w-4" aria-hidden />
          Download PNG
        </Button>
        {image && (
          <p className="text-xs text-muted-foreground">
            {image.width * pngScale} × {image.height * pngScale} px
          </p>
        )}
      </section>

      <section aria-label="Figma tips" className="space-y-1 text-xs text-muted-foreground">
        <h3 className="font-medium uppercase tracking-wide">In Figma</h3>
        <p>Press Ctrl+V. The candles arrive as named vector layers.</p>
        <p>Normal resize keeps wicks and borders thin. The Scale tool (K) scales strokes too.</p>
      </section>
    </div>
  );
}
