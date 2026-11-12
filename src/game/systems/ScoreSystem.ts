import type { ScoreBreakdownLine } from '../progress/scoring';

export interface ScoreState {
  score: number;
  bestScore: number;
  bricksBroken: number;
  comboBonusTotal: number;
  /** Points from bricks before the combo multiplier. */
  brickPoints: number;
  /** Bumpers, overflowing capsules and other flat points. */
  extraPoints: number;
  /** Points lost to lost lives (positive number). */
  penalties: number;
}

/** Score of a run, with the detail shown on the result screen. */
export class ScoreSystem {
  private readonly state: ScoreState;
  private readonly endBonuses: ScoreBreakdownLine[] = [];

  public constructor(initialBestScore = 0, initialScore = 0) {
    const startScore = Math.max(0, Math.floor(initialScore));
    this.state = {
      score: startScore,
      bestScore: Math.max(initialBestScore, startScore),
      bricksBroken: 0,
      comboBonusTotal: 0,
      brickPoints: 0,
      extraPoints: 0,
      penalties: 0
    };
  }

  public registerBrickBreak(
    baseScore: number,
    comboMultiplier: number,
    difficultyMultiplier: number
  ): number {
    const rawBase = Math.round(baseScore * difficultyMultiplier);
    const awarded = Math.round(rawBase * comboMultiplier);

    this.add(awarded);
    this.state.bricksBroken += 1;
    this.state.brickPoints += rawBase;
    this.state.comboBonusTotal += Math.max(0, awarded - rawBase);

    return awarded;
  }

  /** Flat points (bumpers, events) that do not count as a broken brick. */
  public addBonus(points: number): number {
    const awarded = Math.max(0, Math.round(points));
    this.add(awarded);
    this.state.extraPoints += awarded;
    return awarded;
  }

  /** Removes points (a lost life); never goes below zero. Returns what was actually removed. */
  public addPenalty(points: number): number {
    const removed = Math.min(this.state.score, Math.max(0, Math.round(points)));
    this.state.score -= removed;
    this.state.penalties += removed;
    return removed;
  }

  /** End-of-level bonuses (lives, flawless, objective, speed). */
  public addEndBonuses(lines: readonly ScoreBreakdownLine[]): number {
    let total = 0;
    lines.forEach((line) => {
      const points = Math.max(0, Math.round(line.points));
      if (points === 0) return;
      this.endBonuses.push({ id: line.id, points });
      total += points;
    });
    this.add(total);
    return total;
  }

  public addLifeBonus(livesRemaining: number): number {
    return this.addEndBonuses([{ id: 'lives', points: Math.max(0, livesRemaining) * 500 }]);
  }

  /** Lines of the result screen, in display order (penalties negative). */
  public breakdown(): ScoreBreakdownLine[] {
    const lines: ScoreBreakdownLine[] = [
      { id: 'bricks', points: this.state.brickPoints },
      { id: 'combo', points: this.state.comboBonusTotal },
      { id: 'extras', points: this.state.extraPoints },
      ...this.endBonuses,
      { id: 'penalties', points: -this.state.penalties }
    ];
    return lines.filter((line) => line.points !== 0);
  }

  public snapshot(): ScoreState {
    return { ...this.state };
  }

  private add(points: number): void {
    this.state.score += points;
    this.state.bestScore = Math.max(this.state.bestScore, this.state.score);
  }
}
