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
