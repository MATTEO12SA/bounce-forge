import Phaser from 'phaser';
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

export class Paddle extends Phaser.GameObjects.Rectangle {
  private currentWidth = PADDLE_WIDTH;

  public constructor(scene: Phaser.Scene) {
    super(scene, WORLD_WIDTH / 2, PADDLE_Y, PADDLE_WIDTH, PADDLE_HEIGHT, 0x65d7ff, 1);

    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(DEPTHS.paddle);
    this.setStrokeStyle(3, 0xe5fbff, 0.94);

    const body = this.arcadeBody;
    body.setAllowGravity(false);
    body.setImmovable(true);
    body.setSize(PADDLE_WIDTH, PADDLE_HEIGHT);
  }

  public get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  public get activeWidth(): number {
    return this.currentWidth;
  }

  public setCenterX(x: number): void {
    const halfWidth = this.currentWidth / 2;
    this.x = clamp(x, PLAYFIELD_LEFT + halfWidth + 6, PLAYFIELD_RIGHT - halfWidth - 6);
    this.arcadeBody.updateFromGameObject();
  }

  public setWidthScale(scale: number): void {
    this.currentWidth = clamp(PADDLE_WIDTH * scale, PADDLE_MIN_WIDTH, PADDLE_MAX_WIDTH);
    this.setSize(this.currentWidth, PADDLE_HEIGHT);
    this.setDisplaySize(this.currentWidth, PADDLE_HEIGHT);
    this.arcadeBody.setSize(this.currentWidth, PADDLE_HEIGHT, true);
    this.setCenterX(this.x);
  }

  public resetWidth(): void {
    this.setWidthScale(1);
  }
}
