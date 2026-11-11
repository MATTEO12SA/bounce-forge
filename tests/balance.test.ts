import { describe, expect, it } from 'vitest';
import { POWER_UP_TYPES, type PowerUpType } from '../src/game/config/powerUps';
import { campaignLevels } from '../src/game/levels/campaignLevels';
import {
  BALL_BONUS_DROP_TABLE,
  DROP_RATE_MULTIPLIER,
  dropTableFor
} from '../src/game/systems/PowerUpSystem';

/**
 * Expected power-up drops when a level is fully cleared (every brick broken once). This is the
 * balance report: run `npx vitest run tests/balance.test.ts --reporter=verbose` to read it.
 */
function expectedDrops(levelIndex: number): Record<PowerUpType, number> {
  const level = campaignLevels[levelIndex]!;
  const chapter = Math.floor(levelIndex / 6);
  const table = dropTableFor(chapter, level.options?.powerUps);
  const total = table.reduce((sum, entry) => sum + entry.weight, 0);
  const bonusTotal = BALL_BONUS_DROP_TABLE.reduce((sum, entry) => sum + entry.weight, 0);
  const rate = DROP_RATE_MULTIPLIER[level.options?.dropRate ?? 'normal'];
  const drops = Object.fromEntries(POWER_UP_TYPES.map((type) => [type, 0])) as Record<
    PowerUpType,
    number
  >;
  level.bricks.forEach((brick) => {
    if (brick.hitPoints === 0) return;
    if (brick.kind === 'bonus') {
      BALL_BONUS_DROP_TABLE.forEach((entry) => {
        drops[entry.type] += entry.weight / bonusTotal;
      });
      return;
    }
    const chance = Math.min(0.95, brick.powerUpChance * rate);
    table.forEach((entry) => {
      drops[entry.type] += (chance * entry.weight) / total;
    });
  });
  return drops;
}

describe('campaign balance', () => {
  const report = campaignLevels.map((level, index) => {
    const drops = expectedDrops(index);
    const total = Object.values(drops).reduce((sum, value) => sum + value, 0);
    const extraBalls = drops.multiBall + drops.splitBall;
    const risk = drops.turbo + drops.shrinkPaddle;
    return { name: level.name, total, ballShare: extraBalls / total, riskShare: risk / total };
  });

  it('prints the balance report', () => {
    const lines = report.map(
      (row, index) =>
        `${String(index + 1).padStart(2)} ${row.name.padEnd(17)} drops ${row.total.toFixed(0).padStart(4)}  balls ${(row.ballShare * 100).toFixed(0).padStart(3)}%  risk ${(row.riskShare * 100).toFixed(0).padStart(2)}%`
    );
    console.log(lines.join('\n'));
    expect(lines).toHaveLength(campaignLevels.length);
  });

  it('drops enough power-ups to stay lively, without flooding the screen', () => {
    report.forEach((row) => {
      expect(row.total, row.name).toBeGreaterThan(15);
      expect(row.total, row.name).toBeLessThan(200);
    });
  });

  it('keeps extra balls the core of the game without crowding out the rest', () => {
    // Bonus bricks always drop extra balls, so treasure levels (Spark, Vault) are ball-heavy on
    // purpose; random drops alone are capped at 30 % per power-up (powerUpSystem tests).
    report.forEach((row) => expect(row.ballShare, row.name).toBeLessThan(0.75));
    const average = report.reduce((sum, row) => sum + row.ballShare, 0) / report.length;
    expect(average).toBeLessThan(0.55);
  });

  it('keeps risk capsules occasional', () => {
    report.forEach((row) => expect(row.riskShare, row.name).toBeLessThan(0.15));
  });
});
