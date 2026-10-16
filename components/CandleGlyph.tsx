import type { CandleColors } from '@/lib/detect/types';

/** A small drawing of one candle in the colours it has on the chart. */
export function CandleGlyph({
  colours,
  background,
  className,
}: {
  colours: CandleColors;
  background: string;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 40 56" className={className} aria-hidden>
      <rect width="40" height="56" rx="8" fill={background} />
      <line x1="20" y1="6" x2="20" y2="50" stroke={colours.wick} strokeWidth="2" />
      <rect
        x="11"
        y="16"
        width="18"
        height="24"
        fill={colours.body}
        stroke={colours.border}
        strokeWidth="2"
      />
    </svg>
  );
}
