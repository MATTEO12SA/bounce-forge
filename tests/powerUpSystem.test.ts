import { describe, expect, it } from 'vitest';
import { PowerUpSystem } from '../src/game/systems/PowerUpSystem';
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
});
