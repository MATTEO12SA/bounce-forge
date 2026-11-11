import Phaser from 'phaser';
import type { BrickGrid, GridItem } from '../physics/BrickGrid';
import { TEX } from '../render/textures';
import { DEPTHS, PLAYFIELD_TOP } from '../utils/constants';

const SPEED = 1500;
const POOL = 40;

interface Shot {
  sprite: Phaser.GameObjects.Image;
  active: boolean;
}

/** Laser shots fired by the paddle; each one hits the first brick above it. */
export class Lasers<T extends GridItem> {
  private readonly shots: Shot[] = [];
  private readonly scratch: T[] = [];

  public constructor(
    private readonly scene: Phaser.Scene,
    private readonly color: number
  ) {}

  public fire(x: number, y: number): void {
    let shot = this.shots.find((item) => !item.active);
    if (!shot) {
      if (this.shots.length >= POOL) return;
      const sprite = this.scene.add
        .image(x, y, TEX.spark)
        .setDepth(DEPTHS.ball - 1)
        .setBlendMode(Phaser.BlendModes.ADD);
      shot = { sprite, active: false };
      this.shots.push(shot);
    }
    shot.active = true;
    shot.sprite
      .setPosition(x, y)
      .setVisible(true)
      .setTint(this.color)
      .setRotation(Math.PI / 2)
      .setDisplaySize(34, 7)
      .setAlpha(1);
  }

  /** Moves shots; `onHit` decides what happens to the brick that was struck. */
  public update(
    dt: number,
    grid: BrickGrid<T>,
    isActive: (item: T) => boolean,
    onHit: (item: T, x: number, y: number) => void
  ): void {
    for (const shot of this.shots) {
      if (!shot.active) continue;
      const sprite = shot.sprite;
      const fromY = sprite.y;
      const toY = fromY - SPEED * dt;
      sprite.y = toY;
      if (toY < PLAYFIELD_TOP) {
        this.release(shot);
        continue;
      }
      const hits = grid.query(
        { left: sprite.x - 2, right: sprite.x + 2, top: toY - 6, bottom: fromY },
        this.scratch
      );
      let target: T | null = null;
      for (const item of hits) {
        if (!isActive(item)) continue;
        if (!target || item.box.bottom > target.box.bottom) target = item;
      }
      if (target) {
        onHit(target, sprite.x, target.box.bottom);
        this.release(shot);
      }
    }
  }

  public clear(): void {
    this.shots.forEach((shot) => this.release(shot));
  }

  private release(shot: Shot): void {
    shot.active = false;
    shot.sprite.setVisible(false);
  }
}
