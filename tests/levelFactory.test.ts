import { describe, expect, it } from 'vitest';
import { createLevelFromPattern } from '../src/game/levels/levelFactory';
import type { PatternDefinition } from '../src/game/levels/levelTypes';

const pattern: PatternDefinition = {
  id: 'test',
  name: 'Test',
  rows: ['12EX', '.3BS']
};

describe('level factory', () => {
  it('creates brick specs from a symbolic pattern', () => {
    const level = createLevelFromPattern(pattern, 0);

    expect(level.bricks).toHaveLength(7);
    expect(level.bricks.map((brick) => brick.kind)).toEqual([
      'standard',
      'resistant',
      'explosive',
      'indestructible',
      'resistant',
      'bonus',
      'shield'
    ]);
  });

  it('marks indestructible bricks as zero score and zero hp', () => {
    const level = createLevelFromPattern(pattern, 0);
    const indestructible = level.bricks.find((brick) => brick.kind === 'indestructible');

    expect(indestructible?.hitPoints).toBe(0);
    expect(indestructible?.score).toBe(0);
  });

  it('adds default objective and medal targets', () => {
    const level = createLevelFromPattern(pattern, 0);

    expect(level.objective.label).toBe('Reach 12 combo');
    expect(level.medalTargets.silverLives).toBe(2);
    expect(level.medalTargets.goldScore).toBeGreaterThan(0);
  });
});
