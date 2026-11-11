import { describe, expect, it } from 'vitest';
import { stepBall, type BallBody, type StepContext } from '../src/game/physics/ballStep';
import { BrickGrid, type GridItem } from '../src/game/physics/BrickGrid';
import { enforceMinVerticalAngle, sweepPointBox } from '../src/game/physics/geometry';
import {
  launchVelocity,
  paddleBounce,
  rampSpeed,
  separateFallers
} from '../src/game/physics/gameplayRules';

const PITCH_X = 24;
const PITCH_Y = 22;
const W = 21;
const H = 19;

interface TestBrick extends GridItem {
  alive: boolean;
}

function makeGrid(cells: Array<[col: number, row: number, solid?: boolean]>) {
  const grid = new BrickGrid<TestBrick>(36, 58, 0, 0, PITCH_X, PITCH_Y);
  cells.forEach(([col, row, solid]) => {
    const left = col * PITCH_X;
    const top = row * PITCH_Y;
    grid.set({
      col,
      row,
      solid: Boolean(solid),
      alive: true,
      box: { left, top, right: left + W, bottom: top + H }
    });
  });
  return grid;
}

function context(grid: BrickGrid<TestBrick>): StepContext<TestBrick> {
  return {
    bounds: { left: 0, right: 36 * PITCH_X, top: 0 },
    grid,
    paddle: null,
    bouncePaddle: (ball) => ({ vx: ball.vx, vy: -ball.vy }),
    isActive: (item) => item.alive
  };
}

describe('sweepPointBox', () => {
  const box = { left: 0, top: 0, right: 10, bottom: 10 };
  it('reports the face that is crossed', () => {
    expect(sweepPointBox(-5, 5, 10, 0, box)).toMatchObject({ axis: 'x', nx: -1, t: 0.5 });
    expect(sweepPointBox(5, -5, 0, 10, box)).toMatchObject({ axis: 'y', ny: -1, t: 0.5 });
    expect(sweepPointBox(5, 20, 0, -20, box)).toMatchObject({ axis: 'y', ny: 1 });
  });
  it('picks the dominant face on a diagonal corner approach', () => {
    const hit = sweepPointBox(-4, -10, 8, 16, box);
    expect(hit?.axis).toBe('y');
  });
  it('misses when the path does not reach the box', () => {
    expect(sweepPointBox(-5, 5, 2, 0, box)).toBeNull();
    expect(sweepPointBox(-5, 20, 30, 0, box)).toBeNull();
  });
});

describe('stepBall', () => {
  it('bounces off the top wall and side walls', () => {
    const grid = makeGrid([]);
    const ball: BallBody = { x: 100, y: 20, vx: 0, vy: -600, radius: 8 };
    const events = stepBall(ball, 0.05, context(grid));
    expect(events.some((e) => e.type === 'wall' && e.side === 'top')).toBe(true);
    expect(ball.vy).toBeGreaterThan(0);
    expect(ball.y).toBeGreaterThanOrEqual(8);
  });

  it('hits a single brick even when aimed at the gap between two bricks', () => {
    const grid = makeGrid([
      [5, 10],
      [6, 10]
    ]);
    // The seam between col 5 and 6 is at x = 5*24+21 .. 6*24 = 141..144.
    const ball: BallBody = { x: 142.5, y: 400, vx: 0, vy: -900, radius: 8 };
    const events = stepBall(ball, 0.5, context(grid));
    const bricks = events.filter((e) => e.type === 'brick');
    expect(bricks).toHaveLength(1);
    expect(ball.vy).toBeGreaterThan(0);
  });

  it('treats a row of bricks as one flat surface (no sideways kick on seams)', () => {
    const grid = makeGrid([
      [4, 10],
      [5, 10],
      [6, 10]
    ]);
    const ball: BallBody = { x: 120, y: 330, vx: 300, vy: -500, radius: 8 };
    const vxBefore = ball.vx;
    const events = stepBall(ball, 0.25, context(grid));
    const hit = events.find((e) => e.type === 'brick');
    expect(hit).toBeDefined();
    expect(ball.vx).toBe(vxBefore);
    expect(ball.vy).toBeGreaterThan(0);
  });

  it('never tunnels through a brick at maximum speed', () => {
    const grid = makeGrid([[10, 20]]);
    const ball: BallBody = { x: 10 * PITCH_X + 10, y: 700, vx: 0, vy: -1140, radius: 8 };
    for (let frame = 0; frame < 40; frame += 1) {
      stepBall(ball, 1 / 30, context(grid));
      expect(ball.y).toBeGreaterThan(20 * PITCH_Y + H);
      if (ball.vy > 0) break;
    }
    expect(ball.vy).toBeGreaterThan(0);
  });

  it('bounces off the paddle top only while falling', () => {
    const grid = makeGrid([]);
    const ctx = context(grid);
    ctx.paddle = { x: 400, top: 800, width: 200, height: 20 };
    ctx.bouncePaddle = (ball) => ({ vx: ball.vx, vy: -Math.abs(ball.vy) });
    const falling: BallBody = { x: 400, y: 760, vx: 0, vy: 600, radius: 8 };
    const events = stepBall(falling, 0.1, ctx);
    expect(events.some((e) => e.type === 'paddle')).toBe(true);
    expect(falling.vy).toBeLessThan(0);
    expect(falling.y).toBeLessThanOrEqual(800 - 8 + 0.1);
  });
});

describe('gameplay rules', () => {
  it('bounces wider toward the paddle edge and stays upward', () => {
    const centre = paddleBounce({
      ballX: 500,
      paddleX: 500,
      paddleWidth: 230,
      paddleVx: 0,
      speed: 600
    });
    const edge = paddleBounce({
      ballX: 615,
      paddleX: 500,
      paddleWidth: 230,
      paddleVx: 0,
      speed: 600
    });
    expect(Math.abs(centre.vx)).toBeLessThan(1);
    expect(edge.vx).toBeGreaterThan(400);
    expect(edge.vy).toBeLessThan(0);
    expect(Math.hypot(edge.vx, edge.vy)).toBeCloseTo(600, 3);
  });

  it('passes some of the paddle motion to the ball', () => {
    const still = paddleBounce({
      ballX: 500,
      paddleX: 500,
      paddleWidth: 230,
      paddleVx: 0,
      speed: 600
    });
    const moving = paddleBounce({
      ballX: 500,
      paddleX: 500,
      paddleWidth: 230,
      paddleVx: 1200,
      speed: 600
    });
    expect(moving.vx).toBeGreaterThan(still.vx + 50);
  });

  it('ramps speed up to the cap', () => {
    let speed = 540;
    for (let i = 0; i < 200; i += 1) speed = rampSpeed(speed, 900);
    expect(speed).toBe(900);
  });

  it('never lets the ball travel almost horizontally', () => {
    const v = enforceMinVerticalAngle(600, 1, 14);
    expect(Math.abs(v.vy)).toBeGreaterThan(140);
    expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(Math.hypot(600, 1), 3);
  });

  it('aims the launch toward the pointer', () => {
    const left = launchVelocity(600, -0.5, () => 0.5);
    const right = launchVelocity(600, 0.5, () => 0.5);
    expect(left.vx).toBeLessThan(0);
    expect(right.vx).toBeGreaterThan(0);
    expect(left.vy).toBeLessThan(0);
  });

  it('separates overlapping falling power-ups', () => {
    const items = [
      { x: 300, y: 500 },
      { x: 302, y: 505 },
      { x: 305, y: 498 }
    ];
    for (let i = 0; i < 30; i += 1) separateFallers(items, 64, 112, 968);
    for (let a = 0; a < items.length; a += 1) {
      for (let b = a + 1; b < items.length; b += 1) {
        const first = items[a]!;
        const second = items[b]!;
        expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThan(60);
      }
    }
  });
});

describe('BrickGrid', () => {
  it('detects steel walls between two points', () => {
    const grid = makeGrid([[5, 5, true]]);
    expect(grid.isBlocked(2 * PITCH_X, 5 * PITCH_Y + 5, 8 * PITCH_X, 5 * PITCH_Y + 5)).toBe(true);
    expect(grid.isBlocked(2 * PITCH_X, 8 * PITCH_Y, 8 * PITCH_X, 8 * PITCH_Y)).toBe(false);
  });
});
