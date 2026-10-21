'use client';

import type { PointerEvent } from 'react';
import { candleShape } from '@/lib/svg/geometry';
import { LOW_CONFIDENCE_THRESHOLD, useChartStore } from '@/store/chartStore';
import { useResolvedPreset } from '@/store/resolvePreset';
import { useUiStore } from '@/store/uiStore';
import { ExtraHits, ExtraShapes } from './ExtraLayers';
import { Handles } from './Handles';

interface CandleOverlayProps {
  width: number;
  height: number;
  /** CSS pixels per source pixel. */
  cssScale: number;
}

/** The SVG drawn over the screenshot, in source-image pixels, plus selection and flags. */
export function CandleOverlay({ width, height, cssScale }: CandleOverlayProps) {
  const candles = useChartStore((s) => s.candles);
  const extras = useChartStore((s) => s.extras);
  const background = useChartStore((s) => s.result?.background);
  const selectedIds = useChartStore((s) => s.selectedIds);
  const select = useChartStore((s) => s.select);
  const preset = useResolvedPreset();
  const opacity = useUiStore((s) => s.overlayOpacity);
  const tab = useUiStore((s) => s.tab);
  const setTab = useUiStore((s) => s.setTab);

  const ordered = [...candles].sort((a, b) => a.centerX - b.centerX);
  const px = 1 / cssScale;
  const selected =
    selectedIds.length === 1 ? ordered.find((c) => c.id === selectedIds[0]) : undefined;

  const onPick = (e: PointerEvent<SVGRectElement>, id: string) => {
    e.stopPropagation();
    const svg = e.currentTarget.ownerSVGElement;
    const box = svg?.getBoundingClientRect();
    const x = box && box.width > 0 ? ((e.clientX - box.left) * width) / box.width : undefined;
    select(id, e.shiftKey, x);
    if (tab === 'detect') setTab('candle');
  };

  return (
    <svg
      data-testid="overlay"
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      {/* a typed label or a sticker replaces what is in the screenshot: covered, not doubled */}
      <g data-testid="text-covers">
        {extras.map((e) =>
          e.kind === 'text' && e.text.trim() !== '' && e.from && background ? (
            <rect
              key={e.id}
              x={e.from.x - 1}
              y={e.from.y - 1}
              width={e.from.width + 2}
              height={e.from.height + 2}
              fill={`rgb(${background[0]},${background[1]},${background[2]})`}
            />
          ) : e.kind === 'box' && e.opacity !== undefined && e.opacity < 1 && background ? (
            <rect
              key={e.id}
              x={e.x}
              y={e.y}
              width={e.width}
              height={e.height}
              fill={`rgb(${background[0]},${background[1]},${background[2]})`}
            />
          ) : e.kind === 'marker' && e.from && background ? (
            <circle
              key={e.id}
              cx={e.from.cx}
              cy={e.from.cy}
              r={e.from.r + 1.5}
              fill={`rgb(${background[0]},${background[1]},${background[2]})`}
            />
          ) : null,
        )}
      </g>
      <g opacity={opacity} data-testid="overlay-shapes">
        <ExtraShapes extras={extras} layer="below" />
        {ordered.map((c, i) => {
          const s = candleShape(c, i, preset);
          return (
            <g key={c.id} data-candle={s.name}>
              {s.wicks.map((w) => (
                <line
                  key={w.id}
                  x1={w.x}
                  x2={w.x}
                  y1={w.y1}
                  y2={w.y2}
                  stroke={w.stroke}
                  strokeWidth={w.strokeWidth}
                  strokeLinecap="butt"
                />
              ))}
              <rect
                x={s.body.x}
                y={s.body.y}
                width={s.body.width}
                height={s.body.height}
                fill={s.body.fill}
                stroke={s.body.bar ? 'none' : s.body.stroke}
                strokeWidth={s.body.bar ? 0 : s.body.strokeWidth}
              />
            </g>
          );
        })}
        <ExtraShapes extras={extras} layer="above" />
      </g>

      <ExtraHits extras={extras} cssScale={cssScale} layer="below" />

      {ordered.map((c, i) => {
        const top = (c.wickTop ?? c.bodyTop) - 2 * px;
        const bottom = (c.wickBottom ?? c.bodyBottom) + 2 * px;
        const left = c.bodyLeft - 2 * px;
        const w = c.bodyRight - c.bodyLeft + 4 * px;
        const isSelected = selectedIds.includes(c.id);
        const flagged = c.confidence < LOW_CONFIDENCE_THRESHOLD;
        return (
          <g key={c.id}>
            {isSelected && (
              <rect
                data-testid={`selected-${i + 1}`}
                x={left}
                y={top}
                width={w}
                height={bottom - top}
                fill="rgba(59,130,246,0.10)"
                stroke="#3B82F6"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
            <rect
              data-testid={`hit-${i + 1}`}
              x={left}
              y={top}
              width={w}
              height={bottom - top}
              fill="transparent"
              style={{ pointerEvents: 'all', cursor: 'pointer' }}
              onPointerDown={(e) => onPick(e, c.id)}
            />
            {flagged && (
              <circle
                data-testid={`flag-${i + 1}`}
                cx={c.centerX}
                cy={top - 7 * px}
                r={4.5 * px}
                fill="#F59E0B"
                stroke="#FFFFFF"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              >
                <title>{`Low confidence (${c.confidence.toFixed(2)}). Check this candle.`}</title>
              </circle>
            )}
          </g>
        );
      })}

      <ExtraHits extras={extras} cssScale={cssScale} layer="above" />

      {selected && <Handles candle={selected} cssScale={cssScale} />}
    </svg>
  );
}
