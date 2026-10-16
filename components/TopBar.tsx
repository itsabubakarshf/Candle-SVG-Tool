'use client';

import { Copy, Keyboard } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { copySvg } from '@/lib/export/actions';
import { useChartStore } from '@/store/chartStore';
import { ORIGINAL_ID, ORIGINAL_NAME } from '@/lib/presets/builtins';
import { usePresetStore } from '@/store/presetStore';
import { useUiStore } from '@/store/uiStore';

export function TopBar() {
  const hasImage = useChartStore((s) => s.image !== null);
  const hasCandles = useChartStore((s) => s.candles.length > 0);
  const clear = useChartStore((s) => s.clear);
  const presets = usePresetStore((s) => s.presets);
  const activeId = usePresetStore((s) => s.activeId);
  const setActive = usePresetStore((s) => s.setActive);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
      <h1 className="text-base font-semibold">Crisper</h1>
      <p className="hidden text-xs text-muted-foreground sm:block">
        Dev by{' '}
        <a
          href="https://www.instagram.com/me__abbi/"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Abbi
        </a>
      </p>
      <Button variant="outline" size="sm" onClick={clear} disabled={!hasImage}>
        New
      </Button>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Preset
          <select
            aria-label="Active preset"
            value={activeId}
            onChange={(e) => setActive(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value={ORIGINAL_ID}>{ORIGINAL_NAME}</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShortcutsOpen(true)}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
        >
          <Keyboard className="h-4 w-4" />
        </Button>
        <Button onClick={() => void copySvg()} disabled={!hasCandles}>
          <Copy className="h-4 w-4" aria-hidden />
          Copy SVG
        </Button>
      </div>
    </header>
  );
}
