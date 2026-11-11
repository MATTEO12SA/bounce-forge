import { EDITOR_GRID_COLS } from '../../../shared/editorGridRules.mjs';
import type { LevelOptions } from './levelOptions';

/** Symbols the ball can break. */
export const BREAKABLE_SYMBOL_PATTERN = /[123EBSCKGRIMF]/;
/** Symbols that must be destroyed to win (phoenix respawns, gates open by themselves). */
const REQUIRED = /[123EBSCKIMF]/;
/** Never breakable: steel, bumpers and (conservatively) teleporters. */
const ALWAYS_BLOCKING = new Set(['X', 'O', 'T']);

/**
 * Cells reachable from the bottom row without crossing a blocking cell. Breakable bricks count
 * as open (the ball can break through them).
 */
export function reachableCells(
  rows: readonly string[],
  blocking: ReadonlySet<string> = ALWAYS_BLOCKING
): boolean[][] {
  const seen = rows.map((row) => Array.from({ length: row.length }, () => false));
  const queue: Array<[number, number]> = [];
  const bottom = rows.length - 1;
  for (let col = 0; col < EDITOR_GRID_COLS; col += 1) {
    const symbol = rows[bottom]?.[col];
    if (symbol !== undefined && !blocking.has(symbol)) {
      seen[bottom]![col] = true;
      queue.push([bottom, col]);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const [row, col] = queue[head]!;
    const neighbours: Array<[number, number]> = [
      [row + 1, col],
      [row - 1, col],
      [row, col + 1],
      [row, col - 1]
    ];
    for (const [r, c] of neighbours) {
      const symbol = rows[r]?.[c];
      if (symbol === undefined || blocking.has(symbol) || seen[r]![c]) continue;
      seen[r]![c] = true;
      queue.push([r, c]);
    }
  }
  return seen;
}

/**
 * Bricks that can never be reached, so the level could never be won. Gates count as walls until
 * every key is reachable; after that they open by themselves.
 */
export function sealedBricks(rows: readonly string[]): Array<{ col: number; row: number }> {
  const closed = reachableCells(rows, new Set([...ALWAYS_BLOCKING, 'G']));
  const sealedKeys: Array<{ col: number; row: number }> = [];
  rows.forEach((row, r) =>
    [...row].forEach((symbol, c) => {
      if (symbol === 'K' && !closed[r]?.[c]) sealedKeys.push({ col: c, row: r });
    })
  );
  const open = sealedKeys.length === 0 ? reachableCells(rows) : closed;
  const sealed: Array<{ col: number; row: number }> = [...sealedKeys];
  rows.forEach((row, r) =>
    [...row].forEach((symbol, c) => {
      if (symbol !== 'K' && REQUIRED.test(symbol) && !open[r]?.[c]) {
        sealed.push({ col: c, row: r });
      }
    })
  );
  return sealed;
}

/** Rough difficulty from 1 to 5 stars: hit points, steel and how few bonus bricks there are. */
export function estimateDifficulty(rows: readonly string[], options?: LevelOptions): number {
  let breakable = 0;
  let hitPoints = 0;
  let steel = 0;
  let helpers = 0;
  let explosive = 0;
  const hp: Record<string, number> = {
    '1': 1,
    '2': 2,
    '3': 3,
    E: 1,
    B: 1,
    S: 4,
    C: 1,
    K: 1,
    G: 1,
    I: 1.5,
    M: 1.5,
    F: 1,
    R: 0.5
  };
  rows.forEach((row) =>
    [...row].forEach((symbol) => {
      if (symbol === 'X' || symbol === 'G') steel += 1;
      if (symbol === 'O' || symbol === 'T') steel += 0.5;
      const value = hp[symbol];
      if (value === undefined) return;
      breakable += 1;
      hitPoints += value;
      if (symbol === 'B' || symbol === 'C') helpers += 1;
      if (symbol === 'E' || symbol === 'F') explosive += 1;
    })
  );
  if (breakable === 0) return 1;
  // A descending wall adds pressure; fewer lives or a faster pace too.
  const events =
    (options?.descendEverySec ? 1 : 0) +
    (options?.pace === 'fast' ? 0.6 : options?.pace === 'slow' ? -0.6 : 0) +
    (options?.lives !== undefined ? (3 - options.lives) * 0.4 : 0);
  const score =
    events +
    hitPoints / 260 +
    steel / 160 +
    (hitPoints / breakable - 1) * 1.2 -
    (helpers / breakable) * 5 -
    (explosive / breakable) * 2;
  return Math.max(1, Math.min(5, Math.round(1 + score)));
}
