import type { SourceStyle } from '@/lib/detect/types';
import { LIGHT_PRESET, ORIGINAL_ID, ORIGINAL_NAME } from './builtins';
import { PRESET_SCHEMA_VERSION, type Preset } from './types';

/**
 * "Original colours": a preset made from the screenshot itself, so the SVG looks like the
 * chart that was uploaded. It is built fresh for every image and never saved.
 * A type the image has none of (say, no bear candles) falls back to the Light preset's colours.
 */
export function originalPreset(style: SourceStyle | null): Preset {
  return {
    schemaVersion: PRESET_SCHEMA_VERSION,
    id: ORIGINAL_ID,
    name: ORIGINAL_NAME,
    builtIn: true,
    bull: style?.bull ?? LIGHT_PRESET.bull,
    bear: style?.bear ?? LIGHT_PRESET.bear,
    borderWidth: style?.borderWidth ?? LIGHT_PRESET.borderWidth,
    wickWidth: style?.wickWidth ?? LIGHT_PRESET.wickWidth,
    background: style?.background ?? null,
  };
}
