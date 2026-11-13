import { describe, expect, it } from 'vitest';
import { createEmptyRows } from '../shared/editorGridRules.mjs';
import { requiredBricks } from '../src/community/rules';
import { sealedBricks } from '../src/game/levels/levelChecks';
import {
  aimSpeed,
  boltHitsPaddle,
  bossDamage,
  bossMaxHealth,
  bossPhase,
  PHASE_TIMING,
  volleySpeeds
} from '../src/game/mechanics/boss';

describe('boss rules', () => {
  it('scales health with size without dragging on', () => {
    expect(bossMaxHealth(48)).toBe(22);
    expect(bossMaxHealth(224)).toBe(66);
    expect(bossMaxHealth(0)).toBe(10);
  });

  it('enrages in three phases', () => {
    expect(bossPhase(30, 30)).toBe(1);
    expect(bossPhase(20, 30)).toBe(2);
    expect(bossPhase(10, 30)).toBe(3);
    expect(bossPhase(0, 30)).toBe(3);
    expect(PHASE_TIMING[3].fireMs).toBeLessThan(PHASE_TIMING[1].fireMs);
    expect(PHASE_TIMING[3].shots).toBeGreaterThan(PHASE_TIMING[1].shots);
  });

  it('takes one point per hit, two for strong hits', () => {
    expect(bossDamage(1)).toBe(1);
    expect(bossDamage(2)).toBe(2);
    expect(bossDamage(99)).toBe(2);
  });

  it('aims bolts at the paddle and fans out volleys', () => {
    expect(aimSpeed(540, 540, 800)).toBe(0);
    expect(aimSpeed(200, 900, 800)).toBeGreaterThan(0);
    expect(Math.abs(aimSpeed(0, 5000, 100))).toBe(420);
    expect(volleySpeeds(1, 50)).toEqual([50]);
    expect(volleySpeeds(3, 0, 100)).toEqual([-100, 0, 100]);
  });

  it('detects a bolt on the paddle', () => {
    expect(boltHitsPaddle(540, 1700, 540, 1700, 200)).toBe(true);
    expect(boltHitsPaddle(700, 1700, 540, 1700, 200)).toBe(false);
    expect(boltHitsPaddle(540, 1500, 540, 1700, 200)).toBe(false);
  });

  it('counts boss armour as bricks to break, and spots a boss sealed in steel', () => {
    const rows = createEmptyRows();
    rows[5] = `.XXXX${'.'.repeat(31)}`;
    rows[6] = `.XWWX${'.'.repeat(31)}`;
    rows[7] = `.XXXX${'.'.repeat(31)}`;
    expect(requiredBricks(rows)).toBe(2);
    expect(sealedBricks(rows)).toEqual([
      { col: 2, row: 6 },
      { col: 3, row: 6 }
    ]);
    rows[7] = `.X..X${'.'.repeat(31)}`;
    expect(sealedBricks(rows)).toEqual([]);
  });
});
