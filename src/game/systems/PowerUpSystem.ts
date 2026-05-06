import { chance, nativeRandom, pickWeighted, type RandomSource } from '../utils/random';

export type PowerUpType = 'multiBall' | 'splitBall' | 'widePaddle' | 'stickyPaddle' | 'extraLife';

export interface PowerUpDefinition {
  type: PowerUpType;
  label: string;
  color: number;
  durationMs: number;
  weight: number;
  positive: boolean;
}

export const POWER_UP_DEFINITIONS: Record<PowerUpType, PowerUpDefinition> = {
  multiBall: {
    type: 'multiBall',
    label: 'x3',
    color: 0x6dffbd,
    durationMs: 0,
    weight: 6.5,
    positive: true
  },
  splitBall: {
    type: 'splitBall',
    label: 'x2',
    color: 0x65d7ff,
    durationMs: 0,
    weight: 4,
    positive: true
  },
  widePaddle: {
    type: 'widePaddle',
    label: 'W',
    color: 0x8da2ff,
    durationMs: 11000,
    weight: 0.45,
    positive: true
  },
  stickyPaddle: {
    type: 'stickyPaddle',
    label: 'AIM',
    color: 0xffd65a,
    durationMs: 9000,
    weight: 0.55,
    positive: true
  },
  extraLife: {
    type: 'extraLife',
    label: '+1',
    color: 0xff6f9f,
    durationMs: 0,
    weight: 0.8,
    positive: true
  }
};

export function getPowerUpDefinition(type: PowerUpType): PowerUpDefinition {
  return POWER_UP_DEFINITIONS[type];
}

export class PowerUpSystem {
  public constructor(private readonly rng: RandomSource = nativeRandom) {}

  public roll(dropChance: number): PowerUpType | null {
    if (!chance(dropChance, this.rng)) {
      return null;
    }

    return pickWeighted(
      Object.values(POWER_UP_DEFINITIONS).map((definition) => ({
        item: definition.type,
        weight: definition.weight
      })),
      this.rng
    );
  }

  public rollBallBonus(): PowerUpType {
    return pickWeighted(
      [
        { item: 'multiBall' as const, weight: POWER_UP_DEFINITIONS.multiBall.weight },
        { item: 'splitBall' as const, weight: POWER_UP_DEFINITIONS.splitBall.weight }
      ],
      this.rng
    );
  }
}
