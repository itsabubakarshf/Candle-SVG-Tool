/**
 * Runs candle detection off the main thread (FR-2, NFR-3). The image is decoded here and
 * never leaves the browser. No resizing and no smoothing: the pixels are read exactly.
 */
import { detect } from '@/lib/detect';
import type { DetectRequest, DetectResponse } from '@/lib/detect/messages';

interface WorkerScope {
  onmessage: ((event: MessageEvent<DetectRequest>) => void) | null;
  postMessage(message: DetectResponse): void;
}
const scope = self as unknown as WorkerScope;

async function decode(file: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(file, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

scope.onmessage = async (event) => {
  const { id, file, settings } = event.data;
  try {
    const image = await decode(file);
    scope.postMessage({ id, ok: true, result: detect(image, settings) });
  } catch (error) {
    scope.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Detection failed.',
    });
  }
};
