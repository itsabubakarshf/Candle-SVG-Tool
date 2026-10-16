/** 2 decimals, no trailing zeros: 40.5, 12.3, 30. */
export function fmt(n: number): string {
  const s = (Math.round(n * 100) / 100).toFixed(2);
  return s.replace(/\.?0+$/, '') || '0';
}
