import { PRESET_SCHEMA_VERSION, type Preset } from './types';

// The ids keep their original text so a saved "active preset" still matches after the rename.
export const LIGHT_ID = 'builtin-abbi-light';
export const DARK_ID = 'builtin-abbi-dark';

export const LIGHT_PRESET: Preset = {
  schemaVersion: PRESET_SCHEMA_VERSION,
  id: LIGHT_ID,
  name: 'Light',
  builtIn: true,
  bull: { body: '#FFFFFF', border: '#2B2F36', wick: '#2B2F36' },
  bear: { body: '#2B2F36', border: '#2B2F36', wick: '#2B2F36' },
  borderWidth: 1,
  wickWidth: 1,
  background: null,
};

/** The Light preset mirrored for dark cards: light lines, dark hollow bull, light bear. */
export const DARK_PRESET: Preset = {
  schemaVersion: PRESET_SCHEMA_VERSION,
  id: DARK_ID,
  name: 'Dark',
  builtIn: true,
  bull: { body: '#14161A', border: '#E6E8EC', wick: '#E6E8EC' },
  bear: { body: '#E6E8EC', border: '#E6E8EC', wick: '#E6E8EC' },
  borderWidth: 1,
  wickWidth: 1,
  background: null,
};

export const BUILT_IN_PRESETS: Preset[] = [LIGHT_PRESET, DARK_PRESET];
