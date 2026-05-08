import type Phaser from 'phaser';
import { SaveSystem } from '../systems/SaveSystem';

function getFxQuality(): string {
  return new SaveSystem().snapshot().preferences.fxQuality;
}

export function startSceneWithTransition(
  scene: Phaser.Scene,
  sceneKey: string,
  data?: object
): void {
  if (getFxQuality() === 'low') {
    scene.scene.start(sceneKey, data);
    return;
  }

  scene.cameras.main.fadeOut(120, 0, 0, 0);
  scene.time.delayedCall(125, () => scene.scene.start(sceneKey, data));
}

export function flashUiError(scene: Phaser.Scene): void {
  if (getFxQuality() === 'low') {
    return;
  }

  scene.cameras.main.shake(90, 0.0025);
}
