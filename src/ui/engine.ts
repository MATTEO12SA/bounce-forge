import type { GameController } from '../game/bridge';

export type EngineState = 'idle' | 'downloading' | 'starting' | 'ready' | 'error';

type GameAppInstance = GameController & {
  boot(): Promise<void>;
  refreshLayout(): void;
};

/**
 * Loads Phaser and the game only when needed (it is ~1.4 MB), reports coarse progress and lets
 * the interface retry after a network failure.
 */
export class EngineLoader {
  private app: GameAppInstance | null = null;
  private pending: Promise<GameAppInstance> | null = null;
  private state: EngineState = 'idle';
  private readonly listeners = new Set<(state: EngineState) => void>();

  public constructor(private readonly stage: HTMLElement) {}

  public getState(): EngineState {
    return this.state;
  }

  public get controller(): GameAppInstance | null {
    return this.app;
  }

  public onState(listener: (state: EngineState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public load(): Promise<GameAppInstance> {
    if (this.app) {
      return Promise.resolve(this.app);
    }
    if (this.pending) {
      return this.pending;
    }

    this.setState('downloading');
    this.pending = import('../game/GameApp')
      .then(async ({ GameApp }) => {
        this.setState('starting');
        const app = new GameApp(this.stage) as unknown as GameAppInstance;
        await app.boot();
        this.app = app;
        this.setState('ready');
        return app;
      })
      .catch((error: unknown) => {
        console.error('[engine] failed to load', error);
        this.pending = null;
        this.setState('error');
        throw error;
      });
    return this.pending;
  }

  public destroy(): void {
    this.app?.destroy();
    this.app = null;
    this.pending = null;
  }

  private setState(state: EngineState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }
}
