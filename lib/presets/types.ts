import type { CandleColors } from '@/lib/detect/types';

export const PRESET_SCHEMA_VERSION = 1 as const;

export interface Preset {
  schemaVersion: typeof PRESET_SCHEMA_VERSION;
  id: string;
  name: string;
  builtIn: boolean;
  bull: CandleColors;
  bear: CandleColors;
  borderWidth: number;
  wickWidth: number;
  /** Hex colour, or null for a transparent background. */
  background: string | null;
}
