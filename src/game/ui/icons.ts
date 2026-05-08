import type Phaser from 'phaser';

export const TABLER_ICON_BASE_PATH = '/assets/icons/tabler';

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
      scene.load.svg(textureKey, getTablerIconPath(name));
    }
  }
}
