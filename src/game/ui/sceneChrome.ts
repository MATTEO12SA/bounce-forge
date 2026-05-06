import type Phaser from 'phaser';
import type { ThemeDefinition } from '../config/themeConfig';
import { DEPTHS, WORLD_HEIGHT, WORLD_WIDTH } from '../utils/constants';

interface ScreenBackgroundOptions {
  panel?: boolean;
  sideRails?: boolean;
  grid?: boolean;
  depth?: number;
}

export function drawScreenBackground(
  scene: Phaser.Scene,
  theme: ThemeDefinition,
  options: ScreenBackgroundOptions = {}
): Phaser.GameObjects.Graphics {
  const { panel = true, sideRails = true, grid = true, depth = DEPTHS.background } = options;
  const graphics = scene.add.graphics().setDepth(depth);

  graphics.fillGradientStyle(
    theme.backgroundTop,
    theme.backgroundTop,
    theme.backgroundBottom,
    theme.backgroundBottom,
    1
  );
  graphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  if (grid) {
    graphics.lineStyle(1, theme.playfieldGrid, 0.14);
    for (let x = 44; x < WORLD_WIDTH; x += 72) {
      graphics.lineBetween(x, 0, x, WORLD_HEIGHT);
    }
    for (let y = 48; y < WORLD_HEIGHT; y += 72) {
      graphics.lineBetween(0, y, WORLD_WIDTH, y);
    }

    graphics.lineStyle(2, theme.borderDim, 0.18);
    for (let y = 180; y < WORLD_HEIGHT; y += 360) {
      graphics.lineBetween(0, y, WORLD_WIDTH, y);
    }
  }

  if (sideRails) {
    graphics.fillGradientStyle(
      theme.railOuter,
      theme.railInner,
      theme.railOuter,
      theme.railInner,
      0.9
    );
    graphics.fillRect(0, 0, 92, WORLD_HEIGHT);
    graphics.fillGradientStyle(
      theme.railInner,
      theme.railOuter,
      theme.railInner,
      theme.railOuter,
      0.9
    );
    graphics.fillRect(WORLD_WIDTH - 92, 0, 92, WORLD_HEIGHT);
    graphics.lineStyle(2, theme.railEdge, 0.5);
    graphics.lineBetween(92, 0, 92, WORLD_HEIGHT);
    graphics.lineBetween(WORLD_WIDTH - 92, 0, WORLD_WIDTH - 92, WORLD_HEIGHT);
  }

  if (panel) {
    drawPanel(
      scene,
      WORLD_WIDTH / 2,
      WORLD_HEIGHT / 2,
      WORLD_WIDTH - 232,
      WORLD_HEIGHT - 118,
      theme,
      {
        depth,
        alpha: 0.82
      }
    );
  }

  return graphics;
}

interface PanelOptions {
  depth?: number;
  alpha?: number;
  strokeAlpha?: number;
}

export function drawPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  theme: ThemeDefinition,
  options: PanelOptions = {}
): Phaser.GameObjects.Rectangle {
  const depth = options.depth ?? DEPTHS.background;
  const panel = scene.add
    .rectangle(x, y, width, height, theme.panel, options.alpha ?? 0.88)
    .setStrokeStyle(2, theme.borderDim, options.strokeAlpha ?? 0.9)
    .setDepth(depth);

  scene.add.rectangle(x, y - height / 2 + 2, width - 18, 2, theme.border, 0.32).setDepth(depth);

  return panel;
}

export function addCreatorCredit(
  scene: Phaser.Scene,
  theme: ThemeDefinition,
  depth = DEPTHS.hud
): Phaser.GameObjects.Text {
  return scene.add
    .text(WORLD_WIDTH / 2, WORLD_HEIGHT - 36, 'Created by Matteo_plmr', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '22px',
      fontStyle: '800',
      color: theme.textMuted
    })
    .setOrigin(0.5)
    .setAlpha(0.86)
    .setDepth(depth);
}
