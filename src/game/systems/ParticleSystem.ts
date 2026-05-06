import Phaser from 'phaser';
import { DEPTHS, MAX_ACTIVE_PARTICLES } from '../utils/constants';

export class ParticleSystem {
  private activeParticles = 0;

  public constructor(private readonly scene: Phaser.Scene) {}

  public burst(x: number, y: number, color: number, count = 14): void {
    const available = Math.max(0, MAX_ACTIVE_PARTICLES - this.activeParticles);
    const spawnCount = Math.min(count, available);

    for (let index = 0; index < spawnCount; index += 1) {
      this.activeParticles += 1;
      const particle = this.scene.add
        .rectangle(x, y, 7, 7, color, 0.82)
        .setDepth(DEPTHS.particles)
        .setRotation(Math.random() * Math.PI);
      const angle = Math.random() * Math.PI * 2;
      const distance = Phaser.Math.Between(42, 112);

      this.scene.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scale: 0.2,
        rotation: particle.rotation + Phaser.Math.FloatBetween(-2.5, 2.5),
        duration: Phaser.Math.Between(220, 440),
        ease: 'Quad.easeOut',
        onComplete: () => {
          particle.destroy();
          this.activeParticles = Math.max(0, this.activeParticles - 1);
        }
      });
    }
  }

  public shake(intensity = 0.004, duration = 110): void {
    this.scene.cameras.main.shake(duration, intensity);
  }
}
