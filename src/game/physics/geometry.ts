/** Pure 2D helpers for the custom ball physics. No Phaser import: everything is unit-tested. */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Axis = 'x' | 'y';

export interface SweepHit {
  /** Fraction of the motion (0..1) at which contact happens. */
  t: number;
  axis: Axis;
  /** Outward normal of the face that was hit (-1, 0 or 1 per component). */
  nx: number;
  ny: number;
  /** True when the ball already overlapped the box at the start of the motion. */
  embedded: boolean;
}

export function inflate(box: Box, amount: number): Box {
  return {
    left: box.left - amount,
    top: box.top - amount,
    right: box.right + amount,
    bottom: box.bottom + amount
  };
}

/**
 * Sweeps a point from (x, y) by (dx, dy) against a box (usually a brick inflated by the ball
 * radius). Returns the entry time and the face that was crossed, using the slab method: the
 * axis whose slab is entered last is the face that was hit, which gives clean, predictable
 * reflections even on corners.
 */
export function sweepPointBox(
  x: number,
  y: number,
  dx: number,
  dy: number,
  box: Box
): SweepHit | null {
  const inside = x > box.left && x < box.right && y > box.top && y < box.bottom;
  if (inside) {
    // Already overlapping: push out through the shallowest face.
    const penLeft = x - box.left;
    const penRight = box.right - x;
    const penTop = y - box.top;
    const penBottom = box.bottom - y;
    const minX = Math.min(penLeft, penRight);
    const minY = Math.min(penTop, penBottom);
    if (minX < minY) {
      return { t: 0, axis: 'x', nx: penLeft < penRight ? -1 : 1, ny: 0, embedded: true };
    }
    return { t: 0, axis: 'y', nx: 0, ny: penTop < penBottom ? -1 : 1, embedded: true };
  }

  let tEnterX: number;
  let tExitX: number;
  if (dx === 0) {
    if (x <= box.left || x >= box.right) return null;
    tEnterX = -Infinity;
    tExitX = Infinity;
  } else {
    const t1 = (box.left - x) / dx;
    const t2 = (box.right - x) / dx;
    tEnterX = Math.min(t1, t2);
    tExitX = Math.max(t1, t2);
  }

  let tEnterY: number;
  let tExitY: number;
  if (dy === 0) {
    if (y <= box.top || y >= box.bottom) return null;
    tEnterY = -Infinity;
    tExitY = Infinity;
  } else {
    const t1 = (box.top - y) / dy;
    const t2 = (box.bottom - y) / dy;
    tEnterY = Math.min(t1, t2);
    tExitY = Math.max(t1, t2);
  }

  const tEnter = Math.max(tEnterX, tEnterY);
  const tExit = Math.min(tExitX, tExitY);
  if (tEnter > tExit || tEnter < 0 || tEnter > 1) {
    return null;
  }

  if (tEnterX > tEnterY) {
    return { t: tEnter, axis: 'x', nx: dx > 0 ? -1 : 1, ny: 0, embedded: false };
  }
  return { t: tEnter, axis: 'y', nx: 0, ny: dy > 0 ? -1 : 1, embedded: false };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Keeps a velocity from going (almost) horizontal, which would bore the player. */
export function enforceMinVerticalAngle(
  vx: number,
  vy: number,
  minDegrees = 14
): { vx: number; vy: number } {
  const speed = Math.hypot(vx, vy);
  if (speed === 0) {
    return { vx: 0, vy: -1 };
  }
  const minVy = speed * Math.sin((minDegrees * Math.PI) / 180);
  if (Math.abs(vy) >= minVy) {
    return { vx, vy };
  }
  const signY = vy === 0 ? -1 : Math.sign(vy);
  const signX = vx === 0 ? 1 : Math.sign(vx);
  const newVy = signY * minVy;
  const newVx = signX * Math.sqrt(Math.max(0, speed * speed - newVy * newVy));
  return { vx: newVx, vy: newVy };
}

export function setSpeed(vx: number, vy: number, speed: number): { vx: number; vy: number } {
  const length = Math.hypot(vx, vy);
  if (length === 0) {
    return { vx: 0, vy: -speed };
  }
  return { vx: (vx / length) * speed, vy: (vy / length) * speed };
}
