/** Links that open Crisper with a preset: https://crisper-recaps.vercel.app/?preset=<id> */

const PARAM = 'preset';

export function shareLink(
  presetId: string,
  origin = typeof window === 'undefined' ? '' : window.location.origin,
): string {
  return `${origin}/?${PARAM}=${encodeURIComponent(presetId)}`;
}

/** The preset id in the address bar, if the page was opened from a shared link. */
export function presetFromUrl(): string | null {
  try {
    const id = new URLSearchParams(window.location.search).get(PARAM);
    return id && /^[\w-]{1,80}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Removes ?preset= so a reload does not open it again over the person's own choice. */
export function clearPresetFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(PARAM)) return;
    url.searchParams.delete(PARAM);
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch {
    /* nothing to tidy */
  }
}
