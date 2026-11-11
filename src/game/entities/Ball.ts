import Phaser from 'phaser';
import type { BallBody } from '../physics/ballStep';
import { TEX } from '../render/textures';
import { BALL_RADIUS, DEPTHS, WORLD_HEIGHT } from '../utils/constants';
import type { Paddle } from './Paddle';

/** A ball sprite carrying its own velocity; moved by the custom physics in GameScene. */
export class Ball extends Phaser.GameObjects.Image implements BallBody {
  public vx = 0;
  public vy = 0;
  public readonly radius = BALL_RADIUS;
  /** Current travel speed (ramps up with paddle hits). */
  public speed = 0;
  /** 0..1 squash impulse set on impact, decays every frame. */
  public impact = 0;
  /** Horizontal offset from the paddle centre while attached. */
  public attachOffset = 0;
  private attached = false;

  public constructor(scene: Phaser.Scene, x = 0, y = 0) {
    super(scene, x, y, TEX.ball);
    this.setDisplaySize(BALL_RADIUS * 4, BALL_RADIUS * 4);
    this.setDepth(DEPTHS.ball);
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
  }

  public get isAttached(): boolean {
    return this.attached;
  }

  public reset(x: number, y: number): void {
    this.attached = false;
    this.impact = 0;
    this.vx = 0;
    this.vy = 0;
    this.attachOffset = 0;
    this.setActive(true).setVisible(true).setAlpha(1).setRotation(0);
    this.setDisplaySize(BALL_RADIUS * 4, BALL_RADIUS * 4);
    this.setPosition(x, y);
  }

  public disable(): void {
    this.attached = false;
    this.vx = 0;
    this.vy = 0;
    this.setActive(false).setVisible(false);
  }

  /** Rests the ball on the paddle surface (no floating gap). */
  public attachToPaddle(paddle: Paddle): void {
    this.attached = true;
    this.vx = 0;
    this.vy = 0;
    this.setPosition(paddle.x + this.attachOffset, paddle.top - this.radius - 1);
  }

  public launch(vx: number, vy: number): void {
    this.attached = false;
    this.vx = vx;
    this.vy = vy;
    this.speed = Math.hypot(vx, vy);
  }

  public isOutOfPlay(): boolean {
    return this.y > WORLD_HEIGHT + this.radius * 2;
  }

  /** Squash and stretch along the direction of travel. */
  public updateLook(deltaMs: number): void {
    this.impact = Math.max(0, this.impact - deltaMs / 140);
    const base = BALL_RADIUS * 4;
    if (this.attached) {
      this.setDisplaySize(base, base).setRotation(0);
      return;
    }
    const stretch = Math.min(0.22, Math.hypot(this.vx, this.vy) / 5200);
    const squash = this.impact * 0.35;
    this.setRotation(Math.atan2(this.vy, this.vx));
    this.setDisplaySize(base * (1 + stretch - squash), base * (1 - stretch * 0.6 + squash * 0.6));
  }
}
