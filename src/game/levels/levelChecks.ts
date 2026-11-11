import { EDITOR_GRID_COLS } from '../../../shared/editorGridRules.mjs';

/** Symbols the ball can break. */
export const BREAKABLE_SYMBOL_PATTERN = /[123EBS]/;

/**
 * Cells reachable from the bottom row without crossing steel. Breakable bricks count as open
 * (the ball can break through them), so an unreachable breakable brick is sealed in steel and
 * the level could never be finished.
 */
export function reachableCells(rows: readonly string[]): boolean[][] {
  const seen = rows.map((row) => Array.from({ length: row.length }, () => false));
  const queue: Array<[number, number]> = [];
  const bottom = rows.length - 1;
  for (let col = 0; col < EDITOR_GRID_COLS; col += 1) {
    if (rows[bottom]?.[col] !== undefined && rows[bottom]?.[col] !== 'X') {
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
      if (symbol === undefined || symbol === 'X' || seen[r]![c]) continue;
      seen[r]![c] = true;
      queue.push([r, c]);
    }
  }
  return seen;
}

/** Breakable bricks that can never be reached because steel walls them in. */
export function sealedBricks(rows: readonly string[]): Array<{ col: number; row: number }> {
  const seen = reachableCells(rows);
  const sealed: Array<{ col: number; row: number }> = [];
  rows.forEach((row, r) =>
    [...row].forEach((symbol, c) => {
      if (BREAKABLE_SYMBOL_PATTERN.test(symbol) && !seen[r]?.[c]) {
        sealed.push({ col: c, row: r });
      }
    })
  );
  return sealed;
}

/** Rough difficulty from 1 to 5 stars: hit points, steel and how few bonus bricks there are. */
export function estimateDifficulty(rows: readonly string[]): number {
  let breakable = 0;
  let hitPoints = 0;
  let steel = 0;
  let bonus = 0;
  let explosive = 0;
  const hp: Record<string, number> = { '1': 1, '2': 2, '3': 3, E: 1, B: 1, S: 4 };
  rows.forEach((row) =>
    [...row].forEach((symbol) => {
      if (symbol === 'X') steel += 1;
      const value = hp[symbol];
      if (value === undefined) return;
      breakable += 1;
      hitPoints += value;
      if (symbol === 'B') bonus += 1;
      if (symbol === 'E') explosive += 1;
    })
  );
  if (breakable === 0) return 1;
  const score =
    hitPoints / 260 +
    steel / 160 +
    (hitPoints / breakable - 1) * 1.2 -
    (bonus / breakable) * 5 -
    (explosive / breakable) * 2;
  return Math.max(1, Math.min(5, Math.round(1 + score)));
}
