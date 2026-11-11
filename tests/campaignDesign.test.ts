import { describe, expect, it } from 'vitest';
import { EDITOR_GRID_COLS, EDITOR_GRID_ROWS } from '../shared/editorGridRules.mjs';
import { estimateDifficulty, reachableCells, sealedBricks } from '../src/game/levels/levelChecks';
import { LEVEL_PATTERNS } from '../src/game/levels/levelPatterns';

const BREAKABLE = /[123EBS]/;

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

      expect(sealedBricks(level.rows)).toEqual([]);
      const seen = reachableCells(level.rows);
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
      expect(estimateDifficulty(level.rows)).toBeGreaterThanOrEqual(1);
    }
  );
});
