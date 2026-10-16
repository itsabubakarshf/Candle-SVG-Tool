import type { DetectRequest, DetectResponse } from './messages';
import type { DetectSettings, DetectionResult } from './types';

interface Pending {
  resolve: (result: DetectionResult) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function failAll(message: string): void {
  for (const p of pending.values()) p.reject(new Error(message));
  pending.clear();
  worker?.terminate();
  worker = null;
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('../../workers/detect.worker.ts', import.meta.url), {
    type: 'module',
  });
  w.onmessage = (event: MessageEvent<DetectResponse>) => {
    const response = event.data;
    const p = pending.get(response.id);
    if (!p) return;
    pending.delete(response.id);
    if (response.ok) p.resolve(response.result);
    else p.reject(new Error(response.error));
  };
  w.onerror = () => failAll('Detection stopped unexpectedly. Try again.');
  worker = w;
  return w;
}

/** Runs detection in the Web Worker. The image never leaves the browser. */
export function detectInWorker(file: Blob, settings: DetectSettings): Promise<DetectionResult> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    try {
      const request: DetectRequest = { id, file, settings };
      getWorker().postMessage(request);
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error('Could not start detection.'));
    }
  });
}
