import { describe, expect, it } from 'vitest';
import {
  createWaveLevel,
  dailySeed,
  dailyTier,
  endlessTier,
  MAX_WAVE_TIER,
  utcDateKey
} from '../src/game/modes/waveGenerator';
import { getDifficultyForLevel } from '../src/game/config/difficultyConfig';

describe('wave generator', () => {
  it('uses the UTC day, not the local day', () => {
    expect(utcDateKey(new Date('2026-11-11T23:59:59.999Z'))).toBe('2026-11-11');
    expect(utcDateKey(new Date('2026-11-12T00:00:00.000Z'))).toBe('2026-11-12');
  });

  it('produces the same daily waves for the same date and different ones the next day', () => {
    const seedA = dailySeed('2026-11-11');
    const seedB = dailySeed('2026-11-12');
    expect(seedA).toBe(dailySeed('2026-11-11'));
    expect(seedA).not.toBe(seedB);

    for (let wave = 1; wave <= 3; wave += 1) {
      const first = createWaveLevel({ mode: 'daily', runSeed: seedA, wave });
      const again = createWaveLevel({ mode: 'daily', runSeed: seedA, wave });
      expect(again.bricks.map((brick) => brick.id + brick.kind)).toEqual(
        first.bricks.map((brick) => brick.id + brick.kind)
      );
    }
  });

  it('maps daily waves to campaign tiers 5, 9 and 13', () => {
    expect([1, 2, 3].map(dailyTier)).toEqual([4, 8, 12]);
    const wave3 = createWaveLevel({ mode: 'daily', runSeed: 7, wave: 3 });
    expect(wave3.difficulty).toEqual(getDifficultyForLevel(12));
  });

  it('caps endless difficulty at the last campaign tier, even after 100 waves', () => {
    expect(endlessTier(1)).toBe(0);
    expect(endlessTier(500)).toBe(MAX_WAVE_TIER);
    const late = createWaveLevel({ mode: 'endless', runSeed: 42, wave: 140 });
    expect(late.difficulty).toEqual(getDifficultyForLevel(MAX_WAVE_TIER));
  });

  it('always generates clearable waves with breakable bricks', () => {
    for (let wave = 1; wave <= 120; wave += 1) {
      const level = createWaveLevel({ mode: 'endless', runSeed: 1234, wave });
      expect(level.bricks.some((brick) => brick.kind !== 'indestructible')).toBe(true);
    }
  });
});
