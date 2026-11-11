import Phaser from 'phaser';
import { DEPTHS } from '../utils/constants';
import type { BrickKind, BrickSpec } from '../levels/levelTypes';

/** Each kind gets a distinct outline so bricks stay recognisable without relying on colour. */
const BRICK_OUTLINES: Record<BrickKind, { width: number; color: number; alpha: number }> = {
  standard: { width: 2, color: 0x3a2706, alpha: 0.55 },
  resistant: { width: 3, color: 0x8a5a00, alpha: 0.9 },
  explosive: { width: 3, color: 0xffe0b8, alpha: 0.95 },
  bonus: { width: 2, color: 0xe4fff4, alpha: 0.9 },
  shield: { width: 4, color: 0xe6f3ff, alpha: 0.95 },
  indestructible: { width: 3, color: 0xa8a092, alpha: 0.9 }
};

export class Brick extends Phaser.GameObjects.Rectangle {
  private hitPoints: number;

  public constructor(
    scene: Phaser.Scene,
    public readonly spec: BrickSpec
  ) {
    super(scene, spec.x, spec.y, spec.width, spec.height, spec.color, 1);

    this.hitPoints = spec.hitPoints;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(DEPTHS.bricks);
    const outline = BRICK_OUTLINES[spec.kind];
    this.setStrokeStyle(outline.width, outline.color, outline.alpha);

    const body = this.arcadeBody;
    body.setAllowGravity(false);
    body.setImmovable(true);
    body.setSize(spec.width, spec.height);
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

  private refreshDamageState(): void {
    if (this.spec.maxHitPoints <= 1) {
      return;
    }

    const ratio = this.hitPoints / this.spec.maxHitPoints;
    this.setAlpha(0.52 + ratio * 0.48);
    this.setScale(0.94 + ratio * 0.06, 1);
  }
}
