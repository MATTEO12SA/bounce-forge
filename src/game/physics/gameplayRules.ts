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
export function launchVelocity(speed: number, aimOffset: number | null, random: () => number) {
  const offset = aimOffset === null ? (random() * 2 - 1) * 0.35 : clamp(aimOffset, -0.6, 0.6);
  const angle = offset * (Math.PI / 4);
  return { vx: Math.sin(angle) * speed, vy: -Math.cos(angle) * speed };
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
