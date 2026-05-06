import Phaser from 'phaser';
import { DEPTHS } from '../utils/constants';
import type { BrickSpec } from '../levels/levelTypes';

export class Brick extends Phaser.GameObjects.Rectangle {
  private hitPoints: number;
  private pulseTween?: Phaser.Tweens.Tween;

  public constructor(
    scene: Phaser.Scene,
    public readonly spec: BrickSpec
  ) {
    super(scene, spec.x, spec.y, spec.width, spec.height, spec.color, 1);

    this.hitPoints = spec.hitPoints;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(DEPTHS.bricks);
    this.setStrokeStyle(
      spec.kind === 'indestructible' ? 3 : 2,
      spec.kind === 'indestructible' ? 0xb8f3ff : 0xd8fbff,
      spec.kind === 'indestructible' ? 0.82 : 0.56
    );

    const body = this.arcadeBody;
    body.setAllowGravity(false);
    body.setImmovable(true);
    body.setSize(spec.width, spec.height);

    if (spec.kind === 'bonus') {
      this.pulseTween = scene.tweens.add({
        targets: this,
        alpha: { from: 1, to: 0.78 },
        duration: 720,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    } else if (spec.kind === 'explosive') {
      this.pulseTween = scene.tweens.add({
        targets: this,
        scaleX: { from: 1, to: 1.04 },
        scaleY: { from: 1, to: 1.04 },
        duration: 540,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    }
  }

  public get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  public get remainingHitPoints(): number {
    return this.hitPoints;
  }

  public get isBreakable(): boolean {
    return this.spec.kind !== 'indestructible';
  }

  public damage(amount: number): boolean {
    if (!this.isBreakable || this.hitPoints <= 0) {
      return false;
    }

    this.hitPoints = Math.max(0, this.hitPoints - amount);
    this.refreshDamageState();
    return this.hitPoints === 0;
  }

  public override destroy(fromScene?: boolean): void {
    this.pulseTween?.stop();
    this.pulseTween = undefined;
    super.destroy(fromScene);
  }

  private refreshDamageState(): void {
    if (this.spec.maxHitPoints <= 1) {
      return;
    }

    const ratio = this.hitPoints / this.spec.maxHitPoints;
    if (this.spec.kind !== 'bonus' && this.spec.kind !== 'explosive') {
      this.setAlpha(0.52 + ratio * 0.48);
    }
    this.setScale(0.94 + ratio * 0.06, 1);
  }
}
