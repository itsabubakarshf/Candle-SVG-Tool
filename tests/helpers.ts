import { expect } from 'vitest';
import type { Candle } from '@/lib/detect/types';
import type { TruthCandle } from './synth/generate';

export interface ErrorRow {
  label: string;
  count: number;
  maxErr: number;
  worstField: string;
  fields: Record<string, number>;
}

export const REPORT: ErrorRow[] = [];

const FIELDS = [
  'centerX',
  'bodyLeft',
  'bodyRight',
  'bodyTop',
  'bodyBottom',
  'wickTop',
  'wickBottom',
] as const;

/**
 * Compares detected candles with ground truth and records the worst error per field.
 * Structure (count, type, missing wicks, doji flag) must match exactly.
 */
export function compare(label: string, detected: Candle[], truth: TruthCandle[], tol: number) {
  expect(detected.length, `${label}: candle count`).toBe(truth.length);
  const fields: Record<string, number> = {};
  detected.forEach((d, i) => {
    const t = truth[i] as TruthCandle;
    expect(d.type, `${label}: candle ${i + 1} type`).toBe(t.type);
    expect(d.isDoji, `${label}: candle ${i + 1} doji`).toBe(t.isDoji);
    for (const f of FIELDS) {
      const dv = d[f];
      const tv = t[f];
      if (tv === null || dv === null) {
        expect(dv, `${label}: candle ${i + 1} ${f} presence`).toBe(tv);
        continue;
      }
      fields[f] = Math.max(fields[f] ?? 0, Math.abs(dv - tv));
    }
  });
  let worstField = '-';
  let maxErr = 0;
  for (const [f, v] of Object.entries(fields)) {
    if (v > maxErr) {
      maxErr = v;
      worstField = f;
    }
  }
  REPORT.push({ label, count: detected.length, maxErr, worstField, fields });
  expect(maxErr, `${label}: worst error is ${worstField}`).toBeLessThanOrEqual(tol);
}

export function printReport(): void {
  const lines = ['', 'ACCURACY (max error in source px, target <= 0.5)', ''];
  const width = Math.max(...REPORT.map((r) => r.label.length));
  for (const r of REPORT) {
    lines.push(
      `${r.label.padEnd(width)}  n=${String(r.count).padStart(2)}  max ${r.maxErr.toFixed(3)}  (${r.worstField})`,
    );
  }
  console.log(lines.join('\n'));
}
