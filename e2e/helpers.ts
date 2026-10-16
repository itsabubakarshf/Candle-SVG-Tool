import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import {
  HOLLOW_STYLE,
  layout,
  renderChart,
  type SynthCandle,
  type SynthChart,
} from '../tests/synth/generate';

export const SAMPLE = path.join(__dirname, '..', 'tests', 'fixtures', 'abbi-sample-5-candles.png');

/** A PNG of a synthetic chart with known candles. */
export function pngBuffer(chart: SynthChart): Buffer {
  const { image } = renderChart(chart);
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  return PNG.sync.write(png);
}

export function simpleChart(widths: number[]): SynthChart {
  const specs: Array<Omit<SynthCandle, 'centerX'>> = widths.map((w, i) => ({
    type: i % 2 ? 'bear' : 'bull',
    bodyTop: 100 + i * 5,
    bodyBottom: 160 + i * 5,
    wickTop: 70,
    wickBottom: 190,
    bodyWidth: w,
  }));
  return layout(specs, { style: HOLLOW_STYLE, pitch: 50, height: 260 });
}

export async function loadSample(page: Page): Promise<void> {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', SAMPLE);
  await expect(page.getByTestId('candle-count')).toHaveText('5 candles');
}

export async function loadBuffer(page: Page, buffer: Buffer, name = 'chart.png'): Promise<void> {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', { name, mimeType: 'image/png', buffer });
}

/** Presses Copy SVG and returns what landed on the clipboard. */
export async function copiedSvg(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Copy SVG' }).first().click();
  await expect(page.getByText('SVG copied. Paste in Figma with Ctrl+V.').first()).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
}

/** The <g id="Candle NN"> blocks of an SVG, one string each. */
export function candleGroups(svg: string): string[] {
  return svg
    .split('<g id="')
    .slice(1)
    .map((g) => g.split('</g>')[0] ?? '');
}

export function decodePng(buffer: Buffer): PNG {
  return PNG.sync.read(buffer);
}
