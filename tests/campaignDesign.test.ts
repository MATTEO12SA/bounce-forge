import { describe, expect, it } from 'vitest';
import { EDITOR_GRID_COLS, EDITOR_GRID_ROWS } from '../shared/editorGridRules.mjs';
import { estimateDifficulty, reachableCells, sealedBricks } from '../src/game/levels/levelChecks';
import { CAMPAIGN_ART, CAMPAIGN_CHAPTERS, LEVEL_PATTERNS } from '../src/game/levels/levelPatterns';

const BREAKABLE = /[123EBS]/;

describe('campaign level design', () => {
  it('has 36 distinct levels in 6 chapters of 6', () => {
    expect(LEVEL_PATTERNS).toHaveLength(36);
    expect(new Set(LEVEL_PATTERNS.map((level) => level.id)).size).toBe(36);
    const chapters = LEVEL_PATTERNS.map((level) => level.chapter);
    expect(new Set(chapters).size).toBe(6);
    expect([...new Set(chapters)]).toEqual([...CAMPAIGN_CHAPTERS]);
    for (let i = 0; i < 36; i += 6) {
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

  it('draws every level within 18 pixels and pairs every teleporter', () => {
    CAMPAIGN_ART.forEach((level) => {
      level.art.forEach((row) => expect(row.length, level.id).toBeLessThanOrEqual(18));
      const portals = level.art.join('').split('T').length - 1;
      expect(portals % 2, level.id).toBe(0);
    });
  });

  it('introduces every mechanism in the campaign, one chapter at a time', () => {
    const firstLevel = (symbol: string) =>
      LEVEL_PATTERNS.findIndex((level) => level.rows.some((row) => row.includes(symbol)));
    const intro = Object.fromEntries(
      [...'CKGRIMOTF'].map((symbol) => [symbol, firstLevel(symbol)])
    );
    Object.values(intro).forEach((index) => expect(index).toBeGreaterThanOrEqual(0));
    // Keys/gates, bumpers and teleporters in chapter 2, fuses and phoenix in 3, movers and ghosts in 4.
    expect(Math.floor(intro.K! / 6)).toBe(1);
    expect(Math.floor(intro.O! / 6)).toBe(1);
    expect(Math.floor(intro.T! / 6)).toBe(1);
    expect(Math.floor(intro.F! / 6)).toBe(2);
    expect(Math.floor(intro.R! / 6)).toBe(2);
    expect(Math.floor(intro.M! / 6)).toBe(3);
    expect(Math.floor(intro.I! / 6)).toBe(3);
  });

  it('keeps the bosses for the last chapter, with room to move', () => {
    LEVEL_PATTERNS.forEach((level, index) => {
      const hasBoss = level.rows.some((row) => row.includes('W'));
      expect(hasBoss, level.id).toBe(Math.floor(index / 6) === 5);
      if (!hasBoss) return;
      // Every row of a boss has free cells beside it, so it can slide.
      level.rows
        .filter((row) => row.includes('W'))
        .forEach((row) =>
          expect(row.replace(/W+/g, '').length, level.id).toBeGreaterThanOrEqual(4)
        );
    });
  });

  it('gets harder from one chapter to the next', () => {
    const average = (chapter: number) =>
      LEVEL_PATTERNS.slice(chapter * 6, chapter * 6 + 6).reduce(
        (sum, level) => sum + estimateDifficulty(level.rows, level.options),
        0
      ) / 6;
    for (let chapter = 1; chapter < 6; chapter += 1) {
      expect(average(chapter)).toBeGreaterThanOrEqual(average(chapter - 1) - 0.2);
    }
    expect(average(4)).toBeGreaterThan(average(0));
  });
});
