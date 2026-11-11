/**
 * Pure rules of the special bricks, kept out of the scene so they can be unit-tested.
 */

export interface CellItem {
  col: number;
  row: number;
}

/** Teleporters pair up in reading order (1st ↔ 2nd, 3rd ↔ 4th…); a lone one stays unpaired. */
export function pairTeleporters<T extends CellItem>(items: readonly T[]): Map<T, T> {
  const sorted = [...items].sort((a, b) => a.row - b.row || a.col - b.col);
  const pairs = new Map<T, T>();
  for (let index = 0; index + 1 < sorted.length; index += 2) {
    const a = sorted[index]!;
    const b = sorted[index + 1]!;
    pairs.set(a, b);
    pairs.set(b, a);
  }
  return pairs;
}

/**
 * Next column of a moving brick: one step in its direction, or back the other way when the
 * cell is taken or outside the grid. Returns null when it is boxed in.
 */
export function moverStep(
  col: number,
  dir: 1 | -1,
  cols: number,
  isFree: (col: number) => boolean
): { col: number; dir: 1 | -1 } | null {
  const ahead = col + dir;
  if (ahead >= 0 && ahead < cols && isFree(ahead)) {
    return { col: ahead, dir };
  }
  const back = col - dir;
  if (back >= 0 && back < cols && isFree(back)) {
    return { col: back, dir: dir === 1 ? -1 : 1 };
  }
  return null;
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
