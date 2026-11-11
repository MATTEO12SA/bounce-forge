import { describe, expect, it } from 'vitest';
import { CHAPTER_COUNT, introducedInChapter, POWER_UP_TYPES } from '../src/game/config/powerUps';
import { EffectState } from '../src/game/effects/EffectState';
import {
  DEFAULT_POWER_UP_DROP_TABLE,
  dropTableFor,
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

  it('accepts an injected weighted drop table', () => {
    const system = new PowerUpSystem(new FixedRandom([0.1, 0]), [{ type: 'extraLife', weight: 1 }]);
    expect(system.roll(1)).toBe('extraLife');
  });

  it('applies the drop-rate multiplier', () => {
    const low = new PowerUpSystem(new FixedRandom([0.3]), undefined, undefined, 0.5);
    expect(low.roll(0.5)).toBeNull();
    const high = new PowerUpSystem(new FixedRandom([0.6, 0]), undefined, undefined, 1.8);
    expect(high.roll(0.5)).not.toBeNull();
  });

  it('keeps the AIM power-up rare (under 2 % of drops)', () => {
    const total = DEFAULT_POWER_UP_DROP_TABLE.reduce((sum, entry) => sum + entry.weight, 0);
    const sticky = DEFAULT_POWER_UP_DROP_TABLE.find((entry) => entry.type === 'stickyPaddle');
    expect((sticky?.weight ?? 0) / total).toBeLessThan(0.02);
  });

  it('introduces power-ups progressively and keeps every chapter varied', () => {
    expect(introducedInChapter('multiBall')).toBe(0);
    expect(introducedInChapter('fireBall')).toBe(1);
    expect(introducedInChapter('explosiveBall')).toBe(2);
    for (let chapter = 0; chapter < CHAPTER_COUNT; chapter += 1) {
      const table = dropTableFor(chapter);
      const total = table.reduce((sum, entry) => sum + entry.weight, 0);
      expect(table.length).toBeGreaterThanOrEqual(7);
      table.forEach((entry) => expect(entry.weight / total).toBeLessThanOrEqual(0.3));
    }
    expect(dropTableFor(0).map((entry) => entry.type)).not.toContain('fireBall');
    expect(dropTableFor(CHAPTER_COUNT - 1)).toHaveLength(POWER_UP_TYPES.length);
  });

  it('lets level creators restrict and unlock power-ups', () => {
    const table = dropTableFor(0, ['fireBall', 'shield']);
    expect(table.map((entry) => entry.type).sort()).toEqual(['fireBall', 'shield']);
    expect(dropTableFor(0, [])).toEqual([{ type: 'multiBall', weight: 1 }]);
  });
});

describe('effect state', () => {
  it('extends a timed effect up to its cap and expires it', () => {
    const effects = new EffectState();
    effects.activate('fireBall');
    effects.activate('fireBall');
    expect(effects.timeLeft('fireBall')).toBe(14000);
    expect(effects.tick(13999)).toEqual([]);
    expect(effects.tick(2)).toEqual(['fireBall']);
    expect(effects.has('fireBall')).toBe(false);
  });

  it('cancels opposite effects', () => {
    const effects = new EffectState();
    effects.activate('widePaddle');
    const result = effects.activate('shrinkPaddle');
    expect(result.cancelled).toBe('widePaddle');
    expect(effects.paddleScale()).toBeCloseTo(0.65);
  });

  it('rewards risk capsules with a score multiplier, capped at ×4', () => {
    const effects = new EffectState();
    effects.activate('turbo');
    expect(effects.scoreMultiplier()).toBe(1.5);
    effects.activate('fever');
    effects.activate('shrinkPaddle');
    expect(effects.scoreMultiplier()).toBe(4);
    expect(effects.ballTimeScale()).toBeCloseTo(1.3);
  });

  it('counts explosive and shield charges', () => {
    const effects = new EffectState();
    effects.activate('explosiveBall');
    effects.activate('shield');
    expect(effects.explosiveCharges).toBe(3);
    expect(effects.useExplosiveCharge()).toBe(true);
    expect(effects.explosiveCharges).toBe(2);
    expect(effects.useShield()).toBe(true);
    expect(effects.useShield()).toBe(false);
  });

  it('detects combos when they start', () => {
    const effects = new EffectState();
    effects.activate('fireBall');
    expect(effects.activate('explosiveBall').newCombos).toEqual(['meteor']);
    // Meteor: fire explosions do not use charges.
    effects.useExplosiveCharge();
    expect(effects.explosiveCharges).toBe(3);
    expect(effects.activate('bigBall').newCombos).toEqual(['sun']);
    expect(effects.activate('laserPaddle').newCombos).toEqual(['explosiveLasers']);
  });
});
