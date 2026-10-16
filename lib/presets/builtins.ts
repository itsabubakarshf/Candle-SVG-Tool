import { PRESET_SCHEMA_VERSION, type Preset } from './types';

export const ABBI_LIGHT_ID = 'builtin-abbi-light';
export const ABBI_DARK_ID = 'builtin-abbi-dark';

export const ABBI_LIGHT: Preset = {
  schemaVersion: PRESET_SCHEMA_VERSION,
  id: ABBI_LIGHT_ID,
  name: 'Abbi Light',
  builtIn: true,
  bull: { body: '#FFFFFF', border: '#2B2F36', wick: '#2B2F36' },
  bear: { body: '#2B2F36', border: '#2B2F36', wick: '#2B2F36' },
  borderWidth: 1,
  wickWidth: 1,
  background: null,
};

/** The light preset mirrored for dark cards: light lines, dark hollow bull, light bear. */
export const ABBI_DARK: Preset = {
  schemaVersion: PRESET_SCHEMA_VERSION,
  id: ABBI_DARK_ID,
  name: 'Abbi Dark',
  builtIn: true,
  bull: { body: '#14161A', border: '#E6E8EC', wick: '#E6E8EC' },
  bear: { body: '#E6E8EC', border: '#E6E8EC', wick: '#E6E8EC' },
  borderWidth: 1,
  wickWidth: 1,
  background: null,
};

export const BUILT_IN_PRESETS: Preset[] = [ABBI_LIGHT, ABBI_DARK];
