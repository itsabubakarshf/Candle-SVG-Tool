'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { CandleGlyph } from '@/components/CandleGlyph';
import { Button } from '@/components/ui/button';
import type { CandleColors, DetectionResult } from '@/lib/detect/types';
import { useChartStore } from '@/store/chartStore';
import { usePresetStore } from '@/store/presetStore';

/**
 * Asked only when the chart gave no real answer (see lib/detect/direction.ts): which colour
 * is a rising candle? One tap, no typing, easy to skip. A guess is already applied meanwhile.
 */
export function DirectionPrompt() {
  const status = useChartStore((s) => s.status);
  const result = useChartStore((s) => s.result);
  const chooseRising = useChartStore((s) => s.chooseRising);
  const signedIn = usePresetStore((s) => s.account !== null);
  const [skipped, setSkipped] = useState<DetectionResult | null>(null);

  const d = result?.direction;
  if (!result || !d || d.sure || status !== 'done' || skipped === result) return null;
  const groups = d.groups.filter((g) => g.colours !== null);
  if (groups.length === 0) return null;

  // Two colours: tap the rising one. One colour: say whether it is rising or falling.
  const options: Array<{ colours: CandleColors; label: string; sub: string; group: 0 | 1 }> =
    d.groups[1]?.colours && d.groups[0]?.colours
      ? ([0, 1] as const).map((g) => ({
          colours: d.groups[g]?.colours as CandleColors,
          label: `${d.groups[g]?.count} candle${d.groups[g]?.count === 1 ? '' : 's'}`,
          sub: (d.groups[g]?.colours as CandleColors).body,
          group: g,
        }))
      : [
          {
            colours: d.groups[0]?.colours as CandleColors,
            label: 'Rising',
            sub: 'price went up',
            group: 0,
          },
          {
            colours: d.groups[0]?.colours as CandleColors,
            label: 'Falling',
            sub: 'price went down',
            group: 1,
          },
        ];
  const single = options.length === 2 && options[0]?.label === 'Rising';

  const pick = (group: 0 | 1) => {
    chooseRising(group);
    toast.success('Got it. Thanks!', {
      description: signedIn
        ? "We'll remember this for these colours."
        : 'We will remember it in this browser. Sign in to keep it everywhere.',
    });
  };

  return (
    <div
      role="group"
      aria-labelledby="direction-title"
      data-testid="direction-prompt"
      className="mb-3 rounded-2xl border border-border bg-muted/50 p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-[14rem] flex-1">
          <h2 id="direction-title" className="text-sm font-semibold">
            {single ? 'Are these candles rising or falling?' : 'Which colour is a rising candle?'}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {single
              ? "We couldn't tell from your chart. Tap the answer."
              : "We couldn't tell from your chart. Tap the one where price went up."}{' '}
            {signedIn
              ? "We'll remember it for these colours."
              : 'Remembered in this browser; sign in to keep it everywhere.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {options.map((o) => (
            <button
              key={o.group}
              type="button"
              onClick={() => pick(o.group)}
              className="flex items-center gap-3 rounded-xl border border-border bg-background p-2 pr-4 text-left transition hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CandleGlyph
                colours={o.colours}
                background={result.sourceStyle.background}
                className="h-12 w-9 shrink-0 rounded-lg border border-border"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{o.sub}</span>
              </span>
            </button>
          ))}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setSkipped(result)}
            aria-label="Skip: keep our guess"
            title="Skip: keep our guess"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
