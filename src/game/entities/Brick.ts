import Phaser from 'phaser';
import { SOLID_KINDS, type BrickKind, type BrickSpec } from '../levels/levelTypes';
import type { GridItem } from '../physics/BrickGrid';
import type { Box } from '../physics/geometry';
import { ensureBrickTexture } from '../render/textures';
import { DEPTHS } from '../utils/constants';

/** Kinds that do not have to be destroyed to finish a level. */
const OPTIONAL_KINDS = new Set<BrickKind>(['phoenix']);

/** A brick sprite. Collisions are handled by the grid-based physics, not by Arcade bodies. */
export class Brick extends Phaser.GameObjects.Image implements GridItem {
  public col: number;
  public row: number;
  public readonly box: Box;
  /** Gates stay locked (solid) while keys remain. */
  public locked = false;
  /** Ghost bricks are hidden until the first touch. */
  public revealed = true;
  /** Direction of a moving brick (-1 or 1). */
  public moveDir: 1 | -1 = 1;
  private hitPoints: number;
  private damageStage = 0;

  public constructor(
    scene: Phaser.Scene,
    public readonly spec: BrickSpec
  ) {
    super(scene, spec.x, spec.y, ensureBrickTexture(scene, spec.kind, spec.color, 0));
    this.col = spec.col;
    this.row = spec.row;
    this.box = {
      left: spec.x - spec.width / 2,
      right: spec.x + spec.width / 2,
      top: spec.y - spec.height / 2,
      bottom: spec.y + spec.height / 2
    };
    this.hitPoints = spec.hitPoints;
    this.setDisplaySize(spec.width + 1, spec.height + 1);
    this.setDepth(DEPTHS.bricks);
    scene.add.existing(this);
  }

  public get kind(): BrickKind {
    return this.spec.kind;
  }

  /** Bounces balls and blocks explosions. */
  public get solid(): boolean {
    return SOLID_KINDS.includes(this.spec.kind) || this.locked;
  }

  public get remainingHitPoints(): number {
    return this.hitPoints;
  }

  public get isBreakable(): boolean {
    return !this.solid;
  }

  /** Must be destroyed for the level to be won. */
  public get isRequired(): boolean {
    return !OPTIONAL_KINDS.has(this.spec.kind) && !SOLID_KINDS.includes(this.spec.kind);
  }

  /** Moves the brick (and its collision box) to another grid cell. */
  public moveToCell(col: number, row: number, x: number, y: number): void {
    const dx = x - (this.box.left + this.box.right) / 2;
    const dy = y - (this.box.top + this.box.bottom) / 2;
    this.col = col;
    this.row = row;
    this.box.left += dx;
    this.box.right += dx;
    this.box.top += dy;
    this.box.bottom += dy;
  }

  /** Applies damage and returns true when the brick is destroyed. */
  public damage(amount: number): boolean {
    if (!this.isBreakable || this.hitPoints <= 0) {
      return false;
    }
    this.hitPoints = Math.max(0, this.hitPoints - amount);
    if (this.hitPoints > 0 && this.spec.maxHitPoints > 1) {
      const ratio = this.hitPoints / this.spec.maxHitPoints;
      const stage = ratio > 0.66 ? 0 : ratio > 0.33 ? 1 : 2;
      if (stage !== this.damageStage) {
        this.damageStage = stage;
        this.setTexture(ensureBrickTexture(this.scene, this.spec.kind, this.spec.color, stage));
      }
    }
    return this.hitPoints === 0;
  }

  /** Brief white flash used on every impact. */
  public flash(durationMs = 60): void {
    this.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(durationMs, () => {
      if (this.scene) {
        this.clearTint();
        this.setTintMode(Phaser.TintModes.MULTIPLY);
      }
    });
  }
}
