import { createLevelFromPattern } from './levelFactory';
import { LEVEL_PATTERNS } from './levelPatterns';

export const campaignLevels = LEVEL_PATTERNS.map((pattern, index) =>
  createLevelFromPattern(pattern, index)
);
