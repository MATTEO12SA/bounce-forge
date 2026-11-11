import { isPowerUpType, type PowerUpType } from '../config/powerUps';

/** Per-level settings a creator can change in the Workshop (all optional). */

export type DropRate = 'low' | 'normal' | 'high';
export type BallPace = 'slow' | 'normal' | 'fast';

export interface LevelOptions {
  /** Power-ups that may drop; undefined = the default table of the level's chapter. */
  powerUps?: PowerUpType[];
  dropRate?: DropRate;
  /** Starting lives, 1 to 5. */
  lives?: number;
  pace?: BallPace;
  /** Every N seconds all bricks move down one row (0 or undefined = off). */
  descendEverySec?: number;
  /** Combo milestones make power-ups rain from the top. */
  bonusRain?: boolean;
  /** Lightning strikes a random brick every few seconds. */
  storm?: boolean;
}

export const DESCEND_CHOICES = [0, 20, 30, 45] as const;
export const PACE_SPEED: Record<BallPace, number> = { slow: 0.85, normal: 1, fast: 1.18 };

const DROP_RATES: DropRate[] = ['low', 'normal', 'high'];
const PACES: BallPace[] = ['slow', 'normal', 'fast'];

/** Cleans options coming from storage, share codes or the network. Returns undefined when empty. */
export function sanitizeLevelOptions(value: unknown): LevelOptions | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const options: LevelOptions = {};
  if (Array.isArray(source.powerUps)) {
    options.powerUps = [...new Set(source.powerUps.filter(isPowerUpType))];
  }
  if (DROP_RATES.includes(source.dropRate as DropRate) && source.dropRate !== 'normal') {
    options.dropRate = source.dropRate as DropRate;
  }
  if (typeof source.lives === 'number' && Number.isFinite(source.lives)) {
    options.lives = Math.max(1, Math.min(5, Math.round(source.lives)));
  }
  if (PACES.includes(source.pace as BallPace) && source.pace !== 'normal') {
    options.pace = source.pace as BallPace;
  }
  if (typeof source.descendEverySec === 'number' && source.descendEverySec > 0) {
    options.descendEverySec = Math.max(10, Math.min(120, Math.round(source.descendEverySec)));
  }
  if (source.bonusRain === true) options.bonusRain = true;
  if (source.storm === true) options.storm = true;
  return Object.keys(options).length > 0 ? options : undefined;
}

export function sameOptions(a: LevelOptions | undefined, b: LevelOptions | undefined): boolean {
  return (
    JSON.stringify(sanitizeLevelOptions(a) ?? {}) === JSON.stringify(sanitizeLevelOptions(b) ?? {})
  );
}
