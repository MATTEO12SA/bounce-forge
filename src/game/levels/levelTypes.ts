import type { DifficultyConfig } from '../config/difficultyConfig';

export type BrickKind =
  | 'standard'
  | 'resistant'
  | 'explosive'
  | 'indestructible'
  | 'bonus'
  | 'shield';

export type LevelObjectiveType =
  | 'reachBalls'
  | 'triggerExplosions'
  | 'clearWithLives'
  | 'bestCombo';

export interface LevelObjective {
  type: LevelObjectiveType;
  target: number;
  label: string;
}

export interface LevelMedalTargets {
  silverLives: number;
  goldScore?: number;
  goldBestCombo?: number;
}

export interface BrickSpec {
  id: string;
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: BrickKind;
  hitPoints: number;
  maxHitPoints: number;
  score: number;
  powerUpChance: number;
  color: number;
}

export interface LevelDefinition {
  id: string;
  name: string;
  chapter: string;
  index: number;
  rows: number;
  cols: number;
  bricks: BrickSpec[];
  difficulty: DifficultyConfig;
  objective: LevelObjective;
  medalTargets: LevelMedalTargets;
}

export interface PatternDefinition {
  id: string;
  name: string;
  chapter?: string;
  rows: string[];
  objective?: LevelObjective;
  medalTargets?: LevelMedalTargets;
}

export interface CustomLevelOverride {
  slotIndex: number;
  name: string;
  rows: string[];
  updatedAt: number;
}
