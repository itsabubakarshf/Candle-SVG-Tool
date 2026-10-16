'use client';

import { useMemo, useRef } from 'react';
import { Copy, Download, Plus, Save, Trash2, Undo2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { ColorField } from '@/components/ColorField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { downloadText } from '@/lib/export/download';
import type { CandleColors } from '@/lib/detect/types';
import { ORIGINAL_ID, ORIGINAL_NAME } from '@/lib/presets/builtins';
import { currentSourceStyle } from '@/lib/detect/hints';
import { useChartStore } from '@/store/chartStore';
import { selectActivePreset, usePresetStore } from '@/store/presetStore';
import { cn } from '@/lib/utils';

const FIELDS: Array<{ key: keyof CandleColors; label: string }> = [
  { key: 'body', label: 'Body fill' },
  { key: 'border', label: 'Border' },
  { key: 'wick', label: 'Wick' },
];

export function ColorsTab() {
  const presets = usePresetStore((s) => s.presets);
  const activeId = usePresetStore((s) => s.activeId);
  const draft = usePresetStore((s) => s.draft);
  const storageOk = usePresetStore((s) => s.storageOk);
  const ensureSignedIn = usePresetStore((s) => s.ensureSignedIn);
  const edit = usePresetStore(selectActivePreset);
  const setActive = usePresetStore((s) => s.setActive);
  const editDraft = usePresetStore((s) => s.editDraft);
  const discardDraft = usePresetStore((s) => s.discardDraft);
  const saveDraft = usePresetStore((s) => s.saveDraft);
  const newPreset = usePresetStore((s) => s.newPreset);
  const duplicate = usePresetStore((s) => s.duplicate);
  const remove = usePresetStore((s) => s.remove);
  const importJson = usePresetStore((s) => s.importJson);
  const exportJson = usePresetStore((s) => s.exportJson);
  const createFromSource = usePresetStore((s) => s.createFromSource);
  const result = useChartStore((s) => s.result);
  const chartCandles = useChartStore((s) => s.candles);
  const sourceStyle = useMemo(
    () => currentSourceStyle(result, chartCandles),
    [result, chartCandles],
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const isOriginal = activeId === ORIGINAL_ID;

  const active = presets.find((p) => p.id === activeId);
  const dirty = draft !== null;

  const onImport = async (file: File) => {
    if (!ensureSignedIn()) return;
    const text = await file.text();
    const result = importJson(text, (name) =>
      window.confirm(
        `A preset named "${name}" already exists.\n\nOK = overwrite it\nCancel = keep both`,
      )
        ? 'overwrite'
        : 'keep-both',
    );
    if (!result) {
      toast.error('That file is not a preset backup.');
      return;
    }
    const parts = [`${result.added} added`];
    if (result.overwritten) parts.push(`${result.overwritten} overwritten`);
    if (result.skipped) parts.push(`${result.skipped} skipped`);
    toast.success(`Presets imported: ${parts.join(', ')}.`);
  };

  const setColor = (side: 'bull' | 'bear', key: keyof CandleColors, hex: string) =>
    editDraft({ [side]: { ...edit[side], [key]: hex } });

  return (
    <div className="space-y-5">
      <section aria-label="Presets" className="space-y-2">
        <ul className="space-y-0.5" role="listbox" aria-label="Preset list">
          <li>
            <button
              type="button"
              role="option"
              aria-selected={isOriginal}
              onClick={() => setActive(ORIGINAL_ID)}
              className={cn(
                'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isOriginal && 'bg-muted font-medium',
              )}
            >
              <span className="truncate">{ORIGINAL_NAME}</span>
              <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                from your chart
              </span>
            </button>
          </li>
          {presets.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={p.id === activeId}
                onClick={() => setActive(p.id)}
                className={cn(
                  'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  p.id === activeId && 'bg-muted font-medium',
                )}
              >
                <span className="truncate">{p.name}</span>
                <span className="ml-2 flex shrink-0 gap-0.5" aria-hidden>
                  {[p.bull.body, p.bull.border, p.bear.body].map((c, i) => (
                    <span
                      key={i}
                      className="h-3 w-3 rounded-sm border border-border"
                      style={{ background: c }}
                    />
                  ))}
                </span>
                {p.builtIn && (
                  <span className="ml-2 max-w-[6rem] shrink-0 truncate text-[10px] uppercase text-muted-foreground">
                    {p.community ? (p.community.ownerName ?? 'shared') : 'built-in'}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" size="sm" onClick={() => newPreset()} title="New preset">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isOriginal}
            onClick={() => duplicate(activeId)}
            title="Duplicate the selected preset"
          >
            <Copy className="h-3.5 w-3.5" aria-hidden />
            Duplicate
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!active || active.builtIn}
            onClick={() => {
              if (active && window.confirm(`Delete the preset "${active.name}"?`))
                remove(active.id);
            }}
            title={
              active?.builtIn ? 'Built-in presets cannot be deleted' : 'Delete the selected preset'
            }
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Delete
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <Upload className="h-3.5 w-3.5" aria-hidden />
            Import
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadText(exportJson(), 'candle-presets.json', 'application/json')}
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            Export
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Import presets JSON file"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImport(file);
              e.target.value = '';
            }}
          />
        </div>
        {!storageOk && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            Your browser blocked saving. Presets will be lost when you close the page. Use Export to
            keep a backup.
          </p>
        )}
      </section>

      {isOriginal ? (
        <OriginalPanel
          hasImage={sourceStyle !== null}
          style={sourceStyle}
          onSave={() => {
            if (!sourceStyle) return;
            const saved = createFromSource(sourceStyle);
            if (saved) toast.success(`Saved "${saved.name}". You can edit it now.`);
          }}
        />
      ) : (
        <section aria-label="Editor" className="space-y-3 border-t border-border pt-4">
          <label className="space-y-1 text-xs text-muted-foreground">
            Name
            <Input
              value={edit.name}
              maxLength={60}
              onChange={(e) => editDraft({ name: e.target.value })}
            />
          </label>

          {(['bull', 'bear'] as const).map((side) => (
            <fieldset key={side} className="space-y-2 pt-1">
              <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {side}
              </legend>
              {FIELDS.map(({ key, label }) => (
                <ColorField
                  key={key}
                  label={label}
                  value={edit[side][key]}
                  onChange={(hex) => setColor(side, key, hex)}
                />
              ))}
            </fieldset>
          ))}

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Border width (px)"
              value={edit.borderWidth}
              onChange={(v) => editDraft({ borderWidth: v })}
            />
            <NumberField
              label="Wick width (px)"
              value={edit.wickWidth}
              onChange={(v) => editDraft({ wickWidth: v })}
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center justify-between gap-3 text-sm">
              Transparent background
              <Switch
                checked={edit.background === null}
                onCheckedChange={(v) => editDraft({ background: v ? null : '#FFFFFF' })}
              />
            </label>
            {edit.background !== null && (
              <ColorField
                label="Background"
                value={edit.background}
                onChange={(hex) => editDraft({ background: hex })}
              />
            )}
          </div>

          {edit.builtIn && (
            <p className="text-xs text-muted-foreground">
              {edit.community
                ? "This preset belongs to someone else, so you can't change it. Saving your edits makes a copy that is yours."
                : "Built-in presets can't be changed. Saving your edits makes a new preset."}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              disabled={!dirty}
              onClick={() => {
                const saved = saveDraft();
                if (saved) toast.success(`Saved "${saved.name}".`);
              }}
            >
              <Save className="h-3.5 w-3.5" aria-hidden />
              Save
            </Button>
            <Button variant="outline" size="sm" disabled={!dirty} onClick={discardDraft}>
              <Undo2 className="h-3.5 w-3.5" aria-hidden />
              Revert
            </Button>
          </div>
          {dirty && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Unsaved changes (shown live).
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="space-y-1 text-xs text-muted-foreground">
      {label}
      <Input
        type="number"
        min={0.1}
        max={20}
        step={0.25}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n > 0) onChange(Math.min(20, n));
        }}
      />
    </label>
  );
}

function Swatches({
  label,
  colors,
}: {
  label: string;
  colors: { body: string; border: string; wick: string } | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="capitalize">{label}</span>
      {colors ? (
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          {(['body', 'border', 'wick'] as const).map((k) => (
            <span key={k} className="flex items-center gap-1" title={`${k}: ${colors[k]}`}>
              <span
                className="h-4 w-4 rounded-sm border border-border"
                style={{ background: colors[k] }}
                aria-hidden
              />
              <span className="font-mono">{colors[k]}</span>
            </span>
          ))}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">none in this chart</span>
      )}
    </div>
  );
}

function OriginalPanel({
  hasImage,
  style,
  onSave,
}: {
  hasImage: boolean;
  style: import('@/lib/detect/types').SourceStyle | null;
  onSave: () => void;
}) {
  return (
    <section aria-label="Original colours" className="space-y-3 border-t border-border pt-4">
      <p className="text-sm">
        The SVG uses the colours, border and wick widths found in your screenshot. Nothing is
        repainted.
      </p>
      {hasImage && style ? (
        <>
          <div className="space-y-2" data-testid="original-colours">
            <Swatches label="bull" colors={style.bull} />
            <Swatches label="bear" colors={style.bear} />
            <p className="text-xs text-muted-foreground">
              Border {style.borderWidth} px · wick {style.wickWidth} px · background{' '}
              {style.background}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onSave}>
            <Save className="h-3.5 w-3.5" aria-hidden />
            Save as preset
          </Button>
          <p className="text-xs text-muted-foreground">
            Want different colours? Pick Abbi, Mo or your own preset above, or save these as a
            preset and edit it. A single odd candle keeps its own colour too.
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Load a screenshot to see its colours here.</p>
      )}
    </section>
  );
}
