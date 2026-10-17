'use client';

import { toast } from 'sonner';
import { ArrowDownUp, Loader2, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { CandleGlyph } from '@/components/CandleGlyph';
import { currentUpGroup } from '@/lib/detect/hints';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { UNCLEAN_HELP, UNCLEAN_TITLE, describeExtras } from '@/lib/detect/notice';
import type { CandleColors } from '@/lib/detect/types';
import { ORIGINAL_ID } from '@/lib/presets/builtins';
import { usePresetStore } from '@/store/presetStore';
import { LOW_CONFIDENCE_THRESHOLD, useChartStore } from '@/store/chartStore';
import { useUiStore } from '@/store/uiStore';

const px = (n: number | null) => (n === null ? '–' : `${n.toFixed(2)} px`);

function Chip({
  colours,
  label,
  icon,
  bg,
}: {
  colours: CandleColors | null;
  label: string;
  icon: React.ReactNode;
  bg: string;
}) {
  return (
    <span className="flex items-center gap-2">
      {colours ? (
        <CandleGlyph
          colours={colours}
          background={bg}
          className="h-9 w-6 rounded-md border border-border"
        />
      ) : (
        <span className="h-9 w-6 rounded-md border border-dashed border-border" aria-hidden />
      )}
      <span className="leading-tight">
        <span className="flex items-center gap-1 text-sm font-medium">
          {icon}
          {label}
        </span>
        <span
          className="block text-[11px] text-muted-foreground"
          data-testid={`${label.toLowerCase()}-colour`}
        >
          {colours ? colours.body : 'none'}
        </span>
      </span>
    </span>
  );
}

function DirectionRow() {
  const result = useChartStore((s) => s.result);
  const candles = useChartStore((s) => s.candles);
  const swapDirection = useChartStore((s) => s.swapDirection);
  const activeId = usePresetStore((s) => s.activeId);
  const original = activeId === ORIGINAL_ID;
  const d = result?.direction;
  if (!result || !d) return null;
  const up = currentUpGroup(candles, d);
  const upColours = d.groups[up]?.colours ?? null;
  const downColours = d.groups[1 - up]?.colours ?? null;
  const why = {
    structure: 'Worked out from how the candles line up.',
    colour: 'Taken from the usual green and red.',
    remembered: 'Set by your earlier answer.',
    user: 'Set by your choice.',
    prior: 'Not sure: this is a guess. Please check it.',
  }[d.source];
  const bg = result.sourceStyle.background;
  const swap = () => {
    // After the swap, "up" is the other colour.
    const now = d.groups[1 - up]?.colours?.body;
    swapDirection();
    toast.success(now ? `Rising is now ${now}.` : 'Swapped.', {
      description: original
        ? 'Original colors keep each candle’s own colour, so the picture stays the same. Pick a preset like Abbi or Mo to see the swap.'
        : undefined,
    });
  };
  return (
    <section
      aria-label="Colours in your screenshot"
      className="space-y-2"
      data-testid="direction-row"
    >
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Colours in your screenshot
      </h3>
      <div className="flex items-center justify-between gap-2">
        <Chip
          bg={bg}
          colours={upColours}
          label="Rising"
          icon={<TrendingUp className="h-3.5 w-3.5" aria-hidden />}
        />
        <Chip
          bg={bg}
          colours={downColours}
          label="Falling"
          icon={<TrendingDown className="h-3.5 w-3.5" aria-hidden />}
        />
        <Button variant="outline" size="sm" onClick={swap} title="Swap rising and falling">
          <ArrowDownUp className="h-3.5 w-3.5" aria-hidden />
          Swap
        </Button>
      </div>
      <p
        className={
          d.sure ? 'text-xs text-muted-foreground' : 'text-xs text-amber-600 dark:text-amber-400'
        }
        data-testid="direction-why"
      >
        {why}
      </p>
      {original && (
        <p className="text-xs text-muted-foreground" data-testid="direction-original-note">
          Original colors keep every candle&apos;s own colour. Swap changes which candles a preset
          like Abbi or Mo paints as rising.
        </p>
      )}
    </section>
  );
}

export function DetectTab() {
  const image = useChartStore((s) => s.image);
  const status = useChartStore((s) => s.status);
  const error = useChartStore((s) => s.error);
  const result = useChartStore((s) => s.result);
  const candles = useChartStore((s) => s.candles);
  const settings = useChartStore((s) => s.settings);
  const setSettings = useChartStore((s) => s.setSettings);
  const runDetection = useChartStore((s) => s.runDetection);
  const select = useChartStore((s) => s.select);
  const selectedIds = useChartStore((s) => s.selectedIds);
  const setTab = useUiStore((s) => s.setTab);

  if (!image) {
    return (
      <p className="text-sm text-muted-foreground">Load a screenshot to detect its candles.</p>
    );
  }

  const rerun = () => void runDetection({ undoable: candles.length > 0 });
  const ordered = [...candles].sort((a, b) => a.centerX - b.centerX);
  const flagged = candles.filter((c) => c.confidence < LOW_CONFIDENCE_THRESHOLD).length;
  const running = status === 'running';

  return (
    <div className="space-y-5">
      <section aria-label="Result" className="space-y-1">
        <p className="text-2xl font-semibold tabular-nums" data-testid="candle-count">
          {candles.length} {candles.length === 1 ? 'candle' : 'candles'}
        </p>
        {flagged > 0 && (
          <p className="text-sm text-amber-600 dark:text-amber-400" data-testid="flagged-count">
            {flagged} flagged for review (amber dot)
          </p>
        )}
        {result && result.extras.length > 0 && (
          <p className="text-sm text-muted-foreground" data-testid="extras-found">
            Also found {describeExtras(result.extras)}.{' '}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => setTab('extras')}
            >
              Check them
            </button>
          </p>
        )}
        {result && !result.cleanliness.clean && (
          <p
            className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-700 dark:text-amber-300"
            data-testid="unclean-notice"
          >
            <strong>{UNCLEAN_TITLE}.</strong> {UNCLEAN_HELP}
          </p>
        )}
        {status === 'error' && error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </section>

      <section aria-label="Thresholds" className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <label id="tlow-label">T low (coverage starts)</label>
            <span className="tabular-nums">{settings.tLow}</span>
          </div>
          <Slider
            aria-labelledby="tlow-label"
            min={1}
            max={80}
            step={1}
            value={[settings.tLow]}
            onValueChange={([v]) => {
              const tLow = v ?? settings.tLow;
              setSettings({ tLow, tHigh: Math.max(settings.tHigh, tLow + 1) });
            }}
            onValueCommit={rerun}
          />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <label id="thigh-label">T high (coverage is full)</label>
            <span className="tabular-nums">{settings.tHigh}</span>
          </div>
          <Slider
            aria-labelledby="thigh-label"
            min={2}
            max={150}
            step={1}
            value={[settings.tHigh]}
            onValueChange={([v]) => {
              const tHigh = v ?? settings.tHigh;
              setSettings({ tHigh, tLow: Math.min(settings.tLow, tHigh - 1) });
            }}
            onValueCommit={rerun}
          />
        </div>
      </section>

      <DirectionRow />

      <section aria-label="Options" className="space-y-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          Uniform body width
          <Switch
            checked={settings.uniformBodyWidth}
            onCheckedChange={(v) => {
              setSettings({ uniformBodyWidth: v });
              rerun();
            }}
          />
        </label>
        <Button variant="outline" className="w-full" onClick={rerun} disabled={running}>
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          Re-detect
        </Button>
        <p className="text-xs text-muted-foreground">
          Re-detecting replaces the candles. Undo (Ctrl+Z) brings your edits back.
        </p>
      </section>

      {result && (
        <section aria-label="Measured from the screenshot" className="space-y-1 text-sm">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Measured
          </h3>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Median body width</dt>
            <dd className="tabular-nums" data-testid="measured-body-width">
              {px(result.medianBodyWidth)}
            </dd>
            <dt className="text-muted-foreground">Source border width</dt>
            <dd className="tabular-nums" data-testid="measured-border-width">
              {px(result.sourceBorderWidth)}
            </dd>
            <dt className="text-muted-foreground">Source wick width</dt>
            <dd className="tabular-nums">{px(result.sourceWickWidth)}</dd>
            <dt className="text-muted-foreground">Background</dt>
            <dd className="flex items-center gap-2 tabular-nums">
              <span
                className="inline-block h-3 w-3 rounded-sm border border-border"
                style={{ background: `rgb(${result.background.join(',')})` }}
                aria-hidden
              />
              rgb({result.background.join(', ')})
            </dd>
          </dl>
          <p className="text-xs text-muted-foreground">
            The export uses the active preset&apos;s border width, not the measured one.
          </p>
        </section>
      )}

      {ordered.length > 0 && (
        <section aria-label="Candles" className="space-y-1">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Candles
          </h3>
          <ul className="max-h-48 space-y-0.5 overflow-auto pr-1">
            {ordered.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    select(c.id, false);
                    setTab('candle');
                  }}
                  aria-pressed={selectedIds.includes(c.id)}
                  className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted"
                >
                  <span>Candle {String(i + 1).padStart(2, '0')}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {c.type}
                    <span
                      className={
                        c.confidence < LOW_CONFIDENCE_THRESHOLD
                          ? 'text-amber-600 dark:text-amber-400'
                          : ''
                      }
                    >
                      {c.confidence.toFixed(2)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
