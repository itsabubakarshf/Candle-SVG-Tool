export interface ConfidenceInputs {
  /** (body width − median width) / median width */
  widthDeviation: number;
  /** Distance between the wick line and the body centre, px. null = no wick. */
  wickOffset: number | null;
  split: boolean;
  unclearColour: boolean;
}

/** Step 10. Starts at 1 and loses points for anything that looks off. Below 0.7 is flagged. */
export function confidenceScore(i: ConfidenceInputs): number {
  let score = 1;
  const dev = Math.abs(i.widthDeviation);
  if (dev > 0.1) score -= Math.min(0.5, (dev - 0.1) * 2);
  if (i.wickOffset !== null && i.wickOffset > 1) {
    score -= Math.min(0.4, 0.15 + 0.1 * (i.wickOffset - 1));
  }
  if (i.split) score -= 0.2;
  if (i.unclearColour) score -= 0.25;
  return Math.max(0, Math.min(1, score));
}
