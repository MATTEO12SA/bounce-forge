import type Phaser from 'phaser';
import type { ThemeDefinition } from '../config/themeConfig';
import { TEX } from '../render/textures';
import {
  BRICK_GAP,
  BRICK_HEIGHT,
  DEPTHS,
  PADDLE_Y,
  PLAYFIELD_BOTTOM,
  PLAYFIELD_LEFT,
  PLAYFIELD_RIGHT,
  PLAYFIELD_TOP,
  PLAYFIELD_WIDTH,
  WORLD_HEIGHT,
  WORLD_WIDTH
} from '../utils/constants';

const EDITOR_COLS = 36;
const GRID_ROWS = 58;
const WALL = 22;

/**
 * Static "Forge lumineuse" playfield: charcoal floor with a vignette, a faint grid aligned with
 * the bricks, bevelled metal walls with a glowing amber liner, and a red danger glow where
 * balls are lost (there is no floor: the bottom is open).
 */
export class PlayfieldRenderer {
  public constructor(
    private readonly scene: Phaser.Scene,
    private readonly theme: ThemeDefinition
  ) {}

  public render(): void {
    const g = this.scene.add.graphics().setDepth(DEPTHS.background);
    const accent = this.theme.primary;

    // Outer background.
    g.fillGradientStyle(0x14110c, 0x14110c, 0x060504, 0x060504, 1);
    g.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // Floor.
    g.fillGradientStyle(0x1b1711, 0x1b1711, 0x090807, 0x090807, 1);
    g.fillRect(PLAYFIELD_LEFT, PLAYFIELD_TOP, PLAYFIELD_WIDTH, WORLD_HEIGHT - PLAYFIELD_TOP);

    // Faint grid aligned with the brick cells.
    const pitchX = (PLAYFIELD_WIDTH + BRICK_GAP) / EDITOR_COLS;
    const pitchY = BRICK_HEIGHT + BRICK_GAP;
    const gridBottom = PLAYFIELD_TOP + pitchY * GRID_ROWS;
    g.lineStyle(1, 0xffffff, 0.028);
    for (let col = 1; col < EDITOR_COLS; col += 1) {
      const x = PLAYFIELD_LEFT + col * pitchX - BRICK_GAP / 2;
      g.lineBetween(x, PLAYFIELD_TOP, x, gridBottom);
    }
    for (let row = 1; row <= GRID_ROWS; row += 1) {
      const y = PLAYFIELD_TOP + row * pitchY - BRICK_GAP / 2;
      g.lineBetween(PLAYFIELD_LEFT, y, PLAYFIELD_RIGHT, y);
    }
    // Paddle lane: two discreet guide lines.
    g.lineStyle(2, accent, 0.06);
    g.lineBetween(PLAYFIELD_LEFT, PADDLE_Y - 60, PLAYFIELD_RIGHT, PADDLE_Y - 60);

    // Metal walls (left, right, top) with bevels.
    this.wall(g, PLAYFIELD_LEFT - WALL, PLAYFIELD_TOP - WALL, WALL, WORLD_HEIGHT, 'left');
    this.wall(g, PLAYFIELD_RIGHT, PLAYFIELD_TOP - WALL, WALL, WORLD_HEIGHT, 'right');
    this.wall(
      g,
      PLAYFIELD_LEFT - WALL,
      PLAYFIELD_TOP - WALL,
      PLAYFIELD_WIDTH + WALL * 2,
      WALL,
      'top'
    );

    // Glowing amber liner on the inner edge of the walls.
    [10, 5, 2].forEach((width, index) => {
      g.lineStyle(width, accent, [0.06, 0.14, 0.75][index] ?? 0.5);
      g.lineBetween(PLAYFIELD_LEFT, PLAYFIELD_TOP, PLAYFIELD_LEFT, WORLD_HEIGHT);
      g.lineBetween(PLAYFIELD_RIGHT, PLAYFIELD_TOP, PLAYFIELD_RIGHT, WORLD_HEIGHT);
      g.lineBetween(PLAYFIELD_LEFT, PLAYFIELD_TOP, PLAYFIELD_RIGHT, PLAYFIELD_TOP);
    });

    // Vignette over the floor and the danger glow at the bottom.
    this.scene.add
      .image(PLAYFIELD_LEFT + PLAYFIELD_WIDTH / 2, (PLAYFIELD_TOP + WORLD_HEIGHT) / 2, TEX.vignette)
      .setDisplaySize(PLAYFIELD_WIDTH, WORLD_HEIGHT - PLAYFIELD_TOP)
      .setDepth(DEPTHS.background + 0.5);
    const dangerTop = PADDLE_Y + 30;
    this.scene.add
      .image(
        PLAYFIELD_LEFT + PLAYFIELD_WIDTH / 2,
        (dangerTop + PLAYFIELD_BOTTOM) / 2 + 20,
        TEX.danger
      )
      .setDisplaySize(PLAYFIELD_WIDTH, PLAYFIELD_BOTTOM - dangerTop + 40)
      .setDepth(DEPTHS.background + 0.6);
  }

  private wall(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    width: number,
    height: number,
    side: 'left' | 'right' | 'top'
  ): void {
    if (side === 'top') {
      g.fillGradientStyle(0x6d6559, 0x6d6559, 0x2a2620, 0x2a2620, 1);
    } else {
      const light = 0x5c554a;
      const dark = 0x1f1c17;
      g.fillGradientStyle(
        side === 'left' ? dark : light,
        side === 'left' ? light : dark,
        side === 'left' ? dark : light,
        side === 'left' ? light : dark,
        1
      );
    }
    g.fillRect(x, y, width, height);
    // Rivets every 120 px for a forged look.
    g.fillStyle(0x15130f, 0.9);
    if (side === 'top') {
      for (let rx = x + 40; rx < x + width - 20; rx += 120) g.fillCircle(rx, y + height / 2, 3);
    } else {
      for (let ry = y + 60; ry < y + height; ry += 120) g.fillCircle(x + width / 2, ry, 3);
    }
  }
}
