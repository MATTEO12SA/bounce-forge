/**
 * Typed contract between the HTML interface (src/ui) and the Phaser game (src/game).
 *
 * This module never imports Phaser so the interface can use it before the engine is loaded.
 * The UI drives the game through `GameController` (see GameApp) and listens to the events below.
 */
import type { LevelOptions } from './levels/levelOptions';
import type { ChallengeId } from './progress/challenges';
import type { ScoreBreakdownLine } from './progress/scoring';
import type { LevelMedal } from './systems/SaveSystem';

export type GameMode = 'campaign' | 'creative' | 'endless' | 'daily' | 'demo';

export interface EditorReturn {
  mode: 'creative' | 'admin';
  slotIndex: number;
}

export interface GameSession {
  mode: GameMode;
  /** Campaign level index, or creative slot index. Ignored by wave modes. */
  levelIndex: number;
  editorReturn?: EditorReturn;
  /** 1-based wave number for endless and daily modes. */
  wave?: number;
  /** Seed of the run (endless) or of the day (daily). */
  seed?: number;
  /** UTC day of a daily challenge, frozen when the run starts so midnight never changes it. */
  dateKey?: string;
  /** Unsaved editor level played by the editor's "Test" button (the slot is not overwritten). */
  draft?: { name: string; rows: string[]; options?: LevelOptions };
  /** Playing a level of a community creation (the level itself travels in `draft`). */
  community?: { id: string; index: number; count: number; title: string };
  /** Score and lives carried from the previous wave. */
  carry?: { score: number; lives: number };
}

export type ObjectiveKind =
  | 'reachBalls'
  | 'triggerExplosions'
  | 'clearWithLives'
  | 'bestCombo'
  | 'clearWave';

/** An active effect shown in the HUD: a timed one (ratio of time left) or charges (count). */
export interface HudEffect {
  type: string;
  ratio: number;
  count?: number;
}

/** One-off messages from the game that the interface shows as toasts. */
export type GameNotice =
  | { kind: 'discovery'; id: string }
  /** A capsule was caught; `first` the very first time this power-up is met. */
  | { kind: 'pickup'; id: string; first: boolean }
  | { kind: 'combo'; id: 'meteor' | 'explosiveLasers' | 'sun' }
  | { kind: 'event'; id: 'descend' | 'storm' | 'bonusRain' | 'gatesOpen' }
  | { kind: 'achievement'; id: string };

/** Live state of the three level challenges (campaign only). */
export interface HudChallenges {
  objective: boolean;
  score: number;
  target: number;
  flawless: boolean;
}

export interface HudSnapshot {
  mode: GameMode;
  levelIndex: number;
  levelName: string;
  chapter: string;
  wave?: number;
  waveCount?: number;
  score: number;
  bestScore: number;
  lives: number;
  maxLives: number;
  combo: number;
  bestCombo: number;
  balls: number;
  bricksLeft: number;
  bricksTotal: number;
  waitingToLaunch: boolean;
  effects: HudEffect[];
  objective: { kind: ObjectiveKind; current: number; target: number };
  challenges?: HudChallenges;
}

export interface GameResult {
  outcome: 'victory' | 'defeat';
  mode: GameMode;
  levelIndex: number;
  levelName: string;
  score: number;
  medal?: LevelMedal;
  wave?: number;
  wavesCleared?: number;
  dateKey?: string;
  isNewBest: boolean;
  hasNext: boolean;
  editorReturn?: EditorReturn;
  session: GameSession;
  /** Campaign: challenges met in this run, collected so far, and new ones. */
  challenges?: {
    met: ChallengeId[];
    collected: ChallengeId[];
    fresh: ChallengeId[];
    scoreTarget: number;
  };
  breakdown?: ScoreBreakdownLine[];
  /** Trophies unlocked by this run. */
  trophies?: string[];
}

export interface BridgeEvents {
  /** Engine booted and textures are ready. */
  ready: undefined;
  hud: HudSnapshot;
  result: GameResult;
  /** The player pressed Esc/P or the page went to background. */
  pauseRequested: undefined;
  waveCleared: { wave: number; score: number; nextWave: number };
  notice: GameNotice;
  /** An in-canvas tool (editor, admin) asked to return to the interface. */
  exitToShell: { from: 'editor' | 'admin' };
  /** The engine is showing a canvas tool and the interface must step aside. */
  toolOpened: { tool: 'editor' | 'admin' };
}

type Listener<T> = (payload: T) => void;

export class GameBridge {
  private readonly listeners = new Map<keyof BridgeEvents, Set<Listener<never>>>();

  public on<K extends keyof BridgeEvents>(
    event: K,
    listener: Listener<BridgeEvents[K]>
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => set.delete(listener as Listener<never>);
  }

  public emit<K extends keyof BridgeEvents>(event: K, payload: BridgeEvents[K]): void {
    this.listeners.get(event)?.forEach((listener) => {
      try {
        (listener as Listener<BridgeEvents[K]>)(payload);
      } catch (error) {
        console.error(`[bridge] listener for "${event}" failed`, error);
      }
    });
  }

  public clear(): void {
    this.listeners.clear();
  }
}

export const bridge = new GameBridge();

/** Imperative API exposed by the engine once loaded. */
export interface GameController {
  start(session: GameSession): void;
  pause(): void;
  resume(): void;
  restart(): void;
  quit(): void;
  openEditor(editor: EditorReturn): void;
  openAdmin(): void;
  setSound(enabled: boolean, volume: number): void;
  isPlaying(): boolean;
  refreshLayout(): void;
  destroy(): void;
}
