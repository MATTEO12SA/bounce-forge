export interface ScoreState {
  score: number;
  bestScore: number;
  bricksBroken: number;
  comboBonusTotal: number;
}

export class ScoreSystem {
  private readonly state: ScoreState;

  public constructor(initialBestScore = 0, initialScore = 0) {
    const startScore = Math.max(0, Math.floor(initialScore));
    this.state = {
      score: startScore,
      bestScore: Math.max(initialBestScore, startScore),
      bricksBroken: 0,
      comboBonusTotal: 0
    };
  }

  public registerBrickBreak(
    baseScore: number,
    comboMultiplier: number,
    difficultyMultiplier: number
  ): number {
    const rawBase = baseScore * difficultyMultiplier;
    const awarded = Math.round(rawBase * comboMultiplier);

    this.state.score += awarded;
    this.state.bestScore = Math.max(this.state.bestScore, this.state.score);
    this.state.bricksBroken += 1;
    this.state.comboBonusTotal += Math.max(0, awarded - Math.round(rawBase));

    return awarded;
  }

  /** Flat points (bumpers, events) that do not count as a broken brick. */
  public addBonus(points: number): number {
    const awarded = Math.max(0, Math.round(points));
    this.state.score += awarded;
    this.state.bestScore = Math.max(this.state.bestScore, this.state.score);
    return awarded;
  }

  public addLifeBonus(livesRemaining: number): number {
    const awarded = Math.max(0, livesRemaining) * 500;
    this.state.score += awarded;
    this.state.bestScore = Math.max(this.state.bestScore, this.state.score);
    return awarded;
  }

  public snapshot(): ScoreState {
    return { ...this.state };
  }
}
