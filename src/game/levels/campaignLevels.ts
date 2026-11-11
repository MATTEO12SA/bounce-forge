import embeddedOverrides from '../../../data/campaign-level-overrides.json';
import { CampaignOverrideSystem } from '../systems/CampaignOverrideSystem';
import type { AdminCampaignOverride, LevelDefinition } from './levelTypes';
import { createLevelFromPattern } from './levelFactory';
import { LEVEL_PATTERNS } from './levelPatterns';

interface EmbeddedOverrideFile {
  overrides?: AdminCampaignOverride[];
}

/**
 * Official layouts edited with the local admin tool are committed in
 * `data/campaign-level-overrides.json` and baked into the campaign so the public build ships the
 * same levels as the local server. Identifiers, objectives and medals stay those of the pattern.
 */
const officialOverrides = new Map<number, AdminCampaignOverride>(
  ((embeddedOverrides as EmbeddedOverrideFile).overrides ?? []).map((override) => [
    override.levelIndex,
    override
  ])
);

function buildCampaignLevel(index: number): LevelDefinition {
  const pattern = LEVEL_PATTERNS[index];
  if (!pattern) {
    throw new Error(`Pattern ${index} is not defined.`);
  }
  const base = createLevelFromPattern(pattern, index);
  const override = officialOverrides.get(index);
  if (!override) {
    return base;
  }
  try {
    return CampaignOverrideSystem.createLevelFromOverride(override, base);
  } catch {
    return base;
  }
}

export const campaignLevels: LevelDefinition[] = LEVEL_PATTERNS.map((_, index) =>
  buildCampaignLevel(index)
);

export function getOfficialCampaignRows(index: number): string[] | null {
  const override = officialOverrides.get(index);
  return override ? [...override.rows] : null;
}
