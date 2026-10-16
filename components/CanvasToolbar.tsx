'use client';

import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useUiStore } from '@/store/uiStore';

interface CanvasToolbarProps {
  /** 1 = one source pixel per screen pixel. */
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onActualSize: () => void;
}

export function CanvasToolbar({
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
  onActualSize,
}: CanvasToolbarProps) {
  const opacity = useUiStore((s) => s.overlayOpacity);
  const setOpacity = useUiStore((s) => s.setOverlayOpacity);
  const show = useUiStore((s) => s.showScreenshot);
  const setShow = useUiStore((s) => s.setShowScreenshot);

  return (
    <div
      role="toolbar"
      aria-label="Canvas"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground"
    >
      <div className="flex w-44 items-center gap-2">
        <label id="overlay-opacity-label" className="shrink-0">
          SVG opacity
        </label>
        <Slider
          aria-labelledby="overlay-opacity-label"
          min={0}
          max={100}
          step={5}
          value={[Math.round(opacity * 100)]}
          onValueChange={([v]) => setOpacity((v ?? 100) / 100)}
        />
        <span className="w-8 text-right tabular-nums">{Math.round(opacity * 100)}%</span>
      </div>
      <label className="flex items-center gap-2">
        <Switch checked={show} onCheckedChange={setShow} aria-label="Show screenshot" />
        Show screenshot
      </label>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onZoomOut}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <button
          type="button"
          onClick={onActualSize}
          className="w-14 rounded px-1 text-center tabular-nums hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Actual size (one source pixel per screen pixel)"
          aria-label={`Zoom ${Math.round(zoom * 100)} percent. Click for actual size`}
        >
          {Math.round(zoom * 100)}%
        </button>
        <Button variant="ghost" size="icon" onClick={onZoomIn} aria-label="Zoom in" title="Zoom in">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onFit}
          aria-label="Fit to screen"
          title="Fit to screen"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
