import { PRESET_SCHEMA_VERSION, type Preset } from './types';

// The ids keep their original text so a saved "active preset" still matches after the rename.
/** Not a stored preset: the look measured from the uploaded screenshot (see original.ts). */
export const ORIGINAL_ID = 'original';
export const ORIGINAL_NAME = 'Original colors';

export const LIGHT_ID = 'builtin-abbi-light';
export const MO_ID = 'builtin-mo';

export const LIGHT_PRESET: Preset = {
  schemaVersion: PRESET_SCHEMA_VERSION,
  id: LIGHT_ID,
  name: 'Abbi',
  builtIn: true,
  bull: { body: '#FFFFFF', border: '#2B2F36', wick: '#2B2F36' },
  bear: { body: '#2B2F36', border: '#2B2F36', wick: '#2B2F36' },
  borderWidth: 1,
  wickWidth: 1,
  background: null,
};

/** Soft grey bull on a dark-grey bear. */
export const MO_PRESET: Preset = {
  schemaVersion: PRESET_SCHEMA_VERSION,
  id: MO_ID,
  name: 'Mo',
  builtIn: true,
  bull: { body: '#F4F4F4', border: '#B0B0B0', wick: '#B0B0B0' },
  bear: { body: '#3A3A3A', border: '#4A4A4A', wick: '#4A4A4A' },
  borderWidth: 1,
  wickWidth: 1,
  background: null,
};

export const BUILT_IN_PRESETS: Preset[] = [LIGHT_PRESET, MO_PRESET];
