import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { createWorker, PSM } from 'tesseract.js';
import { detect } from '@/lib/detect';
import { labelCrop, tidyText } from '@/lib/ocr/crop';
import type { PixelImage, TextExtra } from '@/lib/detect/types';

const load = (name: string): PixelImage => {
  const p = PNG.sync.read(fs.readFileSync(path.join(__dirname, 'fixtures', name)));
  return { width: p.width, height: p.height, data: p.data };
};

describe('tidyText', () => {
  it('keeps the text and drops stray marks at the ends', () => {
    expect(tidyText('18:00\n')).toBe('18:00');
    expect(tidyText('  | 4523.5 _ ')).toBe('4523.5');
    expect(tidyText('London  Open')).toBe('London Open');
  });
});

describe('the label crop', () => {
  it('is dark letters on a white page, enlarged', () => {
    const image = load('extras-b.png');
    const label = detect(image).extras.find((e) => e.kind === 'text') as TextExtra;
    const crop = labelCrop(image, label.region);
    expect(crop.width).toBeGreaterThan(label.region.width * 3);
    let dark = 0;
    let light = 0;
    for (let i = 0; i < crop.data.length; i += 4) {
      if ((crop.data[i] as number) < 100) dark++;
      else if ((crop.data[i] as number) > 200) light++;
    }
    expect(dark).toBeGreaterThan(100);
    expect(light).toBeGreaterThan(dark); // mostly page
  });

  it('works the same for light text on a dark chart', () => {
    const w = 60;
    const h = 24;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = 19;
      data[i * 4 + 1] = 23;
      data[i * 4 + 2] = 34;
      data[i * 4 + 3] = 255;
    }
    for (let y = 8; y < 16; y++) {
      for (let x = 20; x < 24; x++) {
        const i = (y * w + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 240;
      }
    }
    const crop = labelCrop({ width: w, height: h, data }, { x: 18, y: 6, width: 10, height: 12 });
    let dark = 0;
    for (let i = 0; i < crop.data.length; i += 4) if ((crop.data[i] as number) < 60) dark++;
    expect(dark).toBeGreaterThan(50);
  });
});

describe('reading a real label', () => {
  it.each([
    ['extras-b.png', '18:00'],
    ['extras-c.png', '06:00'],
  ])(
    'reads the time label of %s',
    async (file, expected) => {
      const image = load(file);
      const label = detect(image).extras.find((e) => e.kind === 'text') as TextExtra;
      const crop = labelCrop(image, label.region);
      const png = new PNG({ width: crop.width, height: crop.height });
      png.data = Buffer.from(crop.data);
      const worker = await createWorker('eng', 1, {
        langPath: path.join(process.cwd(), 'node_modules/@tesseract.js-data/eng/4.0.0_best_int'),
        gzip: true,
        cachePath: path.join(process.cwd(), 'node_modules/.cache/tesseract'),
      });
      try {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
        const { data } = await worker.recognize(PNG.sync.write(png));
        expect(tidyText(data.text)).toBe(expected);
        expect(data.confidence).toBeGreaterThan(60);
      } finally {
        await worker.terminate();
      }
    },
    120_000,
  );
});
