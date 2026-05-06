import Phaser from 'phaser';
import { PADDLE_SPEED } from '../utils/constants';
import { lerp } from '../utils/math';
import type { Paddle } from '../entities/Paddle';

export class InputSystem {
  private readonly cursors: Phaser.Types.Input.Keyboard.CursorKeys | null;
  private readonly keyA: Phaser.Input.Keyboard.Key | null;
  private readonly keyD: Phaser.Input.Keyboard.Key | null;
  private pointerTargetX: number | null = null;
  private dragOffsetX = 0;
  private isDragging = false;

  public constructor(private readonly scene: Phaser.Scene) {
    this.cursors = scene.input.keyboard?.createCursorKeys() ?? null;
    this.keyA = scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.A) ?? null;
    this.keyD = scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.D) ?? null;

    scene.input.on('pointermove', this.handlePointerMove, this);
    scene.input.on('pointerdown', this.handlePointerDown, this);
    scene.input.on('pointerup', this.handlePointerUp, this);
  }

  public updatePaddle(paddle: Paddle, deltaMs: number): void {
    const direction = this.getKeyboardDirection();

    if (direction !== 0) {
      paddle.setCenterX(paddle.x + direction * PADDLE_SPEED * (deltaMs / 1000));
      return;
    }

    if (this.pointerTargetX !== null) {
      const target = this.isDragging ? this.pointerTargetX + this.dragOffsetX : this.pointerTargetX;
      paddle.setCenterX(lerp(paddle.x, target, this.isDragging ? 0.6 : 0.42));
    }
  }

  public destroy(): void {
    this.scene.input.off('pointermove', this.handlePointerMove, this);
    this.scene.input.off('pointerdown', this.handlePointerDown, this);
    this.scene.input.off('pointerup', this.handlePointerUp, this);
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    this.pointerTargetX = pointer.worldX;
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    this.pointerTargetX = pointer.worldX;
    this.isDragging = true;
    const paddle = this.findPaddle();
    this.dragOffsetX = paddle ? paddle.x - pointer.worldX : 0;
  }

  private handlePointerUp(): void {
    this.isDragging = false;
    this.dragOffsetX = 0;
  }

  private findPaddle(): Paddle | null {
    const candidate = this.scene.children.list.find(
      (child): child is Paddle =>
        (child as Phaser.GameObjects.GameObject).constructor.name === 'Paddle'
    );
    return candidate ?? null;
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
