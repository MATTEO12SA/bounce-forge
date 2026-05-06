import { BALL_MAX_SPEED, BALL_START_SPEED, STARTING_LIVES } from '../utils/constants';
import { clamp } from '../utils/math';
//pour push 
export interface DifficultyConfig {
  levelIndex: number;
  ballSpeed: number;
  maxBallSpeed: number;
  brickHealthBonus: number;
  powerUpDropChance: number;
  scoreMultiplier: number;
  initialLives: number;
}

export function getDifficultyForLevel(levelIndex: number): DifficultyConfig {
  const safeIndex = Math.max(0, Math.floor(levelIndex));
  const step = safeIndex + 1;

  return {
    levelIndex: safeIndex,
    ballSpeed: clamp(BALL_START_SPEED + safeIndex * 34, BALL_START_SPEED, BALL_MAX_SPEED - 70),
    maxBallSpeed: clamp(BALL_MAX_SPEED + safeIndex * 18, BALL_MAX_SPEED, BALL_MAX_SPEED + 180),
    brickHealthBonus: Math.floor(safeIndex / 4),
    powerUpDropChance: clamp(0.35 + safeIndex * 0.006, 0.35, 0.48),
    scoreMultiplier: 1 + safeIndex * 0.08,
    initialLives: Math.max(2, STARTING_LIVES - Math.floor(step / 6))
  };
}
