import Phaser from 'phaser';
import { TEX } from '../render/textures';
import {
  DEPTHS,
  PADDLE_HEIGHT,
  PADDLE_MAX_WIDTH,
  PADDLE_MIN_WIDTH,
  PADDLE_WIDTH,
  PADDLE_Y,
  PLAYFIELD_LEFT,
  PLAYFIELD_RIGHT,
  WORLD_WIDTH
} from '../utils/constants';
import { clamp } from '../utils/math';

const VISUAL_MARGIN = 6;
const TEXTURE_HEIGHT = 34;

/** The paddle: a nine-slice sprite so it can widen without stretching its glowing ends. */
export class Paddle extends Phaser.GameObjects.NineSlice {
  /** Horizontal speed in px/s, measured every frame (used for spin on bounces). */
  public vx = 0;
  private currentWidth = PADDLE_WIDTH;
  private lastX = WORLD_WIDTH / 2;
  private tilt = 0;

  public constructor(scene: Phaser.Scene) {
    super(
      scene,
      WORLD_WIDTH / 2,
      PADDLE_Y,
      TEX.paddle,
      undefined,
      PADDLE_WIDTH + VISUAL_MARGIN,
      TEXTURE_HEIGHT,
      26,
      26,
      0,
      0
    );
    this.setDepth(DEPTHS.paddle);
    scene.add.existing(this);
  }

  public get activeWidth(): number {
    return this.currentWidth;
  }

  /** Y of the paddle top surface. */
  public get top(): number {
    return this.y - PADDLE_HEIGHT / 2;
  }

  public setCenterX(x: number): void {
    const halfWidth = this.currentWidth / 2;
    this.x = clamp(x, PLAYFIELD_LEFT + halfWidth + 4, PLAYFIELD_RIGHT - halfWidth - 4);
  }

  /** Call once per frame after moving: measures speed and leans the paddle a little. */
  public afterMove(deltaMs: number, reducedMotion: boolean): void {
    const dt = Math.max(1, deltaMs) / 1000;
    const instant = (this.x - this.lastX) / dt;
    this.vx = this.vx * 0.5 + instant * 0.5;
    this.lastX = this.x;
    const targetTilt = reducedMotion ? 0 : clamp(this.vx / 9000, -0.06, 0.06);
    this.tilt += (targetTilt - this.tilt) * Math.min(1, dt * 14);
    this.setRotation(this.tilt);
  }

  public setWidthScale(scale: number): void {
    const target = clamp(PADDLE_WIDTH * scale, PADDLE_MIN_WIDTH, PADDLE_MAX_WIDTH);
    this.currentWidth = target;
    this.scene.tweens.add({
      targets: this,
      width: target + VISUAL_MARGIN,
      duration: 220,
      ease: 'Back.easeOut'
    });
    this.setCenterX(this.x);
  }

  public resetWidth(): void {
    this.setWidthScale(1);
  }

  /** Squash on impact. */
  public bump(strength = 1): void {
    this.scene.tweens.add({
      targets: this,
      scaleY: { from: 1 - 0.32 * strength, to: 1 },
      scaleX: { from: 1 + 0.06 * strength, to: 1 },
      duration: 220,
      ease: 'Back.easeOut'
    });
  }
}
