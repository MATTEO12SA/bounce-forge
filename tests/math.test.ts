import { describe, expect, it } from 'vitest';
import {
  avoidAxisLock,
  calculatePaddleBounceVelocity,
  clampVelocitySpeed,
  magnitude
} from '../src/game/utils/math';

describe('math utilities', () => {
  it('calculates a centered paddle bounce upward', () => {
    const velocity = calculatePaddleBounceVelocity({
      ballX: 100,
      paddleX: 100,
      paddleWidth: 120,
      speed: 400,
      maxAngleDegrees: 64
    });

    expect(Math.abs(velocity.x)).toBeLessThan(0.001);
    expect(velocity.y).toBeLessThan(0);
    expect(Math.round(magnitude(velocity))).toBe(400);
  });

  it('clamps velocity while preserving direction', () => {
    const velocity = clampVelocitySpeed({ x: 600, y: 0 }, 100, 300);

    expect(Math.round(magnitude(velocity))).toBe(300);
    expect(velocity.x).toBeGreaterThan(0);
  });

  it('avoids near-axis locked movement', () => {
    const velocity = avoidAxisLock({ x: 1, y: -400 }, 72);

    expect(Math.abs(velocity.x)).toBeGreaterThan(50);
    expect(velocity.y).toBeLessThan(0);
  });
});
