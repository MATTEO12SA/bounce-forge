import type Phaser from 'phaser';
import { DEPTHS } from '../utils/constants';

const SPARK_TEXTURE = 'forge-spark';
const EMBER_TEXTURE = 'forge-ember';

export class ParticleSystem {
  private readonly hitEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly breakEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly explosionEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private nextTint = 0xffffff;

  public constructor(private readonly scene: Phaser.Scene) {
    const sparkKey = scene.textures.exists(SPARK_TEXTURE) ? SPARK_TEXTURE : '__DEFAULT';
    const emberKey = scene.textures.exists(EMBER_TEXTURE) ? EMBER_TEXTURE : sparkKey;

    this.hitEmitter = scene.add.particles(0, 0, sparkKey, {
      speed: { min: 60, max: 220 },
      scale: { start: 0.95, end: 0.15 },
      alpha: { start: 0.92, end: 0 },
      lifespan: { min: 220, max: 380 },
      gravityY: 180,
      rotate: { min: 0, max: 360 },
      emitting: false,
      tint: this.tintProvider()
    });
    this.hitEmitter.setDepth(DEPTHS.particles);

    this.breakEmitter = scene.add.particles(0, 0, sparkKey, {
      speed: { min: 90, max: 320 },
      scale: { start: 1.1, end: 0.18 },
      alpha: { start: 0.95, end: 0 },
      lifespan: { min: 280, max: 520 },
      gravityY: 220,
      rotate: { min: 0, max: 360 },
      emitting: false,
      tint: this.tintProvider()
    });
    this.breakEmitter.setDepth(DEPTHS.particles);

    this.explosionEmitter = scene.add.particles(0, 0, emberKey, {
      speed: { min: 140, max: 460 },
      scale: { start: 1.4, end: 0.15 },
      alpha: { start: 1, end: 0 },
      lifespan: { min: 360, max: 660 },
      gravityY: 240,
      rotate: { min: 0, max: 360 },
      emitting: false,
      tint: this.tintProvider()
    });
    this.explosionEmitter.setDepth(DEPTHS.particles);
  }

  public burst(x: number, y: number, color: number, count = 14): void {
    if (count <= 0) {
      return;
    }
    this.nextTint = color;
    if (count >= 24) {
      this.explosionEmitter.emitParticleAt(x, y, count);
    } else if (count >= 12) {
      this.breakEmitter.emitParticleAt(x, y, count);
    } else {
      this.hitEmitter.emitParticleAt(x, y, count);
    }
  }

  public shake(intensity = 0.004, duration = 110): void {
    this.scene.cameras.main.shake(duration, intensity);
  }

  private tintProvider(): { onEmit: () => number } {
    return {
      onEmit: () => this.nextTint
    };
  }
}
