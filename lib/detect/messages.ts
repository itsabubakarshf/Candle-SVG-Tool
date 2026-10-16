import type { DetectSettings, DetectionResult } from './types';

export interface DetectRequest {
  id: number;
  file: Blob;
  settings: DetectSettings;
}

export type DetectResponse =
  { id: number; ok: true; result: DetectionResult } | { id: number; ok: false; error: string };
