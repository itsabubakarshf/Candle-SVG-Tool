/** [r, g, b] (0..255, may be fractional) to "#RRGGBB". */
export function rgbToHex(rgb: readonly [number, number, number]): string {
  const part = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`.toUpperCase();
}

/** Accepts #RGB, #RRGGBB (with or without #). Returns "#RRGGBB" in upper case, or null. */
export function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(input.trim());
  if (!m) return null;
  let hex = m[1] as string;
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return `#${hex.toUpperCase()}`;
}
