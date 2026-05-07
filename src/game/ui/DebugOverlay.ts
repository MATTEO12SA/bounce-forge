import type Phaser from 'phaser';
import type { FxQuality } from '../systems/SaveSystem';
import { DEPTHS } from '../utils/constants';

export interface DebugOverlaySnapshot {
  fps: number;
  averageDeltaMs: number;
  fxQuality: FxQuality;
  fxDegraded: boolean;
  activeBalls: number;
  activeBallLimit: number;
  pendingClones: number;
  remainingBricks: number;
  activePowerUps: number;
  activeEffects: string;
  levelIndex: number;
  levelName: string;
}

export function isDebugOverlayEnabled(
  search = typeof window === 'undefined' ? '' : window.location.search
): boolean {
  try {
    return new URLSearchParams(search).get('debug') === '1';
  } catch {
    return false;
  }
}

export class DebugOverlay {
  private readonly panel: Phaser.GameObjects.Rectangle;
  private readonly text: Phaser.GameObjects.Text;
  private elapsedMs = 0;

  public constructor(private readonly scene: Phaser.Scene) {
    this.panel = scene.add
      .rectangle(24, 24, 390, 304, 0x06090d, 0.78)
      .setOrigin(0)
      .setStrokeStyle(2, 0xffd31a, 0.72)
      .setDepth(DEPTHS.overlay + 20)
      .setScrollFactor(0);
    this.text = scene.add
      .text(42, 40, '', {
        fontFamily: 'Consolas, monospace',
        fontSize: '20px',
        color: '#ffe680',
        lineSpacing: 5
      })
      .setDepth(DEPTHS.overlay + 21)
      .setScrollFactor(0);
  }

  public update(deltaMs: number, snapshot: DebugOverlaySnapshot): void {
    this.elapsedMs += deltaMs;

    if (this.elapsedMs < 250) {
      return;
    }

    this.elapsedMs = 0;
    this.text.setText([
      'DEBUG',
      `FPS: ${snapshot.fps.toFixed(0)}`,
      `Delta avg: ${snapshot.averageDeltaMs.toFixed(1)}ms`,
      `FX: ${snapshot.fxQuality}${snapshot.fxDegraded ? ' (auto)' : ''}`,
      `Balls: ${snapshot.activeBalls}/${snapshot.activeBallLimit}`,
      `Pending clones: ${snapshot.pendingClones}`,
      `Bricks: ${snapshot.remainingBricks}`,
      `Power-ups: ${snapshot.activePowerUps}`,
      `Effects: ${snapshot.activeEffects || '-'}`,
      `Level: ${snapshot.levelIndex + 1} ${snapshot.levelName}`
    ]);
  }

  public destroy(): void {
    this.panel.destroy();
    this.text.destroy();
  }
}
