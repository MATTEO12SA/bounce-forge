import { getOfficialCampaignRows } from '../levels/campaignLevels';
import { normalizeEditorRows } from '../levels/editorGrid';
import { createLevelFromPattern } from '../levels/levelFactory';
import { LEVEL_PATTERNS } from '../levels/levelPatterns';
import type { LevelDefinition } from '../levels/levelTypes';
import { SeededRandom } from '../utils/random';

/** Bump when the wave recipe changes so old daily seeds never map to different levels. */
export const GENERATOR_VERSION = 1;
/** Highest campaign difficulty tier (0-based) any generated wave may use. */
export const MAX_WAVE_TIER = LEVEL_PATTERNS.length - 1;
/** Daily waves use campaign tiers 5, 9 and 13 (0-based 4, 8, 12). */
export const DAILY_TIERS: readonly number[] = [4, 8, 12];
export const DAILY_WAVE_COUNT = DAILY_TIERS.length;
export const ENDLESS_STARTING_LIVES = 3;

export function utcDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** FNV-1a 32-bit hash: stable across browsers and Node. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function dailySeed(dateKey: string): number {
  return hashString(`bounce-forge:daily:${dateKey}:v${GENERATOR_VERSION}`);
}

export function createRunSeed(): number {
  return hashString(`run:${Date.now()}:${Math.random()}`);
}

export function endlessTier(wave: number): number {
  const safeWave = Math.max(1, Math.floor(wave));
  // Ramp quickly through the early chapters, then hold at the last campaign tier.
  return Math.min(MAX_WAVE_TIER, safeWave - 1);
}

export function dailyTier(wave: number): number {
  const index = Math.min(DAILY_WAVE_COUNT, Math.max(1, Math.floor(wave))) - 1;
  return DAILY_TIERS[index] ?? DAILY_TIERS[0] ?? 0;
}

/** Seed mixing so each wave of a run draws an independent but reproducible layout. */
export function waveSeed(runSeed: number, wave: number): number {
  return hashString(`${runSeed >>> 0}:${Math.floor(wave)}`);
}

function sourceRows(index: number): string[] {
  const official = getOfficialCampaignRows(index);
  const pattern = LEVEL_PATTERNS[index];
  return normalizeEditorRows(official ?? pattern?.rows ?? []);
}

/**
 * Builds a wave from the validated campaign layouts (never from random noise) so every wave is
 * known to be clearable. Variety comes from picking among nearby layouts and mirroring them.
 */
export function createWaveLevel(options: {
  mode: 'endless' | 'daily';
  runSeed: number;
  wave: number;
}): LevelDefinition {
  const wave = Math.max(1, Math.floor(options.wave));
  const tier = options.mode === 'daily' ? dailyTier(wave) : endlessTier(wave);
  const rng = new SeededRandom(waveSeed(options.runSeed, wave));
  const windowStart = Math.max(0, tier - 3);
  const windowEnd = Math.min(MAX_WAVE_TIER, tier + 2);
  const sourceIndex = windowStart + Math.floor(rng.next() * (windowEnd - windowStart + 1));
  const mirror = rng.next() < 0.5;
  const rows = sourceRows(sourceIndex).map((row) => (mirror ? [...row].reverse().join('') : row));
  const pattern = LEVEL_PATTERNS[sourceIndex];

  const level = createLevelFromPattern(
    {
      id: `${options.mode}-${options.runSeed >>> 0}-w${wave}`,
      name: pattern?.name ?? `Wave ${wave}`,
      chapter: pattern?.chapter ?? 'Forge',
      rows,
      objective: { type: 'clearWithLives', target: 1, label: 'Clear the wave' },
      medalTargets: { silverLives: 2 }
    },
    tier
  );

  return level;
}

export function getPowerUpSeed(runSeed: number, wave: number): number {
  return hashString(`powerups:${runSeed >>> 0}:${Math.floor(wave)}`);
}
