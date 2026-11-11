import {
  CHAPTER_COUNT,
  getPowerUpDefinition,
  POWER_UPS,
  POWER_UP_TYPES,
  type PowerUpDefinition,
  type PowerUpType
} from '../config/powerUps';
import type { DropRate } from '../levels/levelOptions';
import { chance, nativeRandom, pickWeighted, type RandomSource } from '../utils/random';

export { getPowerUpDefinition, type PowerUpDefinition, type PowerUpType };

export interface PowerUpRollEntry {
  type: PowerUpType;
  weight: number;
}

export const DROP_RATE_MULTIPLIER: Record<DropRate, number> = { low: 0.5, normal: 1, high: 1.8 };

/**
 * Drop table for a chapter (0-based, clamped). `allowed` restricts the table to the power-ups
 * a level creator enabled; an empty result falls back to multiball so a level never drops nothing.
 */
export function dropTableFor(
  chapter: number,
  allowed?: readonly PowerUpType[]
): PowerUpRollEntry[] {
  const index = Math.max(0, Math.min(CHAPTER_COUNT - 1, Math.floor(chapter)));
  const allowedSet = allowed ? new Set(allowed) : null;
  const table = POWER_UP_TYPES.filter((type) => !allowedSet || allowedSet.has(type))
    .map((type) => {
      const weights = POWER_UPS[type].weights;
      // Creators may enable a power-up before its chapter: give it the weight of its debut.
      const weight = weights[index] || (allowedSet ? (weights.find((value) => value > 0) ?? 0) : 0);
      return { type, weight };
    })
    .filter((entry) => entry.weight > 0);
  return table.length > 0 ? table : [{ type: 'multiBall', weight: 1 }];
}

/** Default table: the last chapter, where everything is unlocked. */
export const DEFAULT_POWER_UP_DROP_TABLE: readonly PowerUpRollEntry[] = Object.freeze(
  dropTableFor(CHAPTER_COUNT - 1)
);

/** Bonus bricks always drop extra balls. */
export const BALL_BONUS_DROP_TABLE: readonly PowerUpRollEntry[] = Object.freeze([
  { type: 'multiBall', weight: 6.5 },
  { type: 'splitBall', weight: 4 }
]);

export class PowerUpSystem {
  public constructor(
    private readonly rng: RandomSource = nativeRandom,
    private readonly dropTable: readonly PowerUpRollEntry[] = DEFAULT_POWER_UP_DROP_TABLE,
    private readonly ballBonusTable: readonly PowerUpRollEntry[] = BALL_BONUS_DROP_TABLE,
    private readonly rateMultiplier = 1
  ) {}

  public roll(dropChance: number): PowerUpType | null {
    if (!chance(Math.min(0.95, dropChance * this.rateMultiplier), this.rng)) {
      return null;
    }
    return pickWeighted(
      this.dropTable.map((entry) => ({ item: entry.type, weight: entry.weight })),
      this.rng
    );
  }

  public rollBallBonus(): PowerUpType {
    return pickWeighted(
      this.ballBonusTable.map((entry) => ({ item: entry.type, weight: entry.weight })),
      this.rng
    );
  }

  /** A random power-up from the table, ignoring the drop chance (bonus rain event). */
  public rollAny(): PowerUpType {
    return pickWeighted(
      this.dropTable.map((entry) => ({ item: entry.type, weight: entry.weight })),
      this.rng
    );
  }
}
