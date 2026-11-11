import Phaser from 'phaser';
import { TEX } from './textures';
import { DEPTHS } from '../utils/constants';

const POPUP_POOL = 18;

/**
 * Game feel ("juice"), dosed so it supports the action instead of hiding it:
 * trauma-based screen shake, hit-stop, slow motion, floating scores, shockwave rings and
 * flashes. Everything is turned off or toned down when the player asks for reduced motion.
 */
export class Juice {
  private trauma = 0;
  private freezeMs = 0;
  private slowMs = 0;
  private slowFactor = 1;
  private time = 0;
  private readonly popups: Phaser.GameObjects.Text[] = [];
  private popupIndex = 0;
  private lastPopupAt = -1000;
  private readonly comboLabel: Phaser.GameObjects.Text;
  private comboShown = 0;

  public constructor(
    private readonly scene: Phaser.Scene,
    private readonly reducedMotion: boolean
  ) {
    for (let index = 0; index < POPUP_POOL; index += 1) {
      const text = scene.add
        .text(0, 0, '', {
          fontFamily: 'system-ui, "Segoe UI", Arial, sans-serif',
          fontSize: '30px',
          fontStyle: '900',
          color: '#fff4d6',
          stroke: '#2a1606',
          strokeThickness: 6
        })
        .setOrigin(0.5)
        .setDepth(DEPTHS.particles + 5)
        .setVisible(false);
      this.popups.push(text);
    }
    this.comboLabel = scene.add
      .text(540, 1420, '', {
        fontFamily: 'system-ui, "Segoe UI", Arial, sans-serif',
        fontSize: '84px',
        fontStyle: '900',
        color: '#ffb423',
        stroke: '#1a0e04',
        strokeThickness: 10
      })
      .setOrigin(0.5)
      .setDepth(DEPTHS.particles + 4)
      .setAlpha(0);
  }

  /** Adds shake trauma (0..1). Shake grows with trauma² so small hits stay subtle. */
  public shake(amount: number): void {
    if (this.reducedMotion) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Freezes the physics for a few milliseconds so a big impact registers. */
  public freeze(ms: number): void {
    if (this.reducedMotion) return;
    this.freezeMs = Math.max(this.freezeMs, ms);
  }

  public slowMotion(factor: number, ms: number): void {
    this.slowFactor = factor;
    this.slowMs = ms;
  }

  /** Physics delta after hit-stop and slow motion. */
  public scaleDelta(deltaMs: number): number {
    if (this.freezeMs > 0) {
      this.freezeMs -= deltaMs;
      return 0;
    }
    if (this.slowMs > 0) {
      this.slowMs -= deltaMs;
      return deltaMs * this.slowFactor;
    }
    return deltaMs;
  }

  public update(deltaMs: number): void {
    this.time += deltaMs;
    const camera = this.scene.cameras.main;
    if (this.trauma > 0) {
      const power = this.trauma * this.trauma;
      const t = this.time / 1000;
      camera.setScroll(
        Math.sin(t * 61.3) * 18 * power + Math.sin(t * 23.1) * 6 * power,
        Math.cos(t * 57.7) * 18 * power + Math.cos(t * 19.3) * 6 * power
      );
      camera.setRotation(Math.sin(t * 41) * 0.012 * power);
      this.trauma = Math.max(0, this.trauma - deltaMs / 520);
      if (this.trauma === 0) {
        camera.setScroll(0, 0);
        camera.setRotation(0);
      }
    }
  }

  /** Expanding ring (paddle hit, explosion shockwave, power-up pickup). */
  public ring(x: number, y: number, color: number, size = 1, durationMs = 320): void {
    const ring = this.scene.add
      .image(x, y, TEX.ring)
      .setTint(color)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTHS.particles + 2)
      .setScale(0.12 * size)
      .setAlpha(0.9);
    this.scene.tweens.add({
      targets: ring,
      scale: size,
      alpha: 0,
      duration: durationMs,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy()
    });
  }

  /** Soft additive flash of light. */
  public glow(
    x: number,
    y: number,
    color: number,
    width: number,
    height: number,
    durationMs = 220,
    alpha = 0.85
  ): void {
    const glow = this.scene.add
      .image(x, y, TEX.glow)
      .setTint(color)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTHS.particles - 2)
      .setDisplaySize(width, height)
      .setAlpha(alpha);
    this.scene.tweens.add({
      targets: glow,
      alpha: 0,
      duration: durationMs,
      ease: 'Quad.easeOut',
      onComplete: () => glow.destroy()
    });
  }

  /** Floating score text, throttled so storms of breaks stay readable. */
  public popup(
    x: number,
    y: number,
    text: string,
    color = '#fff4d6',
    size = 30,
    force = false
  ): void {
    if (!force && this.time - this.lastPopupAt < 70) {
      return;
    }
    this.lastPopupAt = this.time;
    const label = this.popups[this.popupIndex];
    this.popupIndex = (this.popupIndex + 1) % this.popups.length;
    if (!label) return;
    this.scene.tweens.killTweensOf(label);
    label
      .setText(text)
      .setColor(color)
      .setFontSize(size)
      .setPosition(x, y)
      .setScale(0.6)
      .setAlpha(1)
      .setVisible(true);
    this.scene.tweens.add({
      targets: label,
      y: y - (this.reducedMotion ? 30 : 70),
      scale: 1,
      duration: 260,
      ease: 'Back.easeOut'
    });
    this.scene.tweens.add({
      targets: label,
      alpha: 0,
      delay: 380,
      duration: 260,
      onComplete: () => label.setVisible(false)
    });
  }

  /** Big combo counter shown in the lower part of the playfield. */
  public combo(streak: number): void {
    if (streak < 5) {
      if (this.comboShown >= 5) {
        this.scene.tweens.killTweensOf(this.comboLabel);
        this.scene.tweens.add({ targets: this.comboLabel, alpha: 0, duration: 260 });
      }
      this.comboShown = streak;
      return;
    }
    if (streak === this.comboShown) return;
    this.comboShown = streak;
    this.comboLabel.setText(`×${streak}`);
    this.scene.tweens.killTweensOf(this.comboLabel);
    this.comboLabel.setAlpha(0.85).setScale(this.reducedMotion ? 1 : 1.25);
    this.scene.tweens.add({
      targets: this.comboLabel,
      scale: 1,
      duration: 180,
      ease: 'Back.easeOut'
    });
    this.scene.tweens.add({ targets: this.comboLabel, alpha: 0.35, delay: 400, duration: 600 });
  }
}
