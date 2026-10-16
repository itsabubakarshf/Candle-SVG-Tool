'use client';

import type { PointerEvent } from 'react';
import type { Candle } from '@/lib/detect/types';
import type { EdgeKey } from '@/lib/edit/ops';
import { useChartStore, type HandleKey } from '@/store/chartStore';

interface HandlesProps {
  candle: Candle;
  /** CSS pixels per source pixel. */
  cssScale: number;
}

/** Drag step in source px: 0.5 normally, 0.1 with Shift. Arrow keys use the same steps. */
export const COARSE_STEP = 0.5;
export const FINE_STEP = 0.1;

const LABELS: Record<HandleKey, string> = {
  bodyTop: 'body top',
  bodyBottom: 'body bottom',
  wickTop: 'wick top',
  wickBottom: 'wick bottom',
};

export function Handles({ candle, cssScale }: HandlesProps) {
  const activeHandle = useChartStore((s) => s.activeHandle);
  const setActiveHandle = useChartStore((s) => s.setActiveHandle);
  const beginEdit = useChartStore((s) => s.beginEdit);
  const endEdit = useChartStore((s) => s.endEdit);
  const dragEdge = useChartStore((s) => s.dragEdge);

  const r = 5 / cssScale; // constant size on screen
  const handles: Array<{ key: HandleKey; x: number; y: number }> = [
    { key: 'bodyTop', x: candle.bodyRight, y: candle.bodyTop },
    { key: 'bodyBottom', x: candle.bodyRight, y: candle.bodyBottom },
  ];
  if (candle.wickTop !== null)
    handles.push({ key: 'wickTop', x: candle.centerX, y: candle.wickTop });
  if (candle.wickBottom !== null) {
    handles.push({ key: 'wickBottom', x: candle.centerX, y: candle.wickBottom });
  }

  const onDown = (e: PointerEvent<SVGCircleElement>, key: HandleKey, startValue: number) => {
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    setActiveHandle(key);
    beginEdit();
    const startY = e.clientY;
    const move = (ev: globalThis.PointerEvent) => {
      const step = ev.shiftKey ? FINE_STEP : COARSE_STEP;
      const raw = startValue + (ev.clientY - startY) / cssScale;
      dragEdge(candle.id, key as EdgeKey, Math.round(raw / step) * step);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      endEdit();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  return (
    <g>
      {handles.map(({ key, x, y }) => (
        <circle
          key={key}
          data-testid={`handle-${key}`}
          cx={x}
          cy={y}
          r={r}
          fill={activeHandle === key ? '#3B82F6' : '#FFFFFF'}
          stroke="#3B82F6"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          style={{ cursor: 'ns-resize', pointerEvents: 'all' }}
          onPointerDown={(e) => onDown(e, key, candle[key] as number)}
        >
          <title>{`Drag to move the ${LABELS[key]} (Shift = 0.1 px steps)`}</title>
        </circle>
      ))}
    </g>
  );
}
