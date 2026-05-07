import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POWER_UP_DROP_TABLE,
  FUTURE_POWER_UP_DEFINITIONS,
  PowerUpSystem
} from '../src/game/systems/PowerUpSystem';
import type { RandomSource } from '../src/game/utils/random';

class FixedRandom implements RandomSource {
  public constructor(private readonly values: number[]) {}

  public next(): number {
    return this.values.shift() ?? 0;
  }
}

describe('power up system', () => {
  it('returns null when drop chance fails', () => {
    const system = new PowerUpSystem(new FixedRandom([0.8]));

    expect(system.roll(0.2)).toBeNull();
  });

  it('uses injected randomness for deterministic drops', () => {
    const system = new PowerUpSystem(new FixedRandom([0.1, 0]));

    expect(system.roll(1)).toBe('multiBall');
  });

  it('can roll the sticky paddle skill power-up', () => {
    const system = new PowerUpSystem(new FixedRandom([0.1, 0.902]));

    expect(system.roll(1)).toBe('stickyPaddle');
  });

  it('keeps future power-ups documented but out of the active drop table', () => {
    const activeTypes = DEFAULT_POWER_UP_DROP_TABLE.map((entry) => entry.type);

    expect(Object.keys(FUTURE_POWER_UP_DEFINITIONS)).toContain('pierceBall');
    expect(activeTypes).not.toContain('pierceBall');
    expect(activeTypes).not.toContain('laserPaddle');
  });

  it('keeps all six future power-ups defined and inactive', () => {
    const futureTypes = [
      'pierceBall',
      'fireBall',
      'magnetPaddle',
      'slowMotion',
      'shieldBottom',
      'laserPaddle'
    ] as const;
    const activeTypes = DEFAULT_POWER_UP_DROP_TABLE.map((entry) => entry.type);

    for (const type of futureTypes) {
      const definition = FUTURE_POWER_UP_DEFINITIONS[type];
      expect(definition).toBeDefined();
      expect(definition.type).toBe(type);
      expect(definition.defaultWeight).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(activeTypes).not.toContain(type);
    }
  });

  it('accepts an injected weighted drop table', () => {
    const system = new PowerUpSystem(new FixedRandom([0.1, 0]), [
      { type: 'extraLife', weight: 1 }
    ]);

    expect(system.roll(1)).toBe('extraLife');
  });
});
