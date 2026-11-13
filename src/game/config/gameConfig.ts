import Phaser from 'phaser';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../utils/constants';
import { ADMIN_ENABLED } from './features';
import { AdminLoginScene } from '../scenes/AdminLoginScene';
import { AdminMenuScene } from '../scenes/AdminMenuScene';
import { BootScene } from '../scenes/BootScene';
import { GameScene } from '../scenes/GameScene';
import { LevelEditorScene } from '../scenes/LevelEditorScene';
import { PreloadScene } from '../scenes/PreloadScene';

export function createGameConfig(parent: HTMLElement): Phaser.Types.Core.GameConfig {
  const scenes: Phaser.Types.Scenes.SceneType[] = [BootScene, PreloadScene, GameScene];
  // The Phaser campaign editor and admin menu only exist in admin builds (local dev server):
  // the public build leaves them, and their widgets, out of the download.
  if (ADMIN_ENABLED) {
    scenes.push(LevelEditorScene, AdminLoginScene, AdminMenuScene);
  }

  return {
    type: Phaser.AUTO,
    parent,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: '#0b0a08',
    // Ball physics are custom (src/game/physics); Phaser audio is unused (src/game/audio).
    audio: { noAudio: true },
    fps: {
      target: 60,
      forceSetTimeOut: false
    },
    render: {
      antialias: true,
      pixelArt: false,
      roundPixels: false,
      powerPreference: 'high-performance'
    },
    input: {
      activePointers: 3
    },
    disableContextMenu: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT
    },
    scene: scenes
  };
}
