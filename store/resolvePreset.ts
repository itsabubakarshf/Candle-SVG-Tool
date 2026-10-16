import { useMemo } from 'react';
import type { SourceStyle } from '@/lib/detect/types';
import { LIGHT_PRESET, ORIGINAL_ID } from '@/lib/presets/builtins';
import { originalPreset } from '@/lib/presets/original';
import type { Preset } from '@/lib/presets/types';
import { useChartStore } from './chartStore';
import { usePresetStore } from './presetStore';

interface PresetChoice {
  presets: Preset[];
  activeId: string;
  draft: Preset | null;
}

/**
 * The preset to draw and export with. "Original colours" is built from the screenshot;
 * otherwise unsaved edits win over the saved preset so the preview is live.
 */
export function resolvePreset(choice: PresetChoice, source: SourceStyle | null): Preset {
  if (choice.activeId === ORIGINAL_ID) return originalPreset(source);
  return choice.draft ?? choice.presets.find((p) => p.id === choice.activeId) ?? LIGHT_PRESET;
}

export function useResolvedPreset(): Preset {
  const presets = usePresetStore((s) => s.presets);
  const activeId = usePresetStore((s) => s.activeId);
  const draft = usePresetStore((s) => s.draft);
  const source = useChartStore((s) => s.result?.sourceStyle ?? null);
  return useMemo(
    () => resolvePreset({ presets, activeId, draft }, source),
    [presets, activeId, draft, source],
  );
}

/** For code outside React (export actions). */
export function getResolvedPreset(): Preset {
  return resolvePreset(
    usePresetStore.getState(),
    useChartStore.getState().result?.sourceStyle ?? null,
  );
}
