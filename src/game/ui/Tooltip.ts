import type Phaser from 'phaser';
import { DEPTHS, WORLD_WIDTH } from '../utils/constants';

export class Tooltip {
  private readonly background: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;

  public constructor(private readonly scene: Phaser.Scene) {
    this.background = scene.add
      .rectangle(0, 0, 10, 10, 0x05070a, 0.94)
      .setStrokeStyle(1, 0xffd31a, 0.62)
      .setDepth(DEPTHS.overlay + 80)
      .setVisible(false);
    this.label = scene.add
      .text(0, 0, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        fontStyle: '800',
        color: '#f4f7fb',
        align: 'center'
      })
      .setOrigin(0.5)
      .setDepth(DEPTHS.overlay + 81)
      .setVisible(false);
  }

  public show(text: string, x: number, y: number): void {
    this.label.setText(text);
    const width = Math.max(72, this.label.width + 24);
    const height = Math.max(36, this.label.height + 14);
    const safeX = Math.max(width / 2 + 10, Math.min(WORLD_WIDTH - width / 2 - 10, x));
    const safeY = Math.max(height / 2 + 10, y);

    this.background.setPosition(safeX, safeY).setSize(width, height).setVisible(true);
    this.label.setPosition(safeX, safeY).setVisible(true);
  }

  public hide(): void {
    this.background.setVisible(false);
    this.label.setVisible(false);
  }

  public destroy(): void {
    this.background.destroy();
    this.label.destroy();
  }
}
