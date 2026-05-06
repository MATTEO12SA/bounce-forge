import Phaser from 'phaser';

export class ProgressBar {
  private readonly fill: Phaser.GameObjects.Rectangle;
  private readonly widthMask: Phaser.GameObjects.Rectangle;

  public constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    private readonly width: number,
    height: number,
    color: number
  ) {
    scene.add
      .rectangle(x, y, width, height, 0x0b1823, 0.96)
      .setOrigin(0, 0.5)
      .setStrokeStyle(2, 0x315466, 0.9);
    scene.add.rectangle(x + 6, y - height / 2 + 5, width - 12, 2, 0xffffff, 0.12).setOrigin(0, 0);
    this.fill = scene.add.rectangle(x + 4, y, width - 8, height - 8, color, 0.95).setOrigin(0, 0.5);
    this.widthMask = this.fill;
  }

  public setProgress(progress: number): void {
    this.widthMask.width = Math.max(1, (this.width - 8) * Phaser.Math.Clamp(progress, 0, 1));
  }
}
