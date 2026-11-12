/**
 * End-of-level bonuses and the life penalty, kept pure so the numbers are easy to test and tune.
 */

export type ScoreLine =
  | 'bricks'
  | 'combo'
  | 'extras'
  | 'lives'
  | 'flawless'
  | 'objective'
  | 'speed'
  | 'penalties';

export interface ScoreBreakdownLine {
  id: ScoreLine;
  points: number;
}

/** Losing a life costs a tenth of the score (at least 300, never more than the score itself). */
export function lifePenalty(score: number): number {
  const safe = Math.max(0, Math.floor(score));
  return Math.min(safe, Math.max(300, Math.round(safe * 0.1)));
}

/** Time a good player needs: 30 s plus a quarter of a second per brick to break. */
export function parTimeMs(requiredBricks: number): number {
  return 30000 + Math.max(0, requiredBricks) * 250;
}

export interface FinishInput {
  livesLeft: number;
  livesLost: number;
  objectiveMet: boolean;
  elapsedMs: number;
  parMs: number;
  /** Level score multiplier (later levels are worth more). */
  multiplier: number;
}

/**
 * Bonuses for a cleared level: lives left, flawless run, objective, and speed (full bonus at or
 * under par time, nothing at twice the par time).
 */
export function finishBonuses(input: FinishInput): ScoreBreakdownLine[] {
  const scale = Math.max(1, input.multiplier);
  const speedRatio = Math.max(
    0,
    Math.min(1, (2 * input.parMs - input.elapsedMs) / Math.max(1, input.parMs))
  );
  const lines: ScoreBreakdownLine[] = [
    { id: 'lives', points: Math.max(0, input.livesLeft) * 500 },
    { id: 'flawless', points: input.livesLost === 0 ? Math.round(2500 * scale) : 0 },
    { id: 'objective', points: input.objectiveMet ? Math.round(1500 * scale) : 0 },
    { id: 'speed', points: Math.round(3000 * scale * speedRatio) }
  ];
  return lines.filter((line) => line.points > 0);
}
