import type Phaser from 'phaser';
import type { ThemeDefinition } from '../config/themeConfig';
import {
  DEPTHS,
  PLAYFIELD_BOTTOM,
  PLAYFIELD_LEFT,
  PLAYFIELD_RIGHT,
  PLAYFIELD_TOP,
  PLAYFIELD_WIDTH,
  WORLD_HEIGHT,
  WORLD_WIDTH
} from '../utils/constants';

export class PlayfieldRenderer {
  public constructor(
    private readonly scene: Phaser.Scene,
    private readonly theme: ThemeDefinition
  ) {}

  public render(): void {
    const graphics = this.scene.add.graphics().setDepth(DEPTHS.background);

    this.drawBackgroundGradient(graphics);
    this.drawBackgroundGrid(graphics);
    this.drawSideRails(graphics);
    this.drawSideStripes(graphics);
    this.drawHorizontalSideRows(graphics);
    this.drawWallShells(graphics);
    this.drawPlayfield(graphics);
    this.drawPlayfieldGrid(graphics);
    this.drawPlayfieldBorder(graphics);
    this.drawWallStripes(graphics);
    this.drawTopHighlight(graphics);
  }

  private drawBackgroundGradient(graphics: Phaser.GameObjects.Graphics): void {
    graphics.fillGradientStyle(
      this.theme.backgroundTop,
      this.theme.backgroundTop,
      this.theme.backgroundBottom,
      this.theme.backgroundBottom,
      1
    );
    graphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }

  private drawBackgroundGrid(graphics: Phaser.GameObjects.Graphics): void {
    graphics.lineStyle(1, this.theme.playfieldGrid, 0.1);
    for (let x = 40; x < WORLD_WIDTH; x += 72) {
      graphics.lineBetween(x, 0, x, WORLD_HEIGHT);
    }
    for (let y = 44; y < WORLD_HEIGHT; y += 72) {
      graphics.lineBetween(0, y, WORLD_WIDTH, y);
    }
  }

  private drawSideRails(graphics: Phaser.GameObjects.Graphics): void {
    graphics.fillGradientStyle(
      this.theme.railOuter,
      this.theme.railInner,
      this.theme.railOuter,
      this.theme.railInner,
      0.95
    );
    graphics.fillRect(0, 0, PLAYFIELD_LEFT - 22, WORLD_HEIGHT);
    graphics.fillGradientStyle(
      this.theme.railInner,
      this.theme.railOuter,
      this.theme.railInner,
      this.theme.railOuter,
      0.95
    );
    graphics.fillRect(PLAYFIELD_RIGHT + 22, 0, WORLD_WIDTH - PLAYFIELD_RIGHT - 22, WORLD_HEIGHT);
  }

  private drawSideStripes(graphics: Phaser.GameObjects.Graphics): void {
    graphics.lineStyle(2, this.theme.borderDim, 0.32);
    for (let x = 18; x < PLAYFIELD_LEFT - 22; x += 38) {
      graphics.lineBetween(x, 0, x, WORLD_HEIGHT);
    }
    for (let x = PLAYFIELD_RIGHT + 36; x < WORLD_WIDTH; x += 38) {
      graphics.lineBetween(x, 0, x, WORLD_HEIGHT);
    }
  }

  private drawHorizontalSideRows(graphics: Phaser.GameObjects.Graphics): void {
    graphics.lineStyle(2, this.theme.borderDim, 0.32);
    for (let y = 20; y < WORLD_HEIGHT; y += 38) {
      graphics.lineBetween(0, y, PLAYFIELD_LEFT - 22, y);
      graphics.lineBetween(PLAYFIELD_RIGHT + 22, y, WORLD_WIDTH, y);
    }
  }

  private drawWallShells(graphics: Phaser.GameObjects.Graphics): void {
    graphics.fillGradientStyle(
      this.theme.railInner,
      this.theme.wallHighlight,
      this.theme.railOuter,
      this.theme.wall,
      1
    );
    graphics.fillRect(PLAYFIELD_LEFT - 22, 0, 22, WORLD_HEIGHT);
    graphics.fillGradientStyle(
      this.theme.wallHighlight,
      this.theme.railInner,
      this.theme.wall,
      this.theme.railOuter,
      1
    );
    graphics.fillRect(PLAYFIELD_RIGHT, 0, 22, WORLD_HEIGHT);
    graphics.fillGradientStyle(
      this.theme.wallHighlight,
      this.theme.wallHighlight,
      this.theme.wall,
      this.theme.wall,
      1
    );
    graphics.fillRect(PLAYFIELD_LEFT - 22, PLAYFIELD_TOP - 22, PLAYFIELD_WIDTH + 44, 22);
  }

  private drawPlayfield(graphics: Phaser.GameObjects.Graphics): void {
    graphics.fillGradientStyle(
      this.theme.playfieldTop,
      this.theme.playfieldTop,
      this.theme.playfieldBottom,
      this.theme.playfieldBottom,
      1
    );
    graphics.fillRect(
      PLAYFIELD_LEFT,
      PLAYFIELD_TOP,
      PLAYFIELD_WIDTH,
      PLAYFIELD_BOTTOM - PLAYFIELD_TOP
    );
  }

  private drawPlayfieldGrid(graphics: Phaser.GameObjects.Graphics): void {
    graphics.lineStyle(1, this.theme.playfieldGrid, 0.13);
    for (let x = PLAYFIELD_LEFT + 40; x < PLAYFIELD_RIGHT; x += 56) {
      graphics.lineBetween(x, PLAYFIELD_TOP, x, PLAYFIELD_BOTTOM);
    }
    for (let y = PLAYFIELD_TOP + 64; y < PLAYFIELD_BOTTOM; y += 64) {
      graphics.lineBetween(PLAYFIELD_LEFT, y, PLAYFIELD_RIGHT, y);
    }
  }

  private drawPlayfieldBorder(graphics: Phaser.GameObjects.Graphics): void {
    graphics.lineStyle(2, this.theme.borderDim, 0.95);
    graphics.strokeRect(
      PLAYFIELD_LEFT - 0.5,
      PLAYFIELD_TOP - 0.5,
      PLAYFIELD_WIDTH + 1,
      PLAYFIELD_BOTTOM - PLAYFIELD_TOP + 1
    );
  }

  private drawWallStripes(graphics: Phaser.GameObjects.Graphics): void {
    graphics.lineStyle(4, this.theme.borderDim, 0.48);
    for (let x = PLAYFIELD_LEFT - 18; x <= PLAYFIELD_LEFT - 4; x += 5) {
      graphics.lineBetween(x, 0, x, WORLD_HEIGHT);
    }
    for (let x = PLAYFIELD_RIGHT + 4; x <= PLAYFIELD_RIGHT + 18; x += 5) {
      graphics.lineBetween(x, 0, x, WORLD_HEIGHT);
    }
  }

  private drawTopHighlight(graphics: Phaser.GameObjects.Graphics): void {
    graphics.lineStyle(2, this.theme.railEdge, 0.46);
    graphics.lineBetween(
      PLAYFIELD_LEFT - 22,
      PLAYFIELD_TOP - 22,
      PLAYFIELD_RIGHT + 22,
      PLAYFIELD_TOP - 22
    );
    graphics.fillGradientStyle(0xffffff, 0xffffff, 0xffffff, 0xffffff, 0.05, 0.02, 0, 0);
    graphics.fillRect(PLAYFIELD_LEFT, PLAYFIELD_TOP, PLAYFIELD_WIDTH, 460);
  }
}
