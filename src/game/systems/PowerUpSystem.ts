import { chance, nativeRandom, pickWeighted, type RandomSource } from '../utils/random';

export type PowerUpType = 'multiBall' | 'splitBall' | 'widePaddle' | 'stickyPaddle' | 'extraLife';
export type FuturePowerUpType =
  | 'pierceBall'
  | 'fireBall'
  | 'magnetPaddle'
  | 'slowMotion'
  | 'shieldBottom'
  | 'laserPaddle';
export type AnyPowerUpType = PowerUpType | FuturePowerUpType;

export interface PowerUpRollEntry<T extends AnyPowerUpType = PowerUpType> {
  type: T;
  weight: number;
}

export interface PowerUpDefinition {
  type: PowerUpType;
  label: string;
  color: number;
  durationMs: number;
  weight: number;
  positive: boolean;
}

export interface FuturePowerUpDefinition {
  type: FuturePowerUpType;
  label: string;
  description: string;
  defaultWeight: number;
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

export const FUTURE_POWER_UP_DEFINITIONS: Record<FuturePowerUpType, FuturePowerUpDefinition> = {
  pierceBall: {
    type: 'pierceBall',
    label: 'PIERCE',
    description: 'Ball pierces a limited number of bricks before bouncing normally.',
    defaultWeight: 0.7,
    positive: true
  },
  fireBall: {
    type: 'fireBall',
    label: 'FIRE',
    description: 'Ball creates a small impact explosion.',
    defaultWeight: 0.55,
    positive: true
  },
  magnetPaddle: {
    type: 'magnetPaddle',
    label: 'MAG',
    description: 'Paddle attracts falling power-ups for a short duration.',
    defaultWeight: 0.5,
    positive: true
  },
  slowMotion: {
    type: 'slowMotion',
    label: 'SLOW',
    description: 'Temporarily slows launched balls without changing level rules.',
    defaultWeight: 0.45,
    positive: true
  },
  shieldBottom: {
    type: 'shieldBottom',
    label: 'SHIELD',
    description: 'Saves one missed ball at the bottom of the playfield.',
    defaultWeight: 0.42,
    positive: true
  },
  laserPaddle: {
    type: 'laserPaddle',
    label: 'LASER',
    description: 'Temporarily fires shots from the paddle.',
    defaultWeight: 0.35,
    positive: true
  }
};

export const DEFAULT_POWER_UP_DROP_TABLE: readonly PowerUpRollEntry[] = Object.freeze(
  Object.values(POWER_UP_DEFINITIONS).map((definition) =>
    Object.freeze({
      type: definition.type,
      weight: definition.weight
    })
  )
);

export const BALL_BONUS_DROP_TABLE: readonly PowerUpRollEntry[] = Object.freeze([
  Object.freeze({ type: 'multiBall', weight: POWER_UP_DEFINITIONS.multiBall.weight }),
  Object.freeze({ type: 'splitBall', weight: POWER_UP_DEFINITIONS.splitBall.weight })
]);

export function getPowerUpDefinition(type: PowerUpType): PowerUpDefinition {
  return POWER_UP_DEFINITIONS[type];
}

export class PowerUpSystem {
  public constructor(
    private readonly rng: RandomSource = nativeRandom,
    private readonly dropTable: readonly PowerUpRollEntry[] = DEFAULT_POWER_UP_DROP_TABLE,
    private readonly ballBonusTable: readonly PowerUpRollEntry[] = BALL_BONUS_DROP_TABLE
  ) {}

  public roll(dropChance: number): PowerUpType | null {
    if (!chance(dropChance, this.rng)) {
      return null;
    }

    return pickWeighted(
      this.dropTable.map((entry) => ({
        item: entry.type,
        weight: entry.weight
      })),
      this.rng
    );
  }

  public rollBallBonus(): PowerUpType {
    return pickWeighted(
      this.ballBonusTable.map((entry) => ({
        item: entry.type,
        weight: entry.weight
      })),
      this.rng
    );
  }
}
