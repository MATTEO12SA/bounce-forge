import Phaser from 'phaser';
import {
  BALL_AXIS_LOCK_MIN_SPEED,
  BALL_MAX_SPEED,
  BALL_MIN_SPEED,
  BALL_RADIUS,
  DEPTHS,
  PLAYFIELD_LEFT,
  PLAYFIELD_RIGHT,
  PLAYFIELD_TOP,
  WORLD_HEIGHT
} from '../utils/constants';
import {
  avoidAxisLock,
  clampVelocitySpeed,
  normalizeVelocity,
  type Vector2Like
} from '../utils/math';
import type { Paddle } from './Paddle';

export class Ball extends Phaser.GameObjects.Arc {
  private attached = false;

  public constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, BALL_RADIUS, 0, 360, false, 0xf8fdff, 1);

    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(DEPTHS.ball);
    this.setStrokeStyle(2, 0x82e9ff, 0.95);

    const body = this.arcadeBody;
    body.setAllowGravity(false);
    body.setCircle(BALL_RADIUS);
    body.setBounce(1, 1);
  }

  public get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  public get isAttached(): boolean {
    return this.attached;
  }

  public attachToPaddle(paddle: Paddle): void {
    this.attached = true;
    this.setPosition(paddle.x, paddle.y - 56);
    this.arcadeBody.setVelocity(0, 0);
    this.arcadeBody.updateFromGameObject();
  }

  public launch(speed: number): void {
    this.attached = false;
    this.setVelocity({ x: speed * 0.28, y: -speed });
  }

  public setVelocity(vector: Vector2Like): void {
    this.arcadeBody.setVelocity(vector.x, vector.y);
  }

  public duplicateWithAngle(angleOffsetRadians: number): Ball {
    const clone = new Ball(this.scene, this.x, this.y);
    const velocity = this.arcadeBody.velocity;
    const speed = Math.max(BALL_MIN_SPEED, velocity.length());
    const angle = Math.atan2(velocity.y, velocity.x) + angleOffsetRadians;

    clone.attached = false;
    clone.setVelocity({
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed
    });

    return clone;
  }

  public maintainSpeed(minSpeed = BALL_MIN_SPEED, maxSpeed = BALL_MAX_SPEED): void {
    if (this.attached) {
      return;
    }

    const body = this.arcadeBody;
    const clamped = clampVelocitySpeed(
      avoidAxisLock({ x: body.velocity.x, y: body.velocity.y }, BALL_AXIS_LOCK_MIN_SPEED),
      minSpeed,
      maxSpeed
    );
    body.setVelocity(clamped.x, clamped.y);
    this.clampToPlayfield();
  }

  public clampToPlayfield(): void {
    const body = this.arcadeBody;
    let positionChanged = false;

    if (this.x < PLAYFIELD_LEFT + BALL_RADIUS) {
      this.x = PLAYFIELD_LEFT + BALL_RADIUS;
      if (body.velocity.x < 0) body.setVelocityX(Math.abs(body.velocity.x));
      positionChanged = true;
    } else if (this.x > PLAYFIELD_RIGHT - BALL_RADIUS) {
      this.x = PLAYFIELD_RIGHT - BALL_RADIUS;
      if (body.velocity.x > 0) body.setVelocityX(-Math.abs(body.velocity.x));
      positionChanged = true;
    }

    if (this.y < PLAYFIELD_TOP + BALL_RADIUS) {
      this.y = PLAYFIELD_TOP + BALL_RADIUS;
      if (body.velocity.y < 0) body.setVelocityY(Math.abs(body.velocity.y));
      positionChanged = true;
    }

    if (positionChanged) {
      body.updateFromGameObject();
    }
  }

  public isOutOfPlay(): boolean {
    return this.y > WORLD_HEIGHT + BALL_RADIUS * 3;
  }

  public scaleVelocity(multiplier: number): void {
    const body = this.arcadeBody;
    const current = { x: body.velocity.x, y: body.velocity.y };
    const targetSpeed = Math.max(1, body.velocity.length() * multiplier);
    const next = normalizeVelocity(current, targetSpeed);
    body.setVelocity(next.x, next.y);
  }
}
