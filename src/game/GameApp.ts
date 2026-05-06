import Phaser from 'phaser';
import { createGameConfig } from './config/gameConfig';

export class GameApp {
  private game: Phaser.Game | null = null;

  public constructor(private readonly parent: HTMLElement) {}

  public start(): void {
    if (this.game) {
      return;
    }

    this.game = new Phaser.Game(createGameConfig(this.parent));
    (window as unknown as { __bounceForge?: Phaser.Game }).__bounceForge = this.game;
  }

  public destroy(): void {
    this.game?.destroy(true);
    this.game = null;
  }
}
