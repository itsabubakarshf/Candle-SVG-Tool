'use client';

import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  // The query only matches the current ratio, so it fires whenever the ratio changes
  // (Windows scaling, browser zoom, moving the window to another screen).
  let query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  const handler = () => {
    query.removeEventListener('change', handler);
    onChange();
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener('change', handler);
  };
  query.addEventListener('change', handler);
  return () => query.removeEventListener('change', handler);
}

const getSnapshot = (): number => window.devicePixelRatio;
const getServerSnapshot = (): number => 1;

/** Current device pixel ratio, kept up to date. */
export function useDevicePixelRatio(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
