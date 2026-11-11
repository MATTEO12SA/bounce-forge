/**
 * Pure rules of the special bricks, kept out of the scene so they can be unit-tested.
 *
 * Levels are drawn as pixel art where one pixel is a 2 × 2 block of cells, so teleporters and
 * moving bricks work on connected groups of cells, not on single cells.
 */

export interface CellItem {
  col: number;
  row: number;
}

/** 4-connected groups of cells, sorted in reading order of their first cell. */
export function groupCells<T extends CellItem>(items: readonly T[]): T[][] {
  const byKey = new Map(items.map((item) => [`${item.col},${item.row}`, item]));
  const seen = new Set<T>();
  const groups: T[][] = [];
  const sorted = [...items].sort((a, b) => a.row - b.row || a.col - b.col);
  for (const start of sorted) {
    if (seen.has(start)) continue;
    const group: T[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const item = stack.pop()!;
      group.push(item);
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ] as const) {
        const next = byKey.get(`${item.col + dc},${item.row + dr}`);
        if (next && !seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    group.sort((a, b) => a.row - b.row || a.col - b.col);
    groups.push(group);
  }
  return groups;
}

/**
 * Teleporter portals (connected groups) pair up in reading order: 1st ↔ 2nd, 3rd ↔ 4th…
 * Every cell maps to the cells of its twin portal; a lone portal stays unpaired (a wall).
 */
export function pairTeleporters<T extends CellItem>(items: readonly T[]): Map<T, T[]> {
  const portals = groupCells(items);
  const pairs = new Map<T, T[]>();
  for (let index = 0; index + 1 < portals.length; index += 2) {
    const a = portals[index]!;
    const b = portals[index + 1]!;
    a.forEach((cell) => pairs.set(cell, b));
    b.forEach((cell) => pairs.set(cell, a));
  }
  return pairs;
}

/**
 * One step of a moving group: every leading cell must find a free cell ahead, otherwise the
 * group turns around. Returns null when it is boxed in.
 */
export function moveGroup(
  cells: readonly CellItem[],
  dir: 1 | -1,
  cols: number,
  isFree: (col: number, row: number) => boolean
): { dx: 1 | -1; dir: 1 | -1 } | null {
  const own = new Set(cells.map((cell) => `${cell.col},${cell.row}`));
  const canMove = (d: 1 | -1): boolean =>
    cells.every((cell) => {
      const col = cell.col + d;
      if (own.has(`${col},${cell.row}`)) return true;
      return col >= 0 && col < cols && isFree(col, cell.row);
    });
  if (canMove(dir)) return { dx: dir, dir };
  const back: 1 | -1 = dir === 1 ? -1 : 1;
  if (canMove(back)) return { dx: back, dir: back };
  return null;
}

/** Single-cell convenience kept for clarity in tests. */
export function moverStep(
  col: number,
  dir: 1 | -1,
  cols: number,
  isFree: (col: number) => boolean
): { col: number; dir: 1 | -1 } | null {
  const step = moveGroup([{ col, row: 0 }], dir, cols, (c) => isFree(c));
  return step ? { col: col + step.dx, dir: step.dir } : null;
}

/** Where a ball leaves a teleporter: just outside the exit, along its direction of travel. */
export function teleportExit(
  exit: { x: number; y: number; halfWidth: number; halfHeight: number },
  vx: number,
  vy: number,
  radius: number
): { x: number; y: number } {
  const speed = Math.hypot(vx, vy) || 1;
  const ux = vx / speed;
  const uy = vy / speed;
  // Distance to leave the exit box along (ux, uy), plus the ball radius and a small margin.
  const tx = ux === 0 ? Infinity : exit.halfWidth / Math.abs(ux);
  const ty = uy === 0 ? Infinity : exit.halfHeight / Math.abs(uy);
  const distance = Math.min(tx, ty) + radius + 3;
  return { x: exit.x + ux * distance, y: exit.y + uy * distance };
}
