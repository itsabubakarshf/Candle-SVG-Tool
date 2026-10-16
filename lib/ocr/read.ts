import { labelCrop, tidyText } from './crop';
import type { PixelImage, TextExtra } from '@/lib/detect/types';

/** Below this the recogniser is guessing: the label is left for the user to type. */
const MIN_CONFIDENCE = 45;

interface Recogniser {
  recognize(input: HTMLCanvasElement): Promise<{ data: { text: string; confidence: number } }>;
}

let shared: Promise<Recogniser> | null = null;

/** The recogniser files are served by this app itself (see scripts/copy-ocr-assets.mjs). */
function recogniser(): Promise<Recogniser> {
  shared ??= (async () => {
    const { createWorker, PSM } = await import('tesseract.js');
    const worker = await createWorker('eng', 1, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr',
      langPath: '/ocr/lang',
      gzip: true,
      logger: () => undefined,
    });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    return worker as unknown as Recogniser;
  })().catch((error: unknown) => {
    shared = null; // try again next time
    throw error;
  });
  return shared;
}

async function pixelsOf(file: Blob): Promise<PixelImage> {
  const bitmap = await createImageBitmap(file, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0);
    const d = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: d.width, height: d.height, data: d.data };
  } finally {
    bitmap.close();
  }
}

export interface ReadLabel {
  id: string;
  /** null when it could not be read. */
  text: string | null;
}

/**
 * Reads the text of each label with an OCR library that runs inside the browser. Nothing is
 * uploaded: the library and its language file come from this site.
 */
export async function readLabels(file: Blob, labels: TextExtra[]): Promise<ReadLabel[]> {
  if (labels.length === 0) return [];
  const [worker, image] = await Promise.all([recogniser(), pixelsOf(file)]);
  const out: ReadLabel[] = [];
  for (const label of labels) {
    const crop = labelCrop(image, label.from ?? label.region);
    const canvas = document.createElement('canvas');
    canvas.width = crop.width;
    canvas.height = crop.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      out.push({ id: label.id, text: null });
      continue;
    }
    ctx.putImageData(new ImageData(crop.data, crop.width, crop.height), 0, 0);
    const { data } = await worker.recognize(canvas);
    const text = tidyText(data.text);
    out.push({ id: label.id, text: text && data.confidence >= MIN_CONFIDENCE ? text : null });
  }
  return out;
}
