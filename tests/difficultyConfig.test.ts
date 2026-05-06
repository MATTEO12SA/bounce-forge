import { describe, expect, it } from 'vitest';
import { getDifficultyForLevel } from '../src/game/config/difficultyConfig';

describe('difficulty config', () => {
  it('progresses ball speed and score multiplier by level', () => {
    const first = getDifficultyForLevel(0);
    const later = getDifficultyForLevel(5);

    expect(later.ballSpeed).toBeGreaterThan(first.ballSpeed);
    expect(later.scoreMultiplier).toBeGreaterThan(first.scoreMultiplier);
    expect(later.powerUpDropChance).toBeGreaterThanOrEqual(first.powerUpDropChance);
  });

  it('keeps lives within intended campaign bounds', () => {
    expect(getDifficultyForLevel(0).initialLives).toBe(3);
    expect(getDifficultyForLevel(99).initialLives).toBe(2);
  });
});
