import { BALL_MAX_SPEED, BALL_START_SPEED, STARTING_LIVES } from '../utils/constants';
import { clamp } from '../utils/math';

export interface DifficultyConfig {
  levelIndex: number;
  ballSpeed: number;
  maxBallSpeed: number;
  brickHealthBonus: number;
  powerUpDropChance: number;
  scoreMultiplier: number;
  initialLives: number;
}

/**
 * Campaign pacing over 30 levels: the ball speeds up gently (it used to hit its cap by level 11),
 * reinforced bricks gain at most two extra hits, and every level starts with three lives —
 * the challenge comes from the layouts, mechanisms and medal goals rather than attrition.
 */
export function getDifficultyForLevel(levelIndex: number): DifficultyConfig {
  const safeIndex = Math.max(0, Math.floor(levelIndex));

  return {
    levelIndex: safeIndex,
    ballSpeed: clamp(BALL_START_SPEED + safeIndex * 12, BALL_START_SPEED, BALL_MAX_SPEED - 70),
    maxBallSpeed: clamp(BALL_MAX_SPEED + safeIndex * 6, BALL_MAX_SPEED, BALL_MAX_SPEED + 180),
    brickHealthBonus: Math.min(2, Math.floor(safeIndex / 10)),
    // Pixel-art levels have many small bricks: a fifth of them dropping a capsule is plenty.
    powerUpDropChance: clamp(0.16 + safeIndex * 0.002, 0.16, 0.22),
    scoreMultiplier: 1 + safeIndex * 0.08,
    initialLives: STARTING_LIVES
  };
}
