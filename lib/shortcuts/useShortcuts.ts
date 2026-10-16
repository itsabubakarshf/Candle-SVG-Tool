'use client';

import { useEffect } from 'react';
import { copySvg } from '@/lib/export/actions';
import { COARSE_STEP, FINE_STEP } from '@/components/Handles';
import { useChartStore } from '@/store/chartStore';
import { useUiStore } from '@/store/uiStore';

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: 'Ctrl + V', action: 'Paste a screenshot (anywhere on the page)' },
  { keys: 'Ctrl + C', action: 'Copy the SVG (when you are not editing text)' },
  { keys: 'T', action: 'Flip the selected candle between bull and bear' },
  { keys: 'Delete / Backspace', action: 'Delete the selected candle' },
  { keys: 'Ctrl + Z', action: 'Undo' },
  { keys: 'Ctrl + Shift + Z', action: 'Redo (Ctrl + Y also works)' },
  { keys: 'Esc', action: 'Clear the selection' },
  { keys: '← / →', action: 'Select the previous / next candle' },
  { keys: '↑ / ↓', action: 'Nudge the active handle by 0.5 px (Shift: 0.1 px)' },
  { keys: 'Shift + click', action: 'Add a candle to the selection' },
  { keys: 'Scroll', action: 'Zoom the canvas' },
  { keys: 'Space + drag', action: 'Pan the canvas' },
  { keys: '?', action: 'Show this list' },
];

/** Global keyboard shortcuts. Ctrl+V paste lives in useImageIntake. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const chart = useChartStore.getState();
      const ui = useUiStore.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (e.key === 'Escape') {
        if (ui.shortcutsOpen) ui.setShortcutsOpen(false);
        else if (!isEditable(e.target)) chart.clearSelection();
        return;
      }
      if (isEditable(e.target)) return; // let text fields keep their own keys

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) chart.redo();
        else chart.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        chart.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'c') {
        // Keep normal copy when the user has selected text somewhere.
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        void copySvg();
        return;
      }
      if (mod || e.altKey) return;

      if (e.key === '?') {
        e.preventDefault();
        ui.setShortcutsOpen(!ui.shortcutsOpen);
        return;
      }
      if (e.key.toLowerCase() === 't') {
        if (chart.selectedIds.length > 0) {
          e.preventDefault();
          chart.flipSelected();
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (chart.selectedIds.length > 0) {
          e.preventDefault();
          chart.deleteSelected();
        }
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const sorted = [...chart.candles].sort((a, b) => a.centerX - b.centerX);
        if (sorted.length === 0) return;
        e.preventDefault();
        const current = sorted.findIndex((c) => c.id === chart.selectedIds[0]);
        const delta = e.key === 'ArrowRight' ? 1 : -1;
        const next = current < 0 ? (delta > 0 ? 0 : sorted.length - 1) : current + delta;
        const target = sorted[Math.min(sorted.length - 1, Math.max(0, next))];
        if (target) chart.select(target.id, false);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const handle = chart.activeHandle;
        const id = chart.selectedIds.length === 1 ? chart.selectedIds[0] : undefined;
        const candle = chart.candles.find((c) => c.id === id);
        if (!handle || !candle || id === undefined) return;
        const current = candle[handle];
        if (current === null) return;
        e.preventDefault();
        const step = e.shiftKey ? FINE_STEP : COARSE_STEP;
        chart.setEdgeValue(id, handle, current + (e.key === 'ArrowDown' ? step : -step));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
