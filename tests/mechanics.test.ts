import { describe, expect, it } from 'vitest';
import { createEmptyRows, validateRows } from '../shared/editorGridRules.mjs';
import { createLevelFromPattern } from '../src/game/levels/levelFactory';
import { sealedBricks } from '../src/game/levels/levelChecks';
import { moverStep, pairTeleporters, teleportExit } from '../src/game/mechanics/mechanics';
import { stepBall, type BallBody } from '../src/game/physics/ballStep';
import { BrickGrid, type GridItem } from '../src/game/physics/BrickGrid';

function rowsWith(cells: Array<[row: number, text: string]>): string[] {
  const rows = createEmptyRows();
  cells.forEach(([row, text]) => {
    rows[row] = text.padEnd(36, '.').slice(0, 36);
  });
  return rows;
}

describe('special bricks in levels', () => {
  it('builds every new symbol with its kind', () => {
    const level = createLevelFromPattern(
      { id: 't', name: 't', rows: rowsWith([[5, 'CKGRIMOTF1']]) },
      0
    );
    expect(level.bricks.map((brick) => brick.kind)).toEqual([
      'crystal',
      'key',
      'gate',
      'phoenix',
      'invisible',
      'mover',
      'bumper',
      'teleporter',
      'fuse',
      'standard'
    ]);
    expect(level.bricks.find((brick) => brick.kind === 'bumper')?.hitPoints).toBe(0);
  });

  it('needs a brick that must be destroyed to be valid', () => {
    expect(validateRows(rowsWith([[3, 'RRRGGG']])).valid).toBe(false);
    expect(validateRows(rowsWith([[3, 'RRRGGGC']])).valid).toBe(true);
  });

  it('treats gates as walls until every key is reachable', () => {
    // A box of gates with a brick inside, key outside: fine.
    const open = rowsWith([
      [3, 'GGG'],
      [4, 'G1G'],
      [5, 'GGG'],
      [8, 'K']
    ]);
    expect(sealedBricks(open)).toEqual([]);
    // The only key is locked inside gates: it can never be reached.
    const locked = rowsWith([
      [3, 'GGG'],
      [4, 'GKG'],
      [5, 'GGG']
    ]);
    expect(sealedBricks(locked)).toEqual([{ col: 1, row: 4 }]);
    // Bumpers and teleporters wall bricks in like steel.
    const walled = rowsWith([
      [3, 'OTO'],
      [4, 'X1X'],
      [5, 'XOX']
    ]);
    expect(sealedBricks(walled)).toEqual([{ col: 1, row: 4 }]);
  });
});

describe('mechanism rules', () => {
  it('pairs teleporters in reading order', () => {
    const a = { col: 5, row: 2 };
    const b = { col: 1, row: 9 };
    const c = { col: 30, row: 2 };
    const pairs = pairTeleporters([b, c, a]);
    expect(pairs.get(a)).toBe(c);
    expect(pairs.get(c)).toBe(a);
    expect(pairs.has(b)).toBe(false);
  });

  it('moves a sliding brick and bounces it off walls and bricks', () => {
    expect(moverStep(4, 1, 36, () => true)).toEqual({ col: 5, dir: 1 });
    expect(moverStep(35, 1, 36, () => true)).toEqual({ col: 34, dir: -1 });
    expect(moverStep(4, 1, 36, (col) => col !== 5)).toEqual({ col: 3, dir: -1 });
    expect(moverStep(4, 1, 36, () => false)).toBeNull();
  });

  it('puts a teleported ball just outside the exit, along its path', () => {
    const exit = teleportExit({ x: 100, y: 100, halfWidth: 10, halfHeight: 9 }, 0, -600, 8);
    expect(exit.x).toBeCloseTo(100);
    expect(exit.y).toBeCloseTo(100 - 9 - 8 - 3);
  });
});

describe('fire ball physics', () => {
  it('flies through bricks that allow it and reports each once', () => {
    interface Item extends GridItem {
      id: number;
    }
    const grid = new BrickGrid<Item>(36, 58, 0, 0, 24, 22);
    [10, 11, 12].forEach((row, id) =>
      grid.set({
        id,
        col: 5,
        row,
        solid: false,
        box: { left: 120, right: 141, top: row * 22, bottom: row * 22 + 19 }
      })
    );
    const ball: BallBody = { x: 130, y: 400, vx: 0, vy: -900, radius: 8 };
    const events = stepBall(ball, 0.4, {
      bounds: { left: 0, right: 864, top: 0 },
      grid,
      paddle: null,
      bouncePaddle: (b) => ({ vx: b.vx, vy: -b.vy }),
      isActive: () => true,
      passThrough: () => true
    });
    const bricks = events.filter((event) => event.type === 'brick');
    expect(bricks).toHaveLength(3);
    expect(bricks.every((event) => event.type === 'brick' && event.pierced)).toBe(true);
    expect(ball.vy).toBeLessThan(0);
  });
});

describe('BF3 share codes', () => {
  it('carries level settings and stays BF2 without them', async () => {
    const { encodeCreativeLevelCode, decodeCreativeLevelCode } = await import(
      '../src/game/levels/levelShare'
    );
    const rows = rowsWith([[3, '111K']]);
    expect(encodeCreativeLevelCode(rows, 'Plain').startsWith('BF2:')).toBe(true);
    const code = encodeCreativeLevelCode(rows, 'Orage', {
      storm: true,
      lives: 9,
      powerUps: ['fireBall', 'nope' as never]
    });
    expect(code.startsWith('BF3:')).toBe(true);
    expect(decodeCreativeLevelCode(code)).toMatchObject({
      name: 'Orage',
      options: { storm: true, lives: 5, powerUps: ['fireBall'] }
    });
  });
});
