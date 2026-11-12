/**
 * Pure rules of the bosses (chapter 6), kept out of the scene so they can be unit-tested.
 *
 * A boss is a connected group of `W` cells sharing one health bar. Hitting any of its cells
 * costs it one point of health (two for strong hits); several cells hit at the same moment (an
 * explosion, a fireball going through) count once. As it weakens it moves faster and fires more
 * bolts at the paddle; a bolt that hits the paddle stuns it for a moment.
 */

export type BossPhase = 1 | 2 | 3;

/** After a hit, the boss ignores further damage for this long (multi-cell hits count once). */
export const BOSS_INVULNERABLE_MS = 90;
/** Score bonus for defeating a boss (multiplied by the level's score multiplier). */
export const BOSS_DEFEAT_BONUS = 2500;
/** How long a bolt stuns the paddle. */
export const BOSS_STUN_MS = 700;
/** Points lost when a bolt hits the paddle. */
export const BOSS_HIT_PENALTY = 200;
/** Bolt speed in px/s. */
export const BOSS_BOLT_SPEED = 560;
/** How long the boss glows before firing (warning). */
export const BOSS_TELEGRAPH_MS = 450;

/** Health of a boss made of `cells` cells: bigger bosses last longer, without dragging on. */
export function bossMaxHealth(cells: number): number {
  return Math.round(10 + Math.max(0, cells) * 0.25);
}

export function bossPhase(health: number, maxHealth: number): BossPhase {
  const ratio = maxHealth > 0 ? health / maxHealth : 0;
  return ratio > 2 / 3 ? 1 : ratio > 1 / 3 ? 2 : 3;
}

export interface PhaseTiming {
  /** Time between two one-cell moves. */
  moveMs: number;
  /** Time between two volleys. */
  fireMs: number;
  /** Bolts per volley. */
  shots: number;
}

export const PHASE_TIMING: Record<BossPhase, PhaseTiming> = {
  1: { moveMs: 900, fireMs: 3200, shots: 1 },
  2: { moveMs: 640, fireMs: 2500, shots: 2 },
  3: { moveMs: 440, fireMs: 1900, shots: 3 }
};

/** Damage a hit deals: strong hits (fireball, big ball, explosions) deal 2. */
export function bossDamage(amount: number): number {
  return amount >= 2 ? 2 : 1;
}

/**
 * Horizontal speeds of a volley: the middle bolt aims at the paddle, the others fan out.
 * `aim` is the horizontal speed that would reach the paddle.
 */
export function volleySpeeds(shots: number, aim: number, spread = 170): number[] {
  const count = Math.max(1, Math.floor(shots));
  return Array.from({ length: count }, (_, index) => aim + (index - (count - 1) / 2) * spread);
}

/** Horizontal speed that brings a bolt from `fromX` to `toX` while falling `height` px. */
export function aimSpeed(
  fromX: number,
  toX: number,
  height: number,
  speed = BOSS_BOLT_SPEED
): number {
  const time = Math.max(0.2, height / speed);
  return Math.max(-420, Math.min(420, (toX - fromX) / time));
}

/** Whether a bolt at (x, y) touches the paddle (centre `paddleX`, top `paddleTop`, `width`). */
export function boltHitsPaddle(
  x: number,
  y: number,
  paddleX: number,
  paddleTop: number,
  width: number,
  radius = 12
): boolean {
  return (
    y + radius >= paddleTop &&
    y - radius <= paddleTop + 24 &&
    Math.abs(x - paddleX) <= width / 2 + radius
  );
}
