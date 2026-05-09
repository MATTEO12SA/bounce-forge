import type Phaser from 'phaser';

export const TABLER_ICON_BASE_PATH = '/assets/icons/tabler';
const ICON_TEXTURE_SIZE = 64;

export const TABLER_ICON_NAMES = [
  'arrow-left',
  'book',
  'check',
  'copy',
  'device-gamepad-2',
  'download',
  'home',
  'maximize',
  'palette',
  'player-play',
  'player-track-next',
  'refresh',
  'rotate-clockwise',
  'settings',
  'speakerphone',
  'trash',
  'upload',
  'volume',
  'volume-2',
  'x'
] as const;

export type TablerIconName = (typeof TABLER_ICON_NAMES)[number];

export function getTablerIconPath(name: TablerIconName): string {
  return `${TABLER_ICON_BASE_PATH}/${name}.svg`;
}

export function getTablerIconTextureKey(name: TablerIconName): string {
  return `tabler-icon-${name}`;
}

export function getIconManifest(): { name: TablerIconName; path: string; textureKey: string }[] {
  return TABLER_ICON_NAMES.map((name) => ({
    name,
    path: getTablerIconPath(name),
    textureKey: getTablerIconTextureKey(name)
  }));
}

export function preloadTablerIcons(
  scene: Phaser.Scene,
  names: readonly TablerIconName[] = TABLER_ICON_NAMES
): void {
  for (const name of names) {
    const textureKey = getTablerIconTextureKey(name);

    if (!scene.textures.exists(textureKey)) {
      createIconTexture(scene, textureKey, name);
    }
  }
}

function createIconTexture(scene: Phaser.Scene, textureKey: string, name: TablerIconName): void {
  const graphics = scene.add.graphics({ x: 0, y: 0 });
  graphics.clear();
  graphics.lineStyle(5, 0xffffff, 1);
  graphics.fillStyle(0xffffff, 1);
  drawIcon(graphics, name);
  graphics.generateTexture(textureKey, ICON_TEXTURE_SIZE, ICON_TEXTURE_SIZE);
  graphics.destroy();
}

function drawLine(
  graphics: Phaser.GameObjects.Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  graphics.beginPath();
  graphics.moveTo(x1, y1);
  graphics.lineTo(x2, y2);
  graphics.strokePath();
}

function drawPolyline(
  graphics: Phaser.GameObjects.Graphics,
  points: [[number, number], ...[number, number][]]
): void {
  const [first, ...rest] = points;
  graphics.beginPath();
  graphics.moveTo(first[0], first[1]);
  for (const [x, y] of rest) {
    graphics.lineTo(x, y);
  }
  graphics.strokePath();
}

function drawSpeaker(graphics: Phaser.GameObjects.Graphics): void {
  graphics.beginPath();
  graphics.moveTo(12, 26);
  graphics.lineTo(22, 26);
  graphics.lineTo(34, 16);
  graphics.lineTo(34, 48);
  graphics.lineTo(22, 38);
  graphics.lineTo(12, 38);
  graphics.closePath();
  graphics.fillPath();
}

function drawIcon(graphics: Phaser.GameObjects.Graphics, name: TablerIconName): void {
  switch (name) {
    case 'arrow-left':
      drawLine(graphics, 14, 32, 50, 32);
      drawLine(graphics, 14, 32, 30, 16);
      drawLine(graphics, 14, 32, 30, 48);
      break;
    case 'book':
      graphics.strokeRoundedRect(14, 12, 36, 42, 5);
      drawLine(graphics, 24, 12, 24, 54);
      drawLine(graphics, 30, 22, 44, 22);
      break;
    case 'check':
      drawPolyline(graphics, [
        [14, 34],
        [27, 46],
        [50, 18]
      ]);
      break;
    case 'copy':
      graphics.strokeRoundedRect(20, 14, 28, 34, 4);
      graphics.strokeRoundedRect(14, 22, 28, 34, 4);
      break;
    case 'device-gamepad-2':
      graphics.strokeRoundedRect(10, 24, 44, 24, 10);
      drawLine(graphics, 21, 32, 21, 42);
      drawLine(graphics, 16, 37, 26, 37);
      graphics.fillCircle(42, 34, 3);
      graphics.fillCircle(48, 40, 3);
      break;
    case 'download':
      drawLine(graphics, 32, 12, 32, 40);
      drawLine(graphics, 21, 30, 32, 41);
      drawLine(graphics, 43, 30, 32, 41);
      drawLine(graphics, 16, 50, 48, 50);
      break;
    case 'home':
      drawPolyline(graphics, [
        [13, 31],
        [32, 14],
        [51, 31]
      ]);
      graphics.strokeRoundedRect(18, 30, 28, 23, 3);
      break;
    case 'maximize':
      drawPolyline(graphics, [
        [14, 26],
        [14, 14],
        [26, 14]
      ]);
      drawPolyline(graphics, [
        [38, 14],
        [50, 14],
        [50, 26]
      ]);
      drawPolyline(graphics, [
        [50, 38],
        [50, 50],
        [38, 50]
      ]);
      drawPolyline(graphics, [
        [26, 50],
        [14, 50],
        [14, 38]
      ]);
      break;
    case 'palette':
      graphics.strokeCircle(32, 32, 20);
      graphics.fillCircle(24, 27, 3);
      graphics.fillCircle(33, 23, 3);
      graphics.fillCircle(42, 30, 3);
      graphics.fillCircle(30, 42, 4);
      break;
    case 'player-play':
      graphics.fillTriangle(22, 15, 22, 49, 50, 32);
      break;
    case 'player-track-next':
      graphics.fillTriangle(14, 17, 14, 47, 38, 32);
      graphics.fillRect(43, 18, 6, 28);
      break;
    case 'refresh':
      graphics.strokeCircle(32, 32, 18);
      graphics.fillTriangle(45, 16, 51, 31, 36, 27);
      break;
    case 'rotate-clockwise':
      graphics.strokeCircle(32, 32, 18);
      graphics.fillTriangle(44, 13, 53, 25, 38, 25);
      break;
    case 'settings':
      graphics.strokeCircle(32, 32, 10);
      for (let i = 0; i < 8; i += 1) {
        const angle = (Math.PI * 2 * i) / 8;
        drawLine(
          graphics,
          32 + Math.cos(angle) * 17,
          32 + Math.sin(angle) * 17,
          32 + Math.cos(angle) * 24,
          32 + Math.sin(angle) * 24
        );
      }
      break;
    case 'speakerphone':
      drawSpeaker(graphics);
      drawLine(graphics, 42, 24, 52, 18);
      drawLine(graphics, 42, 40, 52, 46);
      break;
    case 'trash':
      drawLine(graphics, 18, 21, 46, 21);
      drawLine(graphics, 26, 14, 38, 14);
      graphics.strokeRoundedRect(21, 24, 22, 28, 3);
      drawLine(graphics, 29, 30, 29, 45);
      drawLine(graphics, 36, 30, 36, 45);
      break;
    case 'upload':
      drawLine(graphics, 32, 42, 32, 14);
      drawLine(graphics, 21, 25, 32, 14);
      drawLine(graphics, 43, 25, 32, 14);
      drawLine(graphics, 16, 50, 48, 50);
      break;
    case 'volume':
      drawSpeaker(graphics);
      break;
    case 'volume-2':
      drawSpeaker(graphics);
      graphics.beginPath();
      graphics.arc(40, 32, 8, -0.75, 0.75);
      graphics.strokePath();
      graphics.beginPath();
      graphics.arc(40, 32, 16, -0.75, 0.75);
      graphics.strokePath();
      break;
    case 'x':
      drawLine(graphics, 18, 18, 46, 46);
      drawLine(graphics, 46, 18, 18, 46);
      break;
  }
}
