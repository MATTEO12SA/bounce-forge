import Phaser from 'phaser';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../utils/constants';
import { AdminLoginScene } from '../scenes/AdminLoginScene';
import { AdminMenuScene } from '../scenes/AdminMenuScene';
import { BootScene } from '../scenes/BootScene';
import { GameOverScene } from '../scenes/GameOverScene';
import { GameScene } from '../scenes/GameScene';
import { GuideScene } from '../scenes/GuideScene';
import { LevelEditorScene } from '../scenes/LevelEditorScene';
import { LevelSelectScene } from '../scenes/LevelSelectScene';
import { MainMenuScene } from '../scenes/MainMenuScene';
import { PauseScene } from '../scenes/PauseScene';
import { PreloadScene } from '../scenes/PreloadScene';
import { VictoryScene } from '../scenes/VictoryScene';

export function createGameConfig(parent: HTMLElement): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: '#071016',
    physics: {
      default: 'arcade',
      arcade: {
        debug: false,
        gravity: { x: 0, y: 0 }
      }
    },
    fps: {
      target: 60,
      forceSetTimeOut: false
    },
    render: {
      antialias: true,
      pixelArt: false,
      roundPixels: true,
      powerPreference: 'high-performance'
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT
    },
    scene: [
      BootScene,
      PreloadScene,
      MainMenuScene,
      AdminLoginScene,
      AdminMenuScene,
      GuideScene,
      LevelSelectScene,
      LevelEditorScene,
      GameScene,
      PauseScene,
      GameOverScene,
      VictoryScene
    ]
  };
}
