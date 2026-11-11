import { describe, expect, it } from 'vitest';
import { EDITOR_GRID_COLS, EDITOR_GRID_ROWS } from '../shared/editorGridRules.mjs';
import { LEVEL_PATTERNS } from '../src/game/levels/levelPatterns';

const BREAKABLE = /[123EBS]/;

/** Cells reachable from the bottom row without crossing steel (breakable bricks can be broken). */
function reachable(rows: string[]): boolean[][] {
  const seen = rows.map((row) => [...row].map(() => false));
  const queue: Array<[number, number]> = [];
  const bottom = rows.length - 1;
  for (let col = 0; col < EDITOR_GRID_COLS; col += 1) {
    if (rows[bottom]?.[col] !== 'X') {
      seen[bottom]![col] = true;
      queue.push([bottom, col]);
    }
  }
  while (queue.length > 0) {
    const [row, col] = queue.shift()!;
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ] as const) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= rows.length || c < 0 || c >= EDITOR_GRID_COLS) continue;
      if (seen[r]![c] || rows[r]![c] === 'X') continue;
      seen[r]![c] = true;
      queue.push([r, c]);
    }
  }
  return seen;
}

describe('campaign level design', () => {
  it('has 24 distinct levels in 4 chapters of 6', () => {
    expect(LEVEL_PATTERNS).toHaveLength(24);
    expect(new Set(LEVEL_PATTERNS.map((level) => level.id)).size).toBe(24);
    const chapters = LEVEL_PATTERNS.map((level) => level.chapter);
    expect(new Set(chapters).size).toBe(4);
    for (let i = 0; i < 24; i += 6) {
      expect(new Set(chapters.slice(i, i + 6)).size).toBe(1);
    }
  });

  it.each(LEVEL_PATTERNS.map((level, index) => [index + 1, level] as const))(
    'level %i fits the grid and every brick can be reached',
    (_, level) => {
      expect(level.rows).toHaveLength(EDITOR_GRID_ROWS);
      level.rows.forEach((row) => expect(row).toHaveLength(EDITOR_GRID_COLS));
      // Room above the bricks and a wide empty area above the paddle.
      expect(level.rows.slice(0, 3).join('')).toMatch(/^\.+$/);
      expect(level.rows.slice(30).join('')).toMatch(/^\.+$/);

      const seen = reachable(level.rows);
      let breakable = 0;
      level.rows.forEach((row, r) =>
        [...row].forEach((symbol, c) => {
          if (BREAKABLE.test(symbol)) {
            breakable += 1;
            expect(seen[r]![c], `${level.name} cell ${r},${c} is sealed in steel`).toBe(true);
          }
        })
      );
      expect(breakable).toBeGreaterThan(100);
      expect(level.medalTargets?.goldScore).toBeGreaterThan(0);
    }
  );
});
