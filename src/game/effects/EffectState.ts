import {
  getPowerUpDefinition,
  OPPOSITES,
  SCORE_MULTIPLIERS,
  type PowerUpType
} from '../config/powerUps';

/**
 * Pure bookkeeping of active effects, ticked with game time (so pause and slow motion apply).
 * GameScene reads it to drive visuals; tests use it directly.
 */

export type ComboId = 'meteor' | 'explosiveLasers' | 'sun';

export const MAX_SHIELD_CHARGES = 3;
export const MAX_EXPLOSIVE_CHARGES = 9;
export const EXPLOSIVE_CHARGES_PER_PICKUP = 3;

export interface ActivationResult {
  /** The opposite effect that was cancelled, if any. */
  cancelled?: PowerUpType;
  /** Combos that became active because of this pickup. */
  newCombos: ComboId[];
}

export class EffectState {
  private readonly remaining = new Map<PowerUpType, number>();
  public explosiveCharges = 0;
  public shieldCharges = 0;

  public has(type: PowerUpType): boolean {
    return (this.remaining.get(type) ?? 0) > 0;
  }

  public timeLeft(type: PowerUpType): number {
    return this.remaining.get(type) ?? 0;
  }

  /** Active timed effects with their remaining share (0..1), for the HUD. */
  public list(): Array<{ type: PowerUpType; ratio: number }> {
    return [...this.remaining.entries()].map(([type, ms]) => ({
      type,
      ratio: Math.min(1, ms / Math.max(1, getPowerUpDefinition(type).durationMs))
    }));
  }

  public activate(type: PowerUpType): ActivationResult {
    const before = this.combos();
    const definition = getPowerUpDefinition(type);
    let cancelled: PowerUpType | undefined;
    const opposite = OPPOSITES[type];
    if (opposite && this.remaining.has(opposite)) {
      this.remaining.delete(opposite);
      cancelled = opposite;
    }
    if (type === 'explosiveBall') {
      this.explosiveCharges = Math.min(
        MAX_EXPLOSIVE_CHARGES,
        this.explosiveCharges + EXPLOSIVE_CHARGES_PER_PICKUP
      );
    } else if (type === 'shield') {
      this.shieldCharges = Math.min(MAX_SHIELD_CHARGES, this.shieldCharges + 1);
    } else if (definition.durationMs > 0) {
      const current = this.remaining.get(type) ?? 0;
      this.remaining.set(type, Math.min(definition.maxDurationMs, current + definition.durationMs));
    }
    const after = this.combos();
    return { cancelled, newCombos: after.filter((combo) => !before.includes(combo)) };
  }

  /** Advances time and returns the effects that just ended. */
  public tick(deltaMs: number): PowerUpType[] {
    const expired: PowerUpType[] = [];
    this.remaining.forEach((ms, type) => {
      const next = ms - deltaMs;
      if (next <= 0) {
        this.remaining.delete(type);
        expired.push(type);
      } else {
        this.remaining.set(type, next);
      }
    });
    return expired;
  }

  public end(type: PowerUpType): boolean {
    return this.remaining.delete(type);
  }

  public useExplosiveCharge(): boolean {
    if (this.explosiveCharges <= 0) return false;
    // The meteor combo makes fire explosions free.
    if (!this.has('fireBall')) this.explosiveCharges -= 1;
    return true;
  }

  public useShield(): boolean {
    if (this.shieldCharges <= 0) return false;
    this.shieldCharges -= 1;
    return true;
  }

  public combos(): ComboId[] {
    const combos: ComboId[] = [];
    if (this.has('fireBall') && this.explosiveCharges > 0) combos.push('meteor');
    if (this.has('laserPaddle') && this.explosiveCharges > 0) combos.push('explosiveLasers');
    if (this.has('bigBall') && this.has('fireBall')) combos.push('sun');
    return combos;
  }

  /** Product of the score multipliers of active effects, capped at ×4. */
  public scoreMultiplier(): number {
    let multiplier = 1;
    this.remaining.forEach((_, type) => {
      multiplier *= SCORE_MULTIPLIERS[type] ?? 1;
    });
    return Math.min(4, multiplier);
  }

  /** How fast balls travel compared with normal. */
  public ballTimeScale(): number {
    let scale = 1;
    if (this.has('slowMotion')) scale *= 0.6;
    if (this.has('turbo')) scale *= 1.3;
    if (this.has('bigBall')) scale *= 0.88;
    return scale;
  }

  /** Paddle width factor from wide/shrink/laser. */
  public paddleScale(): number {
    let scale = 1;
    if (this.has('widePaddle')) scale *= 1.38;
    if (this.has('shrinkPaddle')) scale *= 0.65;
    if (this.has('laserPaddle')) scale *= 0.9;
    return scale;
  }

  public clear(): void {
    this.remaining.clear();
    this.explosiveCharges = 0;
    this.shieldCharges = 0;
  }
}
