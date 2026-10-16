'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Loader2 } from 'lucide-react';
import { useDevicePixelRatio } from '@/lib/image/useDevicePixelRatio';
import type { LoadedImage } from '@/lib/image/loadImage';
import { useChartStore } from '@/store/chartStore';
import { useUiStore } from '@/store/uiStore';
import { CandleOverlay } from './CandleOverlay';
import { CanvasToolbar } from './CanvasToolbar';

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 32;
const MARGIN = 24;

interface View {
  zoom: number;
  x: number;
  y: number;
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export function CanvasView() {
  const image = useChartStore((s) => s.image);
  if (!image) return null;
  return <Viewer key={image.url} image={image} />;
}

function Viewer({ image }: { image: LoadedImage }) {
  const dpr = useDevicePixelRatio();
  const status = useChartStore((s) => s.status);
  const error = useChartStore((s) => s.error);
  const count = useChartStore((s) => s.candles.length);
  const clearSelection = useChartStore((s) => s.clearSelection);
  const addText = useChartStore((s) => s.addText);
  const setTab = useUiStore((s) => s.setTab);
  const showScreenshot = useUiStore((s) => s.showScreenshot);

  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const hovering = useRef(false);
  const placed = useRef(false);

  // CSS pixels per source pixel. zoom 1 = one source pixel per device pixel (crisp).
  const cssScale = view.zoom / dpr;
  const contentW = image.width * cssScale;
  const contentH = image.height * cssScale;

  const fitTo = useCallback(
    (maxZoom: number): View => {
      const zoom = clampZoom(
        Math.min(
          ((size.w - 2 * MARGIN) * dpr) / image.width,
          ((size.h - 2 * MARGIN) * dpr) / image.height,
          maxZoom,
        ),
      );
      const s = zoom / dpr;
      // Whole pixels, so the image stays crisp at 1:1.
      return {
        zoom,
        x: Math.round((size.w - image.width * s) / 2),
        y: Math.round((size.h - image.height * s) / 2),
      };
    },
    [size, dpr, image.width, image.height],
  );

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // First view of a new screenshot: actual size if it fits, otherwise fit to screen.
  useEffect(() => {
    if (placed.current || size.w === 0 || size.h === 0) return;
    placed.current = true;
    setView(fitTo(1));
  }, [size, fitTo]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setView((v) => {
      const zoom = clampZoom(v.zoom * factor);
      const ratio = zoom / v.zoom;
      return { zoom, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
    });
  }, []);

  // Scroll to zoom around the cursor. Needs a non-passive listener to stop page scrolling.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // Space + drag pans.
  useEffect(() => {
    const editable = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || editable(e.target) || !hovering.current) return;
      e.preventDefault();
      setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const onPointerDownCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!(spaceHeld || e.button === 1)) return;
    e.preventDefault();
    e.stopPropagation(); // do not select a candle underneath
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setPanning(true);
    let lastX = e.clientX;
    let lastY = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    };
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      setPanning(false);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  const center = () => ({ x: size.w / 2, y: size.h / 2 });

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">
          {image.name} · {image.width} × {image.height} px ·{' '}
          <span data-testid="canvas-count">
            {count} {count === 1 ? 'candle' : 'candles'}
          </span>
        </span>
        <span className="hidden shrink-0 sm:inline">Scroll to zoom · Space + drag to pan</span>
      </div>
      <CanvasToolbar
        zoom={view.zoom}
        onZoomIn={() => zoomAt(1.25, center().x, center().y)}
        onZoomOut={() => zoomAt(1 / 1.25, center().x, center().y)}
        onFit={() => setView(fitTo(MAX_ZOOM))}
        onActualSize={() => zoomAt(1 / view.zoom, center().x, center().y)}
      />
      <div
        ref={viewport}
        data-testid="viewport"
        className="relative min-h-72 flex-1 touch-none overflow-hidden rounded-lg border border-border bg-muted"
        style={{ cursor: panning ? 'grabbing' : spaceHeld ? 'grab' : 'default' }}
        onPointerEnter={() => (hovering.current = true)}
        onPointerLeave={() => (hovering.current = false)}
        onPointerDownCapture={onPointerDownCapture}
        onPointerDown={() => clearSelection()}
      >
        <div
          data-testid="content"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: contentW,
            height: contentH,
            transform: `translate(${view.x}px, ${view.y}px)`,
          }}
          onDoubleClick={(e) => {
            // double-clicking empty space (the picture itself) adds a label there
            if (!(e.target instanceof HTMLImageElement)) return;
            const box = e.currentTarget.getBoundingClientRect();
            const x = Math.round(((e.clientX - box.left) / cssScale) * 2) / 2;
            const y = Math.round(((e.clientY - box.top) / cssScale) * 2) / 2;
            addText(x, y);
            setTab('extras');
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, must stay untouched */}
          <img
            src={image.url}
            alt="Uploaded candle screenshot"
            width={contentW}
            height={contentH}
            draggable={false}
            style={{
              display: 'block',
              width: contentW,
              height: contentH,
              maxWidth: 'none',
              opacity: showScreenshot ? 1 : 0,
              imageRendering: view.zoom >= 2 ? 'pixelated' : 'auto',
              userSelect: 'none',
            }}
          />
          <CandleOverlay width={image.width} height={image.height} cssScale={cssScale} />
        </div>

        {status === 'running' && (
          <div
            role="status"
            className="absolute left-3 top-3 flex items-center gap-2 rounded-md bg-background/90 px-3 py-1.5 text-sm shadow"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Detecting candles…
          </div>
        )}
        {status === 'error' && error && (
          <div
            role="alert"
            className="absolute inset-x-3 top-3 rounded-md border border-red-500/40 bg-background/95 px-3 py-2 text-sm text-red-600 shadow dark:text-red-400"
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
