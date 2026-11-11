import type Phaser from 'phaser';
import { TEX } from '../render/textures';
import { DEPTHS, PLAYFIELD_BOTTOM, PLAYFIELD_LEFT, PLAYFIELD_WIDTH } from '../utils/constants';

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;

/**
 * Shared particle emitters: brick shards that tumble and fall, glowing sparks, ball trails and
 * slow embers rising in the background. Emitters are created once per scene and tinted per
 * burst, so a 96-ball storm never allocates new game objects.
 */
export class ParticleSystem {
  private readonly shards: Emitter;
  private readonly sparks: Emitter;
  private readonly trail: Emitter;
  private readonly smoke: Emitter;
  private embers: Emitter | null = null;
  private nextTint = 0xffffff;

  public constructor(
    private readonly scene: Phaser.Scene,
    private readonly scale = 1
  ) {
    const tint = { onEmit: (): number => this.nextTint };

    this.shards = scene.add.particles(0, 0, TEX.shard, {
      speed: { min: 140, max: 420 },
      angle: { min: 200, max: 340 },
      gravityY: 1400,
      lifespan: { min: 480, max: 820 },
      scale: { start: 1.5, end: 0.6 },
      alpha: { start: 1, end: 0 },
      rotate: { min: 0, max: 360 },
      emitting: false,
      tint
    });
    this.shards.setDepth(DEPTHS.particles);

    this.sparks = scene.add.particles(0, 0, TEX.glow, {
      speed: { min: 160, max: 520 },
      lifespan: { min: 160, max: 340 },
      scale: { start: 0.32, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: 'ADD',
      emitting: false,
      tint
    });
    this.sparks.setDepth(DEPTHS.particles + 1);

    this.trail = scene.add.particles(0, 0, TEX.glow, {
      speed: 0,
      // Kept subtle on purpose: a light wisp, not a comet tail.
      lifespan: 110,
      scale: { start: 0.2, end: 0 },
      alpha: { start: 0.2, end: 0 },
      blendMode: 'ADD',
      emitting: false,
      tint: 0xffb44a
    });
    this.trail.setDepth(DEPTHS.ball - 1);

    this.smoke = scene.add.particles(0, 0, TEX.glow, {
      speed: { min: 20, max: 90 },
      lifespan: { min: 500, max: 900 },
      scale: { start: 0.9, end: 2.2 },
      alpha: { start: 0.22, end: 0 },
      emitting: false,
      tint: 0x2a1d10
    });
    this.smoke.setDepth(DEPTHS.particles - 1);
  }

  /** Rising embers in the background of the playfield (disabled with reduced motion). */
  public startEmbers(): void {
    if (this.embers) return;
    this.embers = this.scene.add.particles(0, 0, TEX.ember, {
      x: { min: PLAYFIELD_LEFT, max: PLAYFIELD_LEFT + PLAYFIELD_WIDTH },
      y: PLAYFIELD_BOTTOM - 10,
      speedY: { min: -70, max: -25 },
      speedX: { min: -14, max: 14 },
      lifespan: { min: 7000, max: 12000 },
      scale: { start: 0.9, end: 0.2 },
      alpha: { start: 0.55, end: 0 },
      frequency: 260,
      quantity: 1,
      blendMode: 'ADD'
    });
    this.embers.setDepth(DEPTHS.background + 1);
  }

  public brickShatter(x: number, y: number, color: number, count = 10): void {
    this.nextTint = color;
    this.shards.emitParticleAt(x, y, Math.max(2, Math.round(count * this.scale)));
    this.sparks.emitParticleAt(x, y, Math.max(1, Math.round(count * 0.5 * this.scale)));
  }

  public sparkBurst(x: number, y: number, color: number, count = 6): void {
    this.nextTint = color;
    this.sparks.emitParticleAt(x, y, Math.max(1, Math.round(count * this.scale)));
  }

  public explosion(x: number, y: number, color: number): void {
    this.nextTint = color;
    this.sparks.emitParticleAt(x, y, Math.round(22 * this.scale));
    this.shards.emitParticleAt(x, y, Math.round(12 * this.scale));
    this.smoke.emitParticleAt(x, y, Math.round(6 * this.scale));
  }

  public trailAt(x: number, y: number): void {
    this.trail.emitParticleAt(x, y, 1);
  }

  /** Kept for compatibility with FxManager callers. */
  public burst(x: number, y: number, color: number, count = 14): void {
    if (count >= 12) {
      this.brickShatter(x, y, color, count * 0.6);
    } else {
      this.sparkBurst(x, y, color, count);
    }
  }
}
