import Phaser from 'phaser';
import {
  bridge,
  type AdminCommand,
  type EditorReturn,
  type GameController,
  type GameSession
} from './bridge';
import { createGameConfig } from './config/gameConfig';
import { ADMIN_ENABLED } from './config/features';
import type { GameScene } from './scenes/GameScene';

const GAME_KEY = 'GameScene';
const TOOL_KEYS = ['LevelEditorScene', 'AdminLoginScene', 'AdminMenuScene'] as const;

/** Owns the Phaser instance and implements the controller used by the HTML interface. */
export class GameApp implements GameController {
  private game: Phaser.Game | null = null;
  private readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private readonly disposers: Array<() => void> = [];

  public constructor(private readonly parent: HTMLElement) {
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  public start(session: GameSession): void {
    void this.whenReady().then(() => this.startNow(session));
  }

  public boot(): Promise<void> {
    if (!this.game) {
      this.disposers.push(bridge.on('ready', () => this.resolveReady()));
      this.game = new Phaser.Game(createGameConfig(this.parent));
      (window as unknown as { __bounceForge?: Phaser.Game }).__bounceForge = this.game;

      const onVisibility = (): void => {
        if (document.hidden && this.isPlaying() && !this.isPaused()) {
          bridge.emit('pauseRequested', undefined);
        }
      };
      document.addEventListener('visibilitychange', onVisibility);
      this.disposers.push(() => document.removeEventListener('visibilitychange', onVisibility));
    }
    return this.ready;
  }

  public whenReady(): Promise<void> {
    return this.boot();
  }

  public pause(): void {
    if (this.game?.scene.isActive(GAME_KEY)) {
      this.game.scene.pause(GAME_KEY);
    }
  }

  public resume(): void {
    if (this.game?.scene.isPaused(GAME_KEY)) {
      this.game.scene.resume(GAME_KEY);
    }
  }

  public restart(): void {
    const scene = this.getGameScene();
    if (scene) {
      const session = scene.getSession();
      this.startNow({ ...session, carry: undefined, wave: session.wave ? 1 : undefined });
    }
  }

  public quit(): void {
    this.startNow({ mode: 'demo', levelIndex: Math.floor(Math.random() * 6) });
  }

  public openEditor(editor: EditorReturn): void {
    if (!ADMIN_ENABLED) {
      return;
    }
    void this.whenReady().then(() => {
      if (!this.game) {
        return;
      }
      this.stopAll();
      this.game.scene.start('LevelEditorScene', { mode: editor.mode, slotIndex: editor.slotIndex });
      bridge.emit('toolOpened', { tool: 'editor' });
    });
  }

  public openAdmin(): void {
    if (!ADMIN_ENABLED) {
      return;
    }
    void this.whenReady().then(() => {
      if (!this.game) {
        return;
      }
      this.stopAll();
      this.game.scene.start('AdminLoginScene');
      bridge.emit('toolOpened', { tool: 'admin' });
    });
  }

  public adminCommand(command: AdminCommand): void {
    const scene = this.getGameScene();
    if (scene && !scene.isDemo()) scene.adminCommand(command);
  }

  public setSound(enabled: boolean, volume: number): void {
    this.getGameScene()?.setSound(enabled, volume);
  }

  /** Re-fits the canvas after the interface changed the size of its container. */
  public refreshLayout(): void {
    this.game?.scale.refresh();
  }

  public setReducedMotion(): void {
    // Read from the shared save when each scene starts; nothing to update live.
  }

  public isPlaying(): boolean {
    const scene = this.getGameScene();
    return Boolean(
      scene && (this.game?.scene.isActive(GAME_KEY) || this.isPaused()) && !scene.isDemo()
    );
  }

  public destroy(): void {
    const globalWindow = window as unknown as { __bounceForge?: Phaser.Game };
    if (globalWindow.__bounceForge === this.game) {
      delete globalWindow.__bounceForge;
    }

    this.disposers.splice(0).forEach((dispose) => dispose());
    this.game?.destroy(true);
    this.game = null;
  }

  private isPaused(): boolean {
    return Boolean(this.game?.scene.isPaused(GAME_KEY));
  }

  private startNow(session: GameSession): void {
    if (!this.game) {
      return;
    }
    this.stopAll(true);
    // Phaser stops a running or paused scene before starting it again with fresh data.
    this.game.scene.start(GAME_KEY, session);
  }

  private stopAll(keepGame = false): void {
    if (!this.game) {
      return;
    }
    TOOL_KEYS.forEach((key) => {
      const manager = this.game?.scene;
      if (manager?.getScene(key) && (manager.isActive(key) || manager.isPaused(key))) {
        manager.stop(key);
      }
    });
    if (!keepGame && (this.game.scene.isActive(GAME_KEY) || this.game.scene.isPaused(GAME_KEY))) {
      this.game.scene.stop(GAME_KEY);
    }
  }

  private getGameScene(): GameScene | null {
    if (!this.game) {
      return null;
    }
    const scene = this.game.scene.getScene(GAME_KEY) as GameScene | null;
    return scene && scene.sys.settings.status >= Phaser.Scenes.START ? scene : null;
  }
}
