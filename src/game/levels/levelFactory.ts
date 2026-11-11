import { getDifficultyForLevel } from '../config/difficultyConfig';
import {
  BRICK_GAP,
  BRICK_HEIGHT,
  PLAYFIELD_LEFT,
  PLAYFIELD_TOP,
  PLAYFIELD_WIDTH
} from '../utils/constants';
import { PACE_SPEED, sanitizeLevelOptions } from './levelOptions';
import type { BrickKind, BrickSpec, LevelDefinition, PatternDefinition } from './levelTypes';

interface BrickTemplate {
  kind: BrickKind;
  hitPoints: number;
  score: number;
  color: number;
  powerUpChanceMultiplier: number;
}

const BRICK_TEMPLATES: Record<string, BrickTemplate | undefined> = {
  '1': {
    kind: 'standard',
    hitPoints: 1,
    score: 100,
    color: 0xffb423,
    powerUpChanceMultiplier: 1
  },
  '2': {
    kind: 'resistant',
    hitPoints: 2,
    score: 170,
    color: 0xe8577e,
    powerUpChanceMultiplier: 1.1
  },
  '3': {
    kind: 'resistant',
    hitPoints: 3,
    score: 240,
    color: 0x9d63f2,
    powerUpChanceMultiplier: 1.15
  },
  E: {
    kind: 'explosive',
    hitPoints: 1,
    score: 210,
    color: 0xff6b3d,
    powerUpChanceMultiplier: 1.25
  },
  B: {
    kind: 'bonus',
    hitPoints: 1,
    score: 130,
    color: 0x5fe0a8,
    powerUpChanceMultiplier: 3
  },
  S: {
    kind: 'shield',
    hitPoints: 3,
    score: 280,
    color: 0x8fbbe0,
    powerUpChanceMultiplier: 0.75
  },
  X: {
    kind: 'indestructible',
    hitPoints: 0,
    score: 0,
    color: 0x5b5750,
    powerUpChanceMultiplier: 0
  }
};

/** Kind and colour a level symbol turns into (used by the HTML editor to draw real bricks). */
export function brickLookForSymbol(symbol: string): { kind: BrickKind; color: number } | null {
  const template = BRICK_TEMPLATES[symbol];
  return template ? { kind: template.kind, color: template.color } : null;
}

export function createLevelFromPattern(
  pattern: PatternDefinition,
  levelIndex: number
): LevelDefinition {
  const difficulty = { ...getDifficultyForLevel(levelIndex) };
  const options = sanitizeLevelOptions(pattern.options);
  if (options?.lives) {
    difficulty.initialLives = options.lives;
  }
  if (options?.pace) {
    difficulty.ballSpeed = Math.round(difficulty.ballSpeed * PACE_SPEED[options.pace]);
    difficulty.maxBallSpeed = Math.round(difficulty.maxBallSpeed * PACE_SPEED[options.pace]);
  }
  const rows = pattern.rows.length;
  const cols = Math.max(...pattern.rows.map((row) => row.length));
  const brickWidth = (PLAYFIELD_WIDTH - BRICK_GAP * (cols - 1)) / cols;
  const startX = PLAYFIELD_LEFT + brickWidth / 2;
  const bricks: BrickSpec[] = [];

  pattern.rows.forEach((rowValue, row) => {
    for (let col = 0; col < cols; col += 1) {
      const char = rowValue[col] ?? '.';
      const template = BRICK_TEMPLATES[char];

      if (!template) {
        continue;
      }

      const healthBonus =
        template.kind === 'standard' ||
        template.kind === 'bonus' ||
        template.kind === 'indestructible'
          ? 0
          : difficulty.brickHealthBonus;
      const hitPoints = template.kind === 'indestructible' ? 0 : template.hitPoints + healthBonus;

      bricks.push({
        id: `${pattern.id}-${row}-${col}`,
        row,
        col,
        x: startX + col * (brickWidth + BRICK_GAP),
        y: PLAYFIELD_TOP + BRICK_HEIGHT / 2 + row * (BRICK_HEIGHT + BRICK_GAP),
        width: brickWidth,
        height: BRICK_HEIGHT,
        kind: template.kind,
        hitPoints,
        maxHitPoints: hitPoints,
        score: template.score,
        powerUpChance: difficulty.powerUpDropChance * template.powerUpChanceMultiplier,
        color: template.color
      });
    }
  });

  return {
    id: pattern.id,
    name: pattern.name,
    chapter: pattern.chapter ?? 'Campaign',
    index: levelIndex,
    rows,
    cols,
    bricks,
    difficulty,
    objective: pattern.objective ?? {
      type: 'bestCombo',
      target: 12 + levelIndex * 2,
      label: `Reach ${12 + levelIndex * 2} combo`
    },
    medalTargets: pattern.medalTargets ?? {
      silverLives: 2,
      goldScore: Math.round(2400 + levelIndex * 900),
      goldBestCombo: 18 + levelIndex * 2
    },
    options
  };
}
