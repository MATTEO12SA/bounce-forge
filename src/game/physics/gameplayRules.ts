import { clamp, enforceMinVerticalAngle, setSpeed } from './geometry';

/** Widest angle from vertical when hitting the very edge of the paddle. */
export const PADDLE_MAX_ANGLE_DEGREES = 62;
/** Share of the paddle's own speed passed on to the ball ("english"). */
export const PADDLE_SPIN_TRANSFER = 0.14;

/**
 * Curved-paddle bounce: the further from the centre, the wider the angle (with an ease so the
 * middle stays controllable), plus a little of the paddle's movement.
 */
export function paddleBounce(input: {
  ballX: number;
  paddleX: number;
  paddleWidth: number;
  paddleVx: number;
  speed: number;
}): { vx: number; vy: number; offset: number } {
  const half = Math.max(1, input.paddleWidth / 2);
  const offset = clamp((input.ballX - input.paddleX) / half, -1, 1);
  const eased = Math.sign(offset) * Math.pow(Math.abs(offset), 0.85);
  const angle = (eased * PADDLE_MAX_ANGLE_DEGREES * Math.PI) / 180;
  let vx =
    Math.sin(angle) * input.speed + clamp(input.paddleVx, -2000, 2000) * PADDLE_SPIN_TRANSFER;
  let vy = -Math.cos(angle) * input.speed;
  ({ vx, vy } = setSpeed(vx, vy, input.speed));
  ({ vx, vy } = enforceMinVerticalAngle(vx, vy, 90 - PADDLE_MAX_ANGLE_DEGREES - 4));
  return { vx, vy: -Math.abs(vy), offset };
}

/**
 * Speed rises a little on every paddle hit so rallies build tension, then caps
 * (Jake Gordon's breakout pacing notes).
 */
export function rampSpeed(current: number, max: number, step = 7): number {
  return Math.min(max, current + step);
}

/** Launch angle: aimed toward the pointer when known, otherwise a gentle random tilt. */
/** Widest launch angle from vertical when aiming. */
export const MAX_AIM_RADIANS = (70 * Math.PI) / 180;

/**
 * Launch velocity for an aim angle in radians from vertical (positive = right). Without an aim,
 * the ball leaves with a gentle random tilt.
 */
export function launchVelocity(speed: number, aimAngle: number | null, random: () => number) {
  const angle =
    aimAngle === null
      ? (random() * 2 - 1) * 0.26
      : clamp(aimAngle, -MAX_AIM_RADIANS, MAX_AIM_RADIANS);
  return { vx: Math.sin(angle) * speed, vy: -Math.cos(angle) * speed };
}

/** Aim angle from the ball toward the pointer, clamped so the ball always goes up. */
export function aimAngleToward(
  ballX: number,
  ballY: number,
  pointerX: number,
  pointerY: number
): number {
  const dx = pointerX - ballX;
  const dy = ballY - pointerY;
  if (dy < 12) {
    // Pointer at or below the ball: aim as far as allowed toward that side.
    return dx === 0 ? 0 : Math.sign(dx) * MAX_AIM_RADIANS;
  }
  return clamp(Math.atan2(dx, dy), -MAX_AIM_RADIANS, MAX_AIM_RADIANS);
}

/**
 * Points of the predicted path from (x, y) along an aim angle, bouncing off the side walls,
 * used to draw the aiming guide.
 */
export function aimPath(
  x: number,
  y: number,
  angle: number,
  length: number,
  left: number,
  right: number
): Array<{ x: number; y: number }> {
  const points = [{ x, y }];
  let dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  let px = x;
  let py = y;
  let remaining = length;
  for (let bounce = 0; bounce < 3 && remaining > 0; bounce += 1) {
    const wallX = dx > 0 ? right : left;
    const toWall = dx === 0 ? Infinity : (wallX - px) / dx;
    const step = Math.min(remaining, toWall);
    px += dx * step;
    py += dy * step;
    points.push({ x: px, y: py });
    remaining -= step;
    dx = -dx;
  }
  return points;
}

export interface Faller {
  x: number;
  y: number;
}

/**
 * Pushes falling power-ups apart horizontally so they never overlap, while keeping them
 * inside the playfield. O(n²) on at most a few dozen items.
 */
export function separateFallers(
  items: Faller[],
  minDistance: number,
  left: number,
  right: number,
  strength = 0.5
): void {
  for (let a = 0; a < items.length; a += 1) {
    for (let b = a + 1; b < items.length; b += 1) {
      const first = items[a];
      const second = items[b];
      if (!first || !second) continue;
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const distance = Math.hypot(dx, dy);
      if (distance >= minDistance) continue;
      const overlap = (minDistance - distance) * strength;
      // Separate sideways only: vertical order keeps them readable while they fall.
      const direction = dx === 0 ? (a % 2 === 0 ? 1 : -1) : Math.sign(dx);
      first.x -= (direction * overlap) / 2;
      second.x += (direction * overlap) / 2;
    }
  }
  const half = minDistance / 2;
  items.forEach((item) => {
    item.x = clamp(item.x, left + half, right - half);
  });
}
