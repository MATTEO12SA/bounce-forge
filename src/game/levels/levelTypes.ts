import type { DifficultyConfig } from '../config/difficultyConfig';
import type { LevelOptions } from './levelOptions';

export type BrickKind =
  | 'standard'
  | 'resistant'
  | 'explosive'
  | 'indestructible'
  | 'bonus'
  | 'shield'
  | 'crystal'
  | 'key'
  | 'gate'
  | 'phoenix'
  | 'invisible'
  | 'mover'
  | 'bumper'
  | 'teleporter'
  | 'fuse'
  | 'boss';

/** Kinds the ball cannot destroy (gates are handled separately: locked while keys remain). */
export const SOLID_KINDS: readonly BrickKind[] = ['indestructible', 'bumper', 'teleporter'];

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
  options?: LevelOptions;
}

export interface PatternDefinition {
  id: string;
  name: string;
  chapter?: string;
  rows: string[];
  objective?: LevelObjective;
  medalTargets?: LevelMedalTargets;
  options?: LevelOptions;
}

export interface CreativeLevelSlot {
  slotIndex: number;
  name: string;
  rows: string[];
  updatedAt: number;
  options?: LevelOptions;
}

export interface AdminCampaignOverride {
  levelIndex: number;
  name: string;
  rows: string[];
  updatedAt: number;
}

export type CustomLevelOverride = CreativeLevelSlot;
