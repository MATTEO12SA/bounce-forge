import { COMBO_TIMEOUT_MS } from '../utils/constants';

export interface ComboState {
  streak: number;
  bestStreak: number;
  multiplier: number;
  timeRemainingMs: number;
}

export class ComboSystem {
  private readonly state: ComboState = {
    streak: 0,
    bestStreak: 0,
    multiplier: 1,
    timeRemainingMs: 0
  };

  public constructor(private readonly timeoutMs = COMBO_TIMEOUT_MS) {}

  public registerBreak(): ComboState {
    this.state.streak += 1;
    this.state.bestStreak = Math.max(this.state.bestStreak, this.state.streak);
    this.state.multiplier = 1 + Math.min(this.state.streak - 1, 12) * 0.12;
    this.state.timeRemainingMs = this.timeoutMs;
    return this.snapshot();
  }

  public update(deltaMs: number): ComboState {
    if (this.state.streak === 0) {
      return this.snapshot();
    }

    this.state.timeRemainingMs = Math.max(0, this.state.timeRemainingMs - deltaMs);

    if (this.state.timeRemainingMs === 0) {
      this.reset();
    }

    return this.snapshot();
  }

  public reset(): ComboState {
    this.state.streak = 0;
    this.state.multiplier = 1;
    this.state.timeRemainingMs = 0;
    return this.snapshot();
  }

  public snapshot(): ComboState {
    return { ...this.state };
  }
}
