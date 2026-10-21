'use client';

import { CircleDashed, Minus, Plus, Square, Trash2, Type } from 'lucide-react';
import { ColorField } from '@/components/ColorField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { BoxExtra, Extra, LineExtra, MarkerExtra, TextExtra } from '@/lib/detect/types';
import { byKind } from '@/lib/svg/extras';
import { useChartStore } from '@/store/chartStore';

export function ExtrasTab() {
  const image = useChartStore((s) => s.image);
  const extras = useChartStore((s) => s.extras);
  const selectedId = useChartStore((s) => s.selectedExtraId);
  const selectExtra = useChartStore((s) => s.selectExtra);
  const addText = useChartStore((s) => s.addText);
  const addMarker = useChartStore((s) => s.addMarker);
  const deleteExtra = useChartStore((s) => s.deleteExtra);

  if (!image) {
    return (
      <p className="text-sm text-muted-foreground">
        Load a screenshot. Lines, boxes and labels found next to the candles show up here.
      </p>
    );
  }
  const { boxes, lines, markers } = byKind(extras);
  const texts = extras.filter((e): e is TextExtra => e.kind === 'text');
  const selected = extras.find((e) => e.id === selectedId);
  const unread = texts.filter((t) => t.text.trim() === '').length;

  return (
    <div className="space-y-5">
      <section aria-label="Found" className="space-y-1">
        <p className="text-sm" data-testid="extras-summary">
          {extras.length === 0
            ? 'No lines, boxes or labels found.'
            : `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}, ${boxes.length} ${
                boxes.length === 1 ? 'box' : 'boxes'
              }, ${texts.length} ${texts.length === 1 ? 'label' : 'labels'}${
                markers.length > 0
                  ? `, ${markers.length} ${markers.length === 1 ? 'sticker' : 'stickers'}`
                  : ''
              }`}
        </p>
        {unread > 0 && (
          <p className="text-sm text-amber-600 dark:text-amber-400" data-testid="unread-count">
            {unread} {unread === 1 ? 'label' : 'labels'} could not be read. It is kept as it looks
            in the screenshot until you type it: double-click it on the picture.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          They are copied into the SVG with the candles: boxes behind, lines, stickers and labels in
          front. Click one on the picture to move or fix it. Double-click empty space to add a
          label.
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => addText(image.width / 2, image.height / 2)}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add label
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => addMarker(image.width / 2, image.height / 2)}
        >
          <CircleDashed className="h-3.5 w-3.5" aria-hidden />
          Add PSP sticker
        </Button>
      </div>

      {extras.length > 0 && (
        <section aria-label="List" className="space-y-1">
          {[...boxes, ...lines, ...markers, ...texts].map((e) => (
            <button
              key={e.id}
              type="button"
              data-testid={`extra-row-${e.id}`}
              onClick={() => selectExtra(e.id)}
              aria-pressed={e.id === selectedId}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted"
            >
              <KindIcon extra={e} />
              <span className="truncate">{describe(e)}</span>
            </button>
          ))}
        </section>
      )}

      {selected && (
        <section aria-label="Selected" className="space-y-4 border-t border-border pt-4">
          {selected.kind === 'line' && <LineForm line={selected} />}
          {selected.kind === 'box' && <BoxForm box={selected} />}
          {selected.kind === 'text' && <TextForm text={selected} />}
          {selected.kind === 'marker' && <MarkerForm marker={selected} />}
          <Button variant="outline" size="sm" onClick={() => deleteExtra(selected.id)}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Delete
          </Button>
        </section>
      )}
    </div>
  );
}

function KindIcon({ extra }: { extra: Extra }) {
  const cls = 'h-3.5 w-3.5 shrink-0 text-muted-foreground';
  if (extra.kind === 'line') return <Minus className={cls} aria-hidden />;
  if (extra.kind === 'box') return <Square className={cls} aria-hidden />;
  if (extra.kind === 'marker') return <CircleDashed className={cls} aria-hidden />;
  return <Type className={cls} aria-hidden />;
}

function describe(e: Extra): string {
  if (e.kind === 'line') {
    const style = e.dash ? (e.dash[0] <= 2 ? 'dotted' : 'dashed') : 'solid';
    const len = Math.round(Math.hypot(e.x2 - e.x1, e.y2 - e.y1));
    return `Line, ${style}, ${len} px`;
  }
  if (e.kind === 'box') return `Box, ${Math.round(e.width)} × ${Math.round(e.height)}`;
  if (e.kind === 'marker') return `PSP sticker, ${Math.round(markerSize(e))} px`;
  return e.text.trim() === '' ? 'Label (not read)' : `Label: ${e.text}`;
}

const stepNumber = (v: number) => String(Math.round(v * 100) / 100);

function Num({
  label,
  value,
  onCommit,
  min,
  step = 0.5,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  step?: number;
}) {
  const shown = stepNumber(value);
  return (
    <label className="space-y-1 text-xs text-muted-foreground">
      {label}
      <Input
        type="number"
        step={step}
        min={min}
        defaultValue={shown}
        key={shown}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (e.target.value.trim() === shown || !Number.isFinite(n)) {
            e.target.value = shown;
            return;
          }
          onCommit(min !== undefined ? Math.max(min, n) : n);
        }}
      />
    </label>
  );
}

function LineForm({ line }: { line: LineExtra }) {
  const update = useChartStore((s) => s.updateExtra);
  const style = line.dash === null ? 'solid' : line.dash[0] <= 2 ? 'dotted' : 'dashed';
  const setStyle = (next: 'solid' | 'dashed' | 'dotted') => {
    const w = Math.max(1, line.width);
    update(line.id, {
      dash: next === 'solid' ? null : next === 'dotted' ? [w, w * 2] : [w * 6, w * 4],
    });
  };
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Line</h3>
      <ColorField
        label="Colour"
        value={line.color}
        onChange={(hex) => update(line.id, { color: hex }, `line-color:${line.id}`)}
      />
      <div
        role="group"
        aria-label="Line style"
        className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1"
      >
        {(['solid', 'dashed', 'dotted'] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={style === s}
            onClick={() => setStyle(s)}
            className="rounded px-2 py-1.5 text-sm font-medium capitalize text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
          >
            {s}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Num
          label="Thickness"
          value={line.width}
          min={0.25}
          step={0.25}
          onCommit={(v) => update(line.id, { width: v })}
        />
        {line.dash && (
          <>
            <Num
              label="Dash"
              value={line.dash[0]}
              min={0.5}
              onCommit={(v) => update(line.id, { dash: [v, (line.dash as [number, number])[1]] })}
            />
            <Num
              label="Gap"
              value={line.dash[1]}
              min={0.5}
              onCommit={(v) => update(line.id, { dash: [(line.dash as [number, number])[0], v] })}
            />
          </>
        )}
        <Num label="Start x" value={line.x1} onCommit={(v) => update(line.id, { x1: v })} />
        <Num label="Start y" value={line.y1} onCommit={(v) => update(line.id, { y1: v })} />
        <Num label="End x" value={line.x2} onCommit={(v) => update(line.id, { x2: v })} />
        <Num label="End y" value={line.y2} onCommit={(v) => update(line.id, { y2: v })} />
      </div>
    </div>
  );
}

function BoxForm({ box }: { box: BoxExtra }) {
  const update = useChartStore((s) => s.updateExtra);
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Box</h3>
      <ColorField
        label="Fill"
        value={box.fill}
        onChange={(hex) => update(box.id, { fill: hex }, `box-fill:${box.id}`)}
      />
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Num label="Left" value={box.x} onCommit={(v) => update(box.id, { x: v })} />
        <Num label="Top" value={box.y} onCommit={(v) => update(box.id, { y: v })} />
        <Num
          label="Width"
          value={box.width}
          min={1}
          onCommit={(v) => update(box.id, { width: v })}
        />
        <Num
          label="Height"
          value={box.height}
          min={1}
          onCommit={(v) => update(box.id, { height: v })}
        />
      </div>
    </div>
  );
}

function TextForm({ text }: { text: TextExtra }) {
  const update = useChartStore((s) => s.updateExtra);
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Label</h3>
      <label className="block space-y-1 text-xs text-muted-foreground">
        Text
        <Input
          data-testid="label-text"
          value={text.text}
          placeholder="Type the text here"
          onChange={(e) =>
            update(
              text.id,
              { text: e.target.value, unread: e.target.value.trim() === '' },
              `text:${text.id}`,
            )
          }
        />
      </label>
      <ColorField
        label="Colour"
        value={text.color}
        onChange={(hex) => update(text.id, { color: hex }, `text-color:${text.id}`)}
      />
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Num
          label="Size"
          value={text.size}
          min={4}
          step={1}
          onCommit={(v) => update(text.id, { size: v })}
        />
        <span />
        <Num label="Left" value={text.x} onCommit={(v) => update(text.id, { x: v })} />
        <Num label="Baseline" value={text.y} onCommit={(v) => update(text.id, { y: v })} />
      </div>
    </div>
  );
}

/** Outside diameter of the sticker, dot edge to dot edge. */
const markerSize = (m: MarkerExtra) => 2 * (m.r + m.dotR);

function MarkerForm({ marker }: { marker: MarkerExtra }) {
  const update = useChartStore((s) => s.updateExtra);
  const size = markerSize(marker);
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        PSP sticker
      </h3>
      <p className="text-xs text-muted-foreground">
        One shape in the SVG. Colour and size change the whole ring.
      </p>
      <ColorField
        label="Colour"
        value={marker.color}
        onChange={(hex) => update(marker.id, { color: hex }, `marker-color:${marker.id}`)}
      />
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Num
          label="Size"
          value={size}
          min={2}
          onCommit={(v) => {
            const k = v / size;
            update(marker.id, { r: marker.r * k, dotR: marker.dotR * k });
          }}
        />
        <Num
          label="Turn (degrees)"
          value={Math.round((marker.phase * 180) / Math.PI)}
          step={45}
          onCommit={(v) => update(marker.id, { phase: (v * Math.PI) / 180 })}
        />
        <Num label="Centre x" value={marker.cx} onCommit={(v) => update(marker.id, { cx: v })} />
        <Num label="Centre y" value={marker.cy} onCommit={(v) => update(marker.id, { cy: v })} />
      </div>
    </div>
  );
}
