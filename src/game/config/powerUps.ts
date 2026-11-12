/**
 * Every power-up in one place: look, duration, category and how often it drops in each chapter.
 *
 * Balance rules:
 * - a power-up only drops from the chapter that introduces it (weight 0 before);
 * - no single power-up should be more than ~30 % of the drops of a chapter (tested);
 * - "risk" capsules (red) carry a drawback and a score reward: catching them is a choice.
 */

export type PowerUpType =
  | 'multiBall'
  | 'splitBall'
  | 'widePaddle'
  | 'stickyPaddle'
  | 'extraLife'
  | 'fireBall'
  | 'explosiveBall'
  | 'bigBall'
  | 'laserPaddle'
  | 'magnet'
  | 'shield'
  | 'slowMotion'
  | 'fever'
  | 'turbo'
  | 'shrinkPaddle';

export type PowerUpCategory = 'ball' | 'paddle' | 'field' | 'risk' | 'instant';

export interface PowerUpDefinition {
  type: PowerUpType;
  /** Short text printed on the capsule. */
  icon: string;
  color: number;
  category: PowerUpCategory;
  /** 0 for instant effects. */
  durationMs: number;
  /** Longest a timed effect may last when caught again (stacking extends it up to this). */
  maxDurationMs: number;
  /** Drop weight for chapters 1 to 6 (0 = not yet introduced). */
  weights: readonly [number, number, number, number, number, number];
  /** Red capsule with a drawback. */
  risk: boolean;
}

const def = (definition: PowerUpDefinition): PowerUpDefinition => definition;

export const POWER_UPS: Record<PowerUpType, PowerUpDefinition> = {
  multiBall: def({
    type: 'multiBall',
    icon: '×3',
    color: 0x6dffbd,
    category: 'instant',
    durationMs: 0,
    maxDurationMs: 0,
    weights: [1.8, 1.9, 1.8, 2.3, 1.8, 1.8],
    risk: false
  }),
  splitBall: def({
    type: 'splitBall',
    icon: '×2',
    color: 0x65d7ff,
    category: 'instant',
    durationMs: 0,
    maxDurationMs: 0,
    weights: [1.3, 1.3, 1.2, 1.5, 1.2, 1.2],
    risk: false
  }),
  widePaddle: def({
    type: 'widePaddle',
    icon: '↔',
    color: 0x8da2ff,
    category: 'paddle',
    durationMs: 11000,
    maxDurationMs: 22000,
    weights: [1, 0.9, 0.8, 0.7, 0.7, 0.7],
    risk: false
  }),
  stickyPaddle: def({
    type: 'stickyPaddle',
    icon: 'AIM',
    color: 0xffd65a,
    category: 'paddle',
    durationMs: 9000,
    maxDurationMs: 15000,
    weights: [0.12, 0.12, 0.12, 0.12, 0.12, 0.12],
    risk: false
  }),
  extraLife: def({
    type: 'extraLife',
    icon: '♥',
    color: 0xff6f9f,
    category: 'instant',
    durationMs: 0,
    maxDurationMs: 0,
    weights: [0.3, 0.28, 0.26, 0.24, 0.24, 0.24],
    risk: false
  }),
  fireBall: def({
    type: 'fireBall',
    icon: '🔥',
    color: 0xff7a1a,
    category: 'ball',
    durationMs: 8000,
    maxDurationMs: 14000,
    weights: [0, 0.55, 0.65, 0.65, 0.75, 0.9],
    risk: false
  }),
  explosiveBall: def({
    type: 'explosiveBall',
    icon: '💥',
    color: 0xff5340,
    category: 'ball',
    durationMs: 0,
    maxDurationMs: 0,
    weights: [0, 0, 0.9, 0.7, 0.8, 0.8],
    risk: false
  }),
  bigBall: def({
    type: 'bigBall',
    icon: '⬤',
    color: 0xffc37a,
    category: 'ball',
    durationMs: 10000,
    maxDurationMs: 18000,
    weights: [0, 0.6, 0.6, 0.55, 0.6, 0.6],
    risk: false
  }),
  laserPaddle: def({
    type: 'laserPaddle',
    icon: '⇈',
    color: 0xff4d8d,
    category: 'paddle',
    durationMs: 8000,
    maxDurationMs: 14000,
    weights: [0, 0.65, 0.6, 0.6, 0.7, 0.9],
    risk: false
  }),
  magnet: def({
    type: 'magnet',
    icon: 'U',
    color: 0xc6a8ff,
    category: 'paddle',
    durationMs: 10000,
    maxDurationMs: 18000,
    weights: [0.6, 0.5, 0.5, 0.6, 0.6, 0.6],
    risk: false
  }),
  shield: def({
    type: 'shield',
    icon: '▬',
    color: 0x7fe8ff,
    category: 'field',
    durationMs: 0,
    maxDurationMs: 0,
    weights: [0.7, 0.55, 0.5, 0.5, 0.6, 0.7],
    risk: false
  }),
  slowMotion: def({
    type: 'slowMotion',
    icon: '◷',
    color: 0x9fd6ff,
    category: 'field',
    durationMs: 8000,
    maxDurationMs: 14000,
    weights: [0.6, 0.5, 0.5, 0.5, 0.5, 0.5],
    risk: false
  }),
  fever: def({
    type: 'fever',
    icon: '×2$',
    color: 0xffe066,
    category: 'field',
    durationMs: 10000,
    maxDurationMs: 18000,
    weights: [0, 0, 0.5, 0.6, 0.6, 0.6],
    risk: false
  }),
  turbo: def({
    type: 'turbo',
    icon: '»',
    color: 0xff3b3b,
    category: 'risk',
    durationMs: 9000,
    maxDurationMs: 15000,
    weights: [0, 0.4, 0.5, 0.6, 0.6, 0.6],
    risk: true
  }),
  shrinkPaddle: def({
    type: 'shrinkPaddle',
    icon: '→←',
    color: 0xff3b3b,
    category: 'risk',
    durationMs: 10000,
    maxDurationMs: 16000,
    weights: [0, 0, 0.4, 0.5, 0.6, 0.6],
    risk: true
  })
};

export const POWER_UP_TYPES = Object.keys(POWER_UPS) as PowerUpType[];
export const CHAPTER_COUNT = 6;

export function getPowerUpDefinition(type: PowerUpType): PowerUpDefinition {
  return POWER_UPS[type];
}

export function isPowerUpType(value: unknown): value is PowerUpType {
  return typeof value === 'string' && value in POWER_UPS;
}

/** First chapter (0-based) where a power-up can drop. */
export function introducedInChapter(type: PowerUpType): number {
  const index = POWER_UPS[type].weights.findIndex((weight) => weight > 0);
  return index < 0 ? CHAPTER_COUNT - 1 : index;
}

/** Score multiplier granted while a risk or fever effect is active. */
export const SCORE_MULTIPLIERS: Partial<Record<PowerUpType, number>> = {
  fever: 2,
  turbo: 1.5,
  shrinkPaddle: 2
};

/** Effects that cancel each other: catching one ends the other. */
export const OPPOSITES: Partial<Record<PowerUpType, PowerUpType>> = {
  widePaddle: 'shrinkPaddle',
  shrinkPaddle: 'widePaddle',
  slowMotion: 'turbo',
  turbo: 'slowMotion'
};
