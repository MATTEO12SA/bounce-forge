import type Phaser from 'phaser';
import { bridge } from '../bridge';
import { getSharedSaveSystem } from '../systems/SaveSystem';

function getFxQuality(): string {
  return getSharedSaveSystem().snapshot().preferences.fxQuality;
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

/** Leaves an in-canvas tool (editor, admin) and hands control back to the HTML interface. */
export function returnToShell(scene: Phaser.Scene, from: 'editor' | 'admin'): void {
  scene.scene.stop();
  bridge.emit('exitToShell', { from });
}
