import type { BrickGrid, GridItem } from './BrickGrid';
import { inflate, sweepPointBox, type Box, type SweepHit } from './geometry';

export interface BallBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface PaddleBody {
  x: number;
  /** Top surface y. */
  top: number;
  width: number;
  height: number;
}

export interface PlayfieldBounds {
  left: number;
  right: number;
  top: number;
}

export type StepEvent<T> =
  | { type: 'wall'; side: 'left' | 'right' | 'top'; x: number; y: number }
  | { type: 'brick'; item: T; x: number; y: number; nx: number; ny: number }
  | { type: 'paddle'; x: number; y: number };

export interface StepContext<T extends GridItem> {
  bounds: PlayfieldBounds;
  grid: BrickGrid<T>;
  paddle: PaddleBody | null;
  /** Called on a paddle contact; must return the new velocity. */
  bouncePaddle: (ball: BallBody) => { vx: number; vy: number };
  /** Bricks hit during this step are not bounced off twice. */
  isActive: (item: T) => boolean;
}

const EPSILON = 0.01;
const MAX_COLLISIONS_PER_SUBSTEP = 4;
const scratch: GridItem[] = [];

/**
 * Advances one ball by `dt` seconds with continuous collision detection.
 *
 * The motion is split into sub-steps no longer than half the radius, and inside each sub-step
 * the earliest contact (wall, brick or paddle) is resolved exactly, then the rest of the motion
 * continues. A ball can damage at most one brick per sub-step, which removes the classic
 * "double hit" through the gap between two bricks.
 */
export function stepBall<T extends GridItem>(
  ball: BallBody,
  dt: number,
  ctx: StepContext<T>,
  events: Array<StepEvent<T>> = []
): Array<StepEvent<T>> {
  const distance = Math.hypot(ball.vx, ball.vy) * dt;
  const maxStep = Math.max(1, ball.radius * 0.5);
  const substeps = Math.max(1, Math.ceil(distance / maxStep));
  const h = dt / substeps;

  for (let step = 0; step < substeps; step += 1) {
    let remaining = 1;
    let brickHitThisStep = false;

    for (let pass = 0; pass < MAX_COLLISIONS_PER_SUBSTEP && remaining > 0; pass += 1) {
      const dx = ball.vx * h * remaining;
      const dy = ball.vy * h * remaining;
      let best: {
        hit: SweepHit;
        kind: 'wall' | 'brick' | 'paddle';
        item?: T;
        side?: 'left' | 'right' | 'top';
      } | null = null;

      // Walls (the bottom is open).
      const r = ball.radius;
      const left = ctx.bounds.left + r;
      const right = ctx.bounds.right - r;
      const top = ctx.bounds.top + r;
      if (dx < 0 && ball.x + dx < left) {
        const t = ball.x <= left ? 0 : (left - ball.x) / dx;
        best = { hit: { t, axis: 'x', nx: 1, ny: 0, embedded: false }, kind: 'wall', side: 'left' };
      } else if (dx > 0 && ball.x + dx > right) {
        const t = ball.x >= right ? 0 : (right - ball.x) / dx;
        best = {
          hit: { t, axis: 'x', nx: -1, ny: 0, embedded: false },
          kind: 'wall',
          side: 'right'
        };
      }
      if (dy < 0 && ball.y + dy < top) {
        const t = ball.y <= top ? 0 : (top - ball.y) / dy;
        if (!best || t < best.hit.t) {
          best = {
            hit: { t, axis: 'y', nx: 0, ny: 1, embedded: false },
            kind: 'wall',
            side: 'top'
          };
        }
      }

      // Bricks around the swept path.
      if (!brickHitThisStep) {
        const swept: Box = {
          left: Math.min(ball.x, ball.x + dx) - r,
          right: Math.max(ball.x, ball.x + dx) + r,
          top: Math.min(ball.y, ball.y + dy) - r,
          bottom: Math.max(ball.y, ball.y + dy) + r
        };
        const candidates = ctx.grid.query(swept, scratch as T[]);
        for (const item of candidates) {
          if (!ctx.isActive(item)) continue;
          const hit = sweepPointBox(ball.x, ball.y, dx, dy, inflate(item.box, r));
          if (!hit) continue;
          // Moving away from an embedded brick: let the ball leave.
          if (hit.embedded && ball.vx * hit.nx + ball.vy * hit.ny > 0) continue;
          const resolved = resolveInternalEdge(ctx.grid, item, hit, ball, ctx.isActive);
          if (!best || resolved.t < best.hit.t) {
            best = { hit: resolved, kind: 'brick', item };
          }
        }
      }

      // Paddle: only its top face, only while the ball falls.
      if (ctx.paddle && ball.vy > 0) {
        const paddle = ctx.paddle;
        const box: Box = {
          left: paddle.x - paddle.width / 2,
          right: paddle.x + paddle.width / 2,
          top: paddle.top,
          bottom: paddle.top + paddle.height
        };
        const hit = sweepPointBox(ball.x, ball.y, dx, dy, inflate(box, r));
        if (hit && hit.ny === -1 && ball.y <= paddle.top + paddle.height * 0.5) {
          if (!best || hit.t < best.hit.t) {
            best = { hit, kind: 'paddle' };
          }
        }
      }

      if (!best) {
        ball.x += dx;
        ball.y += dy;
        break;
      }

      const { hit } = best;
      ball.x += dx * hit.t + hit.nx * EPSILON;
      ball.y += dy * hit.t + hit.ny * EPSILON;
      remaining *= 1 - hit.t;
      if (hit.embedded) {
        pushOut(ball, best.item?.box, hit);
      }

      if (best.kind === 'paddle') {
        const next = ctx.bouncePaddle(ball);
        ball.vx = next.vx;
        ball.vy = -Math.abs(next.vy);
        events.push({ type: 'paddle', x: ball.x, y: ball.y });
        continue;
      }

      if (hit.axis === 'x') {
        ball.vx = hit.nx * Math.abs(ball.vx);
      } else {
        ball.vy = hit.ny * Math.abs(ball.vy);
      }

      if (best.kind === 'wall' && best.side) {
        events.push({ type: 'wall', side: best.side, x: ball.x, y: ball.y });
      } else if (best.kind === 'brick' && best.item) {
        brickHitThisStep = true;
        events.push({
          type: 'brick',
          item: best.item,
          x: ball.x - hit.nx * r,
          y: ball.y - hit.ny * r,
          nx: hit.nx,
          ny: hit.ny
        });
      }
    }
  }

  return events;
}

/**
 * When the face that was hit touches another brick (the seam between two neighbours), it is
 * not a real surface: bounce on the other axis instead. This is what keeps a row of bricks or
 * a steel wall behaving like one flat surface.
 */
function resolveInternalEdge<T extends GridItem>(
  grid: BrickGrid<T>,
  item: T,
  hit: SweepHit,
  ball: BallBody,
  isActive: (item: T) => boolean
): SweepHit {
  const neighbour = grid.get(item.col + hit.nx, item.row + hit.ny);
  if (!neighbour || !isActive(neighbour)) {
    return hit;
  }
  if (hit.axis === 'x') {
    const ny = ball.vy > 0 ? -1 : 1;
    const other = grid.get(item.col, item.row + ny);
    if (other && isActive(other)) return hit;
    return { ...hit, axis: 'y', nx: 0, ny };
  }
  const nx = ball.vx > 0 ? -1 : 1;
  const other = grid.get(item.col + nx, item.row);
  if (other && isActive(other)) return hit;
  return { ...hit, axis: 'x', nx, ny: 0 };
}

function pushOut(ball: BallBody, box: Box | undefined, hit: SweepHit): void {
  if (!box) return;
  const r = ball.radius + EPSILON;
  if (hit.axis === 'x') {
    ball.x = hit.nx < 0 ? box.left - r : box.right + r;
  } else {
    ball.y = hit.ny < 0 ? box.top - r : box.bottom + r;
  }
}
