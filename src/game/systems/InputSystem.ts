import Phaser from 'phaser';
import { PADDLE_SPEED } from '../utils/constants';
import { lerp } from '../utils/math';
import type { Paddle } from '../entities/Paddle';

export class InputSystem {
  private readonly cursors: Phaser.Types.Input.Keyboard.CursorKeys | null;
  private readonly keyA: Phaser.Input.Keyboard.Key | null;
  private readonly keyD: Phaser.Input.Keyboard.Key | null;
  private pointerTargetX: number | null = null;

  public constructor(private readonly scene: Phaser.Scene) {
    this.cursors = scene.input.keyboard?.createCursorKeys() ?? null;
    this.keyA = scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.A) ?? null;
    this.keyD = scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.D) ?? null;

    scene.input.on('pointermove', this.handlePointerMove, this);
    scene.input.on('pointerdown', this.handlePointerMove, this);
  }

  public updatePaddle(paddle: Paddle, deltaMs: number): void {
    const direction = this.getKeyboardDirection();

    if (direction !== 0) {
      paddle.setCenterX(paddle.x + direction * PADDLE_SPEED * (deltaMs / 1000));
      return;
    }

    if (this.pointerTargetX !== null) {
      // Frame-rate independent smoothing: same feel at 30, 60 or 144 Hz.
      const blend = 1 - Math.pow(1 - 0.42, Math.max(0, deltaMs) / (1000 / 60));
      paddle.setCenterX(lerp(paddle.x, this.pointerTargetX, Math.min(1, blend)));
    }
  }

  public destroy(): void {
    this.scene.input.off('pointermove', this.handlePointerMove, this);
    this.scene.input.off('pointerdown', this.handlePointerMove, this);
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    this.pointerTargetX = pointer.worldX;
  }

  private getKeyboardDirection(): number {
    const left = Boolean(this.cursors?.left.isDown || this.keyA?.isDown);
    const right = Boolean(this.cursors?.right.isDown || this.keyD?.isDown);

    if (left === right) {
      return 0;
    }

    return left ? -1 : 1;
  }
}
