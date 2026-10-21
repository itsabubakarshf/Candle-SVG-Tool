'use client';

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { BoxExtra, Extra, LineExtra, MarkerExtra, TextExtra } from '@/lib/detect/types';
import { LABEL_FONT, byKind, markerPath } from '@/lib/svg/extras';
import { useChartStore } from '@/store/chartStore';
import { useUiStore } from '@/store/uiStore';

const COARSE = 0.5;
const FINE = 0.1;

/** What the text takes up on the picture, in source pixels. */
export function textBox(t: TextExtra) {
  const w = Math.max(t.region.width, t.text.length * t.size * 0.58, t.size);
  return { x: t.x, y: t.y - t.size * 0.85, width: w, height: t.size * 1.15 };
}

/** The shapes themselves, drawn the same way the SVG export draws them. */
export function ExtraShapes({ extras, layer }: { extras: Extra[]; layer: 'below' | 'above' }) {
  const { boxes, lines, texts, markers } = byKind(extras);
  if (layer === 'below') {
    return (
      <g data-testid="overlay-boxes">
        {boxes.map((b) => (
          <rect
            key={b.id}
            data-extra={b.id}
            x={b.x}
            y={b.y}
            width={b.width}
            height={b.height}
            fill={b.fill}
          />
        ))}
      </g>
    );
  }
  return (
    <g data-testid="overlay-lines">
      {lines.map((l) => (
        <line
          key={l.id}
          data-extra={l.id}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke={l.color}
          strokeWidth={l.width}
          strokeLinecap="butt"
          strokeDasharray={l.dash ? `${l.dash[0]} ${l.dash[1]}` : undefined}
        />
      ))}
      {markers.map((m) => (
        <path key={m.id} data-extra={m.id} d={markerPath(m)} fill={m.color} />
      ))}
      {texts.map((t) =>
        t.text.trim() === '' && t.trace ? (
          <path key={t.id} data-extra={t.id} d={t.trace} fill={t.color} />
        ) : (
          <text
            key={t.id}
            data-extra={t.id}
            x={t.x}
            y={t.y}
            fontFamily={LABEL_FONT}
            fontSize={t.size}
            fill={t.color}
            style={{ whiteSpace: 'pre' }}
          >
            {t.text}
          </text>
        ),
      )}
    </g>
  );
}

/** Clickable, draggable areas for the extras, plus selection handles and the label editor. */
export function ExtraHits({
  extras: all,
  cssScale,
  layer,
}: {
  extras: Extra[];
  cssScale: number;
  /** Boxes sit under the candles (so a candle can still be clicked), lines and labels over them. */
  layer: 'below' | 'above';
}) {
  const extras = all.filter((e) => (e.kind === 'box') === (layer === 'below'));
  const selectedId = useChartStore((s) => s.selectedExtraId);
  const editingId = useChartStore((s) => s.editingExtraId);
  const selectExtra = useChartStore((s) => s.selectExtra);
  const setEditing = useChartStore((s) => s.setEditingExtra);
  const beginEdit = useChartStore((s) => s.beginEdit);
  const endEdit = useChartStore((s) => s.endEdit);
  const dragExtra = useChartStore((s) => s.dragExtra);
  const setTab = useUiStore((s) => s.setTab);
  const px = 1 / cssScale;

  const pick = (e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    selectExtra(id);
    setTab('extras');
  };

  /** Drag helper: calls `move(dx, dy)` with the distance in source px, snapped. */
  const startDrag = (e: ReactPointerEvent, move: (dx: number, dy: number) => void) => {
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);
    beginEdit();
    const sx = e.clientX;
    const sy = e.clientY;
    const onMove = (ev: PointerEvent) => {
      const step = ev.shiftKey ? FINE : COARSE;
      const snap = (v: number) => Math.round(v / step) * step;
      move(snap((ev.clientX - sx) / cssScale), snap((ev.clientY - sy) / cssScale));
    };
    const end = () => {
      target.removeEventListener('pointermove', onMove as EventListener);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      endEdit();
    };
    target.addEventListener('pointermove', onMove as EventListener);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };

  const dragBody = (e: ReactPointerEvent, extra: Extra) => {
    pick(e, extra.id);
    if (extra.kind === 'line') {
      const { x1, y1, x2, y2 } = extra;
      startDrag(e, (dx, dy) =>
        dragExtra(extra.id, { x1: x1 + dx, y1: y1 + dy, x2: x2 + dx, y2: y2 + dy }),
      );
    } else if (extra.kind === 'box') {
      const { x, y } = extra;
      startDrag(e, (dx, dy) => dragExtra(extra.id, { x: x + dx, y: y + dy }));
    } else if (extra.kind === 'marker') {
      const { cx, cy } = extra;
      startDrag(e, (dx, dy) => dragExtra(extra.id, { cx: cx + dx, cy: cy + dy }));
    } else {
      const { x, y, region } = extra;
      startDrag(e, (dx, dy) =>
        dragExtra(extra.id, {
          x: x + dx,
          y: y + dy,
          region: { ...region, x: region.x + dx, y: region.y + dy },
        }),
      );
    }
  };

  return (
    <g data-testid="extra-hits">
      {extras.map((extra) => {
        const selected = extra.id === selectedId;
        if (extra.kind === 'line') {
          return (
            <g key={extra.id}>
              {selected && (
                <line
                  x1={extra.x1}
                  y1={extra.y1}
                  x2={extra.x2}
                  y2={extra.y2}
                  stroke="#3B82F6"
                  strokeWidth={extra.width + 4 * px}
                  strokeOpacity={0.35}
                  pointerEvents="none"
                />
              )}
              <line
                data-testid={`extra-hit-${extra.id}`}
                x1={extra.x1}
                y1={extra.y1}
                x2={extra.x2}
                y2={extra.y2}
                stroke="transparent"
                strokeWidth={Math.max(extra.width, 10 * px)}
                style={{ pointerEvents: 'stroke', cursor: 'move' }}
                onPointerDown={(e) => dragBody(e, extra)}
              />
              {selected && <LineHandles line={extra} r={5 * px} startDrag={startDrag} />}
            </g>
          );
        }
        if (extra.kind === 'box') {
          return (
            <g key={extra.id}>
              <rect
                data-testid={`extra-hit-${extra.id}`}
                x={extra.x}
                y={extra.y}
                width={extra.width}
                height={extra.height}
                fill="transparent"
                stroke={selected ? '#3B82F6' : 'none'}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: 'all', cursor: 'move' }}
                onPointerDown={(e) => dragBody(e, extra)}
              />
              {selected && <BoxHandles box={extra} r={5 * px} startDrag={startDrag} />}
            </g>
          );
        }
        if (extra.kind === 'marker') {
          const outer = extra.r + extra.dotR;
          return (
            <g key={extra.id}>
              <circle
                data-testid={`extra-hit-${extra.id}`}
                cx={extra.cx}
                cy={extra.cy}
                r={outer + 2 * px}
                fill="transparent"
                stroke={selected ? '#3B82F6' : 'none'}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: 'all', cursor: 'move' }}
                onPointerDown={(e) => dragBody(e, extra)}
              >
                <title>Sticker. Drag to move, pull the handle to resize.</title>
              </circle>
              {selected && <MarkerHandle marker={extra} r={5 * px} startDrag={startDrag} />}
            </g>
          );
        }
        const box = textBox(extra);
        const empty = extra.text.trim() === '';
        return (
          <g key={extra.id}>
            {(selected || empty) && (
              <rect
                x={box.x - 2 * px}
                y={box.y - 2 * px}
                width={box.width + 4 * px}
                height={box.height + 4 * px}
                fill={empty ? 'rgba(245,158,11,0.12)' : 'rgba(59,130,246,0.08)'}
                stroke={empty ? '#F59E0B' : '#3B82F6'}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
            {empty && (
              <text
                x={box.x + box.width / 2}
                y={box.y + box.height / 2}
                fontSize={Math.max(10, extra.size)}
                fill="#F59E0B"
                textAnchor="middle"
                dominantBaseline="central"
                pointerEvents="none"
              >
                ?
              </text>
            )}
            <rect
              data-testid={`extra-hit-${extra.id}`}
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              fill="transparent"
              style={{ pointerEvents: 'all', cursor: 'move' }}
              onPointerDown={(e) => dragBody(e, extra)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditing(extra.id);
              }}
            >
              <title>
                {empty ? 'Could not be read. Double-click to type it.' : 'Double-click to edit'}
              </title>
            </rect>
            {editingId === extra.id && <LabelEditor label={extra} />}
          </g>
        );
      })}
    </g>
  );
}

type StartDrag = (e: ReactPointerEvent, move: (dx: number, dy: number) => void) => void;

function Dot({
  x,
  y,
  r,
  testId,
  cursor,
  onDown,
}: {
  x: number;
  y: number;
  r: number;
  testId: string;
  cursor: string;
  onDown: (e: ReactPointerEvent<SVGCircleElement>) => void;
}) {
  return (
    <circle
      data-testid={testId}
      cx={x}
      cy={y}
      r={r}
      fill="#FFFFFF"
      stroke="#3B82F6"
      strokeWidth={1.5}
      vectorEffect="non-scaling-stroke"
      style={{ cursor, pointerEvents: 'all' }}
      onPointerDown={onDown}
    />
  );
}

function LineHandles({ line, r, startDrag }: { line: LineExtra; r: number; startDrag: StartDrag }) {
  const dragExtra = useChartStore((s) => s.dragExtra);
  const { x1, y1, x2, y2 } = line;
  return (
    <>
      <Dot
        x={x1}
        y={y1}
        r={r}
        testId={`extra-handle-start`}
        cursor="crosshair"
        onDown={(e) => startDrag(e, (dx, dy) => dragExtra(line.id, { x1: x1 + dx, y1: y1 + dy }))}
      />
      <Dot
        x={x2}
        y={y2}
        r={r}
        testId={`extra-handle-end`}
        cursor="crosshair"
        onDown={(e) => startDrag(e, (dx, dy) => dragExtra(line.id, { x2: x2 + dx, y2: y2 + dy }))}
      />
    </>
  );
}

function BoxHandles({ box, r, startDrag }: { box: BoxExtra; r: number; startDrag: StartDrag }) {
  const dragExtra = useChartStore((s) => s.dragExtra);
  const { x, y, width, height } = box;
  const right = x + width;
  const bottom = y + height;
  const min = 1;
  return (
    <>
      <Dot
        x={x}
        y={y}
        r={r}
        testId="extra-handle-tl"
        cursor="nwse-resize"
        onDown={(e) =>
          startDrag(e, (dx, dy) => {
            const nx = Math.min(x + dx, right - min);
            const ny = Math.min(y + dy, bottom - min);
            dragExtra(box.id, { x: nx, y: ny, width: right - nx, height: bottom - ny });
          })
        }
      />
      <Dot
        x={right}
        y={y}
        r={r}
        testId="extra-handle-tr"
        cursor="nesw-resize"
        onDown={(e) =>
          startDrag(e, (dx, dy) => {
            const ny = Math.min(y + dy, bottom - min);
            dragExtra(box.id, { y: ny, width: Math.max(min, width + dx), height: bottom - ny });
          })
        }
      />
      <Dot
        x={x}
        y={bottom}
        r={r}
        testId="extra-handle-bl"
        cursor="nesw-resize"
        onDown={(e) =>
          startDrag(e, (dx, dy) => {
            const nx = Math.min(x + dx, right - min);
            dragExtra(box.id, { x: nx, width: right - nx, height: Math.max(min, height + dy) });
          })
        }
      />
      <Dot
        x={right}
        y={bottom}
        r={r}
        testId="extra-handle-br"
        cursor="nwse-resize"
        onDown={(e) =>
          startDrag(e, (dx, dy) =>
            dragExtra(box.id, {
              width: Math.max(min, width + dx),
              height: Math.max(min, height + dy),
            }),
          )
        }
      />
    </>
  );
}

/** One handle at the lower right of the ring; dragging it scales the whole sticker. */
function MarkerHandle({
  marker,
  r,
  startDrag,
}: {
  marker: MarkerExtra;
  r: number;
  startDrag: StartDrag;
}) {
  const dragExtra = useChartStore((s) => s.dragExtra);
  const { cx, cy, r: ringR, dotR } = marker;
  const outer = ringR + dotR;
  const d = outer / Math.SQRT2;
  return (
    <Dot
      x={cx + d}
      y={cy + d}
      r={r}
      testId="extra-handle-size"
      cursor="nwse-resize"
      onDown={(e) =>
        startDrag(e, (dx, dy) => {
          const k = Math.max(0.1, (outer + (dx + dy) / Math.SQRT2) / outer);
          dragExtra(marker.id, { r: ringR * k, dotR: dotR * k });
        })
      }
    />
  );
}

/** A text field on the picture, where the label is. Enter or leaving it keeps the text. */
function LabelEditor({ label }: { label: TextExtra }) {
  const updateExtra = useChartStore((s) => s.updateExtra);
  const setEditing = useChartStore((s) => s.setEditingExtra);
  const input = useRef<HTMLInputElement>(null);
  const box = textBox(label);
  const width = Math.max(box.width + label.size * 2, label.size * 8);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const finish = (keep: boolean) => {
    const value = input.current?.value ?? label.text;
    if (keep && value !== label.text) {
      updateExtra(label.id, { text: value, unread: value.trim() === '' }, `text:${label.id}`);
    }
    setEditing(null);
  };

  return (
    <foreignObject
      x={box.x - 4}
      y={box.y - 4}
      width={width + 8}
      height={box.height + 8}
      style={{ pointerEvents: 'all' }}
    >
      <input
        ref={input}
        data-testid="label-editor"
        aria-label="Label text"
        defaultValue={label.text}
        spellCheck={false}
        onKeyDown={(e) => {
          e.stopPropagation(); // typing must not trigger the shortcuts
          if (e.key === 'Enter') finish(true);
          else if (e.key === 'Escape') finish(false);
        }}
        onBlur={() => finish(true)}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          fontFamily: LABEL_FONT,
          fontSize: label.size,
          fontWeight: label.weight ?? 400,
          lineHeight: 1.15,
          padding: '0 2px',
          color: '#111',
          background: '#fff',
          border: '1px solid #3B82F6',
          outline: 'none',
        }}
      />
    </foreignObject>
  );
}
