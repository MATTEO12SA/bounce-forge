import type Phaser from 'phaser';
import { Ball } from '../entities/Ball';
import { Brick } from '../entities/Brick';
import { PowerUp } from '../entities/PowerUp';
import type { Paddle } from '../entities/Paddle';

export interface CollisionCallbacks {
  onBallPaddle(ball: Ball): void;
  onBallBrick(ball: Ball, brick: Brick): void;
  onPowerUpPaddle(powerUp: PowerUp): void;
}

export class CollisionSystem {
  private readonly colliders: Phaser.Physics.Arcade.Collider[] = [];

  public register(
    scene: Phaser.Scene,
    paddle: Paddle,
    balls: Phaser.Physics.Arcade.Group,
    bricks: Phaser.Physics.Arcade.Group,
    powerUps: Phaser.Physics.Arcade.Group,
    callbacks: CollisionCallbacks
  ): void {
    this.colliders.push(
      scene.physics.add.collider(
        balls,
        paddle,
        (firstObject, secondObject) => {
          const ball = this.findCollisionObject(Ball, firstObject, secondObject);

          if (ball) {
            callbacks.onBallPaddle(ball);
          }
        },
        (firstObject, secondObject) => {
          const ball = this.findCollisionObject(Ball, firstObject, secondObject);

          if (!ball || ball.isAttached) {
            return false;
          }

          return ball.arcadeBody.velocity.y > 0 && ball.y <= paddle.y;
        }
      ),
      scene.physics.add.collider(balls, bricks, (firstObject, secondObject) => {
        const ball = this.findCollisionObject(Ball, firstObject, secondObject);
        const brick = this.findCollisionObject(Brick, firstObject, secondObject);

        if (ball && brick) {
          callbacks.onBallBrick(ball, brick);
        }
      }),
      scene.physics.add.overlap(powerUps, paddle, (firstObject, secondObject) => {
        const powerUp = this.findCollisionObject(PowerUp, firstObject, secondObject);

        if (powerUp) {
          callbacks.onPowerUpPaddle(powerUp);
        }
      })
    );
  }

  public destroy(): void {
    this.colliders.forEach((collider) => collider.destroy());
    this.colliders.length = 0;
  }

  private findCollisionObject<T extends Phaser.GameObjects.GameObject>(
    constructor: new (...args: never[]) => T,
    firstObject: unknown,
    secondObject: unknown
  ): T | null {
    const firstTarget = this.unwrapBody(firstObject);
    const secondTarget = this.unwrapBody(secondObject);

    if (firstTarget instanceof constructor) {
      return firstTarget;
    }

    if (secondTarget instanceof constructor) {
      return secondTarget;
    }

    return null;
  }

  private unwrapBody(value: unknown): unknown {
    if (value && typeof value === 'object' && 'gameObject' in value) {
      return (value as { gameObject?: unknown }).gameObject ?? value;
    }

    return value;
  }
}
