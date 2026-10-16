'use client';

import { Trash2 } from 'lucide-react';
import { ColorField } from '@/components/ColorField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Candle, CandleColors } from '@/lib/detect/types';
import type { EdgeKey } from '@/lib/edit/ops';
import { useChartStore } from '@/store/chartStore';
import { selectActivePreset, usePresetStore } from '@/store/presetStore';
import { toast } from 'sonner';

const EDGE_FIELDS: Array<{ key: EdgeKey; label: string; optional?: boolean }> = [
  { key: 'wickTop', label: 'Wick top', optional: true },
  { key: 'bodyTop', label: 'Body top' },
  { key: 'bodyBottom', label: 'Body bottom' },
  { key: 'wickBottom', label: 'Wick bottom', optional: true },
  { key: 'bodyLeft', label: 'Body left' },
  { key: 'bodyRight', label: 'Body right' },
];

const COLOR_FIELDS: Array<{ key: keyof CandleColors; label: string }> = [
  { key: 'body', label: 'Body fill' },
  { key: 'border', label: 'Border' },
  { key: 'wick', label: 'Wick' },
];

export function CandleTab() {
  const candles = useChartStore((s) => s.candles);
  const selectedIds = useChartStore((s) => s.selectedIds);
  const setTypeOfSelected = useChartStore((s) => s.setTypeOfSelected);
  const deleteSelected = useChartStore((s) => s.deleteSelected);
  const setOverride = useChartStore((s) => s.setOverrideOfSelected);
  const resetOverride = useChartStore((s) => s.resetOverrideOfSelected);
  const setEdgeValue = useChartStore((s) => s.setEdgeValue);
  const splitSelected = useChartStore((s) => s.splitSelected);
  const mergeSelected = useChartStore((s) => s.mergeSelected);
  const preset = usePresetStore(selectActivePreset);

  const selected = candles
    .filter((c) => selectedIds.includes(c.id))
    .sort((a, b) => a.centerX - b.centerX);
  const first = selected[0];

  if (!first) {
    return (
      <p className="text-sm text-muted-foreground">
        Click a candle on the canvas to edit it. Shift+click adds more. Esc clears the selection.
      </p>
    );
  }

  const single = selected.length === 1 ? first : null;
  const sameType = selected.every((c) => c.type === first.type);
  const hasOverride = selected.some(
    (c) => c.colorOverride && Object.keys(c.colorOverride).length > 0,
  );
  const colorOf = (c: Candle, key: keyof CandleColors) =>
    c.colorOverride?.[key] ?? preset[c.type][key];

  return (
    <div className="space-y-5">
      <p className="text-sm">
        {selected.length === 1 ? '1 candle selected' : `${selected.length} candles selected`}
      </p>

      <section aria-label="Type" className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Type</h3>
        <div
          role="group"
          aria-label="Bull or bear"
          className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1"
        >
          {(['bull', 'bear'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={sameType && first.type === t}
              onClick={() => setTypeOfSelected(t)}
              className="rounded px-2 py-1.5 text-sm font-medium capitalize text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
            >
              {t}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Press T to flip.</p>
      </section>

      <section aria-label="Colours" className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Colours
        </h3>
        {COLOR_FIELDS.map(({ key, label }) => (
          <ColorField
            key={key}
            label={label}
            value={colorOf(first, key)}
            note={selected.some((c) => c.colorOverride?.[key]) ? 'custom' : undefined}
            onChange={(hex) => setOverride(key, hex)}
          />
        ))}
        <Button variant="outline" size="sm" onClick={resetOverride} disabled={!hasOverride}>
          Reset to preset
        </Button>
      </section>

      {single && (
        <section aria-label="Edges" className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Edges (source px)
          </h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {EDGE_FIELDS.map(({ key, label, optional }) => (
              <EdgeInput
                key={`${single.id}-${key}`}
                label={label}
                value={single[key]}
                optional={optional}
                onCommit={(v) => setEdgeValue(single.id, key, v)}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Drag the handles on the canvas. Shift = 0.1 px steps. Up/Down arrows nudge the active
            handle by 0.5 px.
          </p>
        </section>
      )}

      <section aria-label="Actions" className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!single}
            onClick={() => {
              if (!splitSelected()) toast.error('Select one wide-enough candle to split.');
            }}
            title="Cut the selected candle in two at the point you clicked"
          >
            Split
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={selected.length !== 2}
            onClick={() => {
              if (!mergeSelected()) toast.error('Merge needs two candles next to each other.');
            }}
            title="Merge two neighbouring candles into one"
          >
            Merge
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={deleteSelected}
            title="Delete (Delete / Backspace)"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Delete
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Split cuts at the spot you clicked. Merge needs two neighbouring candles selected.
        </p>
      </section>
    </div>
  );
}

/** Number field that applies on Enter or when you leave it. Empty clears an optional wick. */
function EdgeInput({
  label,
  value,
  optional,
  onCommit,
}: {
  label: string;
  value: number | null;
  optional?: boolean;
  onCommit: (v: number | null) => void;
}) {
  const shown = value === null ? '' : String(Math.round(value * 100) / 100);
  return (
    <label className="space-y-1 text-xs text-muted-foreground">
      {label}
      <Input
        type="number"
        step="0.1"
        defaultValue={shown}
        key={shown}
        placeholder={optional ? 'none' : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        onBlur={(e) => {
          const text = e.target.value.trim();
          if (text === shown) return;
          if (text === '') {
            if (optional) onCommit(null);
            else e.target.value = shown;
            return;
          }
          const n = Number(text);
          if (Number.isFinite(n)) onCommit(n);
          else e.target.value = shown;
        }}
      />
    </label>
  );
}
