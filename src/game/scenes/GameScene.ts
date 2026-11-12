import Phaser from 'phaser';
import { audio, haptic, type SfxName, type SfxOptions } from '../audio/AudioEngine';
import {
  bridge,
  type GameMode,
  type GameResult,
  type GameSession,
  type HudSnapshot,
  type ObjectiveKind
} from '../bridge';
import { CHAPTER_COUNT, getPowerUpDefinition, type PowerUpType } from '../config/powerUps';
import { getTheme, type ThemeDefinition } from '../config/themeConfig';
import { EffectState, type ComboId } from '../effects/EffectState';
import { newlyUnlocked, type RunStats } from '../progress/achievements';
import { challengesMet, medalFor } from '../progress/challenges';
import { finishBonuses, lifePenalty, parTimeMs } from '../progress/scoring';
import type { Ball } from '../entities/Ball';
import { Brick } from '../entities/Brick';
import { Lasers } from '../entities/Lasers';
import { groupCells, moveGroup, pairTeleporters, teleportExit } from '../mechanics/mechanics';
import { Paddle } from '../entities/Paddle';
import { POWER_UP_HALF_HEIGHT, POWER_UP_HALF_WIDTH, PowerUp } from '../entities/PowerUp';
import { createPatternFromEditorRows } from '../levels/editorGrid';
import { createLevelFromPattern } from '../levels/levelFactory';
import type { BrickKind, BrickSpec, LevelDefinition } from '../levels/levelTypes';
import { BallManager } from '../managers/BallManager';
import { PlayfieldRenderer } from '../managers/PlayfieldRenderer';
import {
  createWaveLevel,
  DAILY_WAVE_COUNT,
  ENDLESS_STARTING_LIVES,
  getPowerUpSeed
} from '../modes/waveGenerator';
import { stepBall, type StepContext, type StepEvent } from '../physics/ballStep';
import { BrickGrid } from '../physics/BrickGrid';
import { enforceMinVerticalAngle, setSpeed } from '../physics/geometry';
import {
  aimAngleToward,
  aimPath,
  paddleBounce,
  rampSpeed,
  separateFallers
} from '../physics/gameplayRules';
import { TEX } from '../render/textures';
import { Juice } from '../render/Juice';
import { ComboSystem } from '../systems/ComboSystem';
import { FxManager } from '../systems/FxManager';
import { InputSystem } from '../systems/InputSystem';
import { LevelSystem } from '../systems/LevelSystem';
import { ParticleSystem } from '../systems/ParticleSystem';
import {
  BALL_BONUS_DROP_TABLE,
  DROP_RATE_MULTIPLIER,
  dropTableFor,
  PowerUpSystem
} from '../systems/PowerUpSystem';
import { getSharedSaveSystem, type SaveSystem } from '../systems/SaveSystem';
import { ScoreSystem } from '../systems/ScoreSystem';
import { SettingsSystem } from '../systems/SettingsSystem';
import { DebugOverlay, isDebugOverlayEnabled, type DebugOverlaySnapshot } from '../ui/DebugOverlay';
import { SeededRandom } from '../utils/random';
import {
  BRICK_GAP,
  DEPTHS,
  BRICK_HEIGHT,
  MAX_LIVES,
  PADDLE_HEIGHT,
  PADDLE_Y,
  PLAYFIELD_LEFT,
  PLAYFIELD_RIGHT,
  PLAYFIELD_TOP,
  POWER_UP_DROP_SPEED
} from '../utils/constants';

/** Accepts a full session, or the legacy `{ levelIndex, source }` shape used by older callers. */
type GameSceneData = Partial<GameSession> & {
  source?: 'campaign' | 'creative';
};

const HUD_EMIT_INTERVAL_MS = 100;
const WAVE_TRANSITION_MS = 1100;
const EXPLOSION_STAGGER_MS = 55;
/** Capsule pool size, and how many may fall at once (more would be unreadable). */
const MAX_POWER_UPS = 24;
const MAX_FALLING_CAPSULES = 6;
const MAX_FRAME_MS = 50;
const TRAIL_BALL_LIMIT = 10;
const LASER_INTERVAL_MS = 320;
/** Height of the shield barrier that saves a ball. */
const SHIELD_Y = PADDLE_Y + 72;
const BIG_BALL_SCALE = 1.6;
const FIRE_TINT = 0xff9a4a;
const EXPLOSIVE_TINT = 0xff6a5a;
const GHOST_ALPHA = 0.08;
const MOVER_STEP_MS = 650;
const PHOENIX_RESPAWN_MS = 8000;
const FUSE_DELAY_MS = 130;
/** Bricks stop coming down once they reach this row (well above the paddle). */
const DESCEND_LIMIT_ROW = 44;
const STORM_INTERVAL_MS = 9000;
const BONUS_RAIN_EVERY = 25;
/** Brick kinds introduced in v1.2: the interface explains each one the first time. */
const NEW_KINDS: readonly BrickKind[] = [
  'crystal',
  'key',
  'gate',
  'phoenix',
  'invisible',
  'mover',
  'bumper',
  'teleporter',
  'fuse'
];

const COMBO_NAMES: Record<ComboId, { fr: string; en: string }> = {
  meteor: { fr: 'MÉTÉORE !', en: 'METEOR!' },
  explosiveLasers: { fr: 'LASERS EXPLOSIFS !', en: 'EXPLOSIVE LASERS!' },
  sun: { fr: 'SOLEIL !', en: 'SUN!' }
};

interface PendingExplosion {
  x: number;
  y: number;
  depth: number;
  at: number;
  color: number;
}

export class GameScene extends Phaser.Scene {
  private levelSystem!: LevelSystem;
  private level!: LevelDefinition;
  private theme!: ThemeDefinition;
  private paddle!: Paddle;
  private ballManager!: BallManager;
  private bricks!: Phaser.GameObjects.Group;
  private grid!: BrickGrid<Brick>;
  private readonly powerUps: PowerUp[] = [];
  private inputSystem!: InputSystem;
  private particleSystem!: ParticleSystem;
  private powerUpSystem!: PowerUpSystem;
  private scoreSystem!: ScoreSystem;
  private comboSystem!: ComboSystem;
  private saveSystem!: SaveSystem;
  private settingsSystem!: SettingsSystem;
  private fxManager!: FxManager;
  private juice!: Juice;
  private debugOverlay?: DebugOverlay;
  private stepContext!: StepContext<Brick>;
  private readonly stepEvents: Array<StepEvent<Brick>> = [];
  private readonly explosions: PendingExplosion[] = [];
  private lives = 3;
  private levelIndex = 0;
  private levelSource: 'campaign' | 'creative' = 'campaign';
  private editorReturn?: GameSession['editorReturn'];
  private session!: GameSession;
  private mode: GameMode = 'campaign';
  private wave = 1;
  private runSeed = 0;
  private bricksTotal = 0;
  private breakableLeft = 0;
  private hudElapsedMs = HUD_EMIT_INTERVAL_MS;
  private demoLaunchMs = 0;
  private reducedMotion = false;
  private autopilot = false;
  private aiming = false;
  private aimGraphics!: Phaser.GameObjects.Graphics;
  private aimArrow!: Phaser.GameObjects.Image;
  private aimPulse = 0;
  private ending = false;
  private respawning = false;
  private explosionsTriggered = 0;
  private gameTime = 0;
  private readonly effects = new EffectState();
  private lasers!: Lasers<Brick>;
  private laserCooldownMs = 0;
  private shieldBar!: Phaser.GameObjects.Rectangle;
  private language: 'fr' | 'en' = 'fr';
  private teleportPairs = new Map<Brick, Brick[]>();
  private readonly obstacleOverlays = new Map<Brick, Phaser.GameObjects.Image>();
  private keysLeft = 0;
  private moverClockMs = 0;
  private readonly phoenixQueue: Array<{ spec: BrickSpec; at: number }> = [];
  private readonly fuseQueue: Array<{ brick: Brick; at: number }> = [];
  private readonly litFuses = new Set<Brick>();
  private livesLost = 0;
  private pickups = 0;
  private riskPickups = 0;
  private trophyClockMs = 0;
  private descendClockMs = 0;
  private stormClockMs = 0;
  private lastRainCombo = 0;
  private readonly announced = new Set<string>();
  private lightning!: Phaser.GameObjects.Graphics;

  public constructor() {
    super('GameScene');
  }

  // ------------------------------------------------------------------ public API

  public get activeBallLimit(): number {
    return this.ballManager.getActiveLimit();
  }

  public set activeBallLimit(limit: number) {
    this.ballManager.setActiveLimit(limit);
  }

  public createBall(attached: boolean): Ball | null {
    return this.ballManager.createBall(attached);
  }

  public launchAttachedBalls(): void {
    const hadAttached = this.getBalls().some((ball) => ball.isAttached);
    this.ballManager.launchAttachedBalls();
    if (hadAttached) {
      this.sfx('launch', { x: this.paddle.x });
      this.particleSystem.sparkBurst(this.paddle.x, this.paddle.top, this.theme.primary, 8);
    }
  }

  public getSession(): GameSession {
    return { ...this.session };
  }

  public isDemo(): boolean {
    return this.mode === 'demo';
  }

  /** Lets the computer play (used for the home preview and to record README media). */
  public setAutopilot(enabled: boolean): void {
    this.autopilot = enabled;
  }

  public setSound(enabled: boolean, volume: number): void {
    audio.setEnabled(enabled);
    audio.setVolume(volume);
  }

  // ------------------------------------------------------------------ lifecycle

  public create(data: GameSceneData): void {
    const camera = this.cameras.main;
    this.tweens.killTweensOf(camera);
    camera.resetFX();
    camera.setAlpha(1).setZoom(1).setScroll(0, 0).setRotation(0);

    this.session = this.normalizeSession(data);
    this.mode = this.session.mode;
    this.levelIndex = this.session.levelIndex;
    this.levelSource = this.mode === 'creative' ? 'creative' : 'campaign';
    this.editorReturn = this.session.editorReturn;
    this.wave = this.session.wave ?? 1;
    this.runSeed = this.session.seed ?? 0;
    this.saveSystem = getSharedSaveSystem();
    this.settingsSystem = new SettingsSystem(this.saveSystem);
    this.levelSystem = new LevelSystem(this.saveSystem);
    this.level =
      this.mode === 'endless' || this.mode === 'daily'
        ? createWaveLevel({ mode: this.mode, runSeed: this.runSeed, wave: this.wave })
        : this.createSessionLevel();

    const preferences = this.saveSystem.snapshot().preferences;
    this.reducedMotion = preferences.reducedMotion;
    this.language = preferences.language;
    this.theme = getTheme(preferences.themeId);
    audio.setEnabled(preferences.soundEnabled);
    audio.setVolume(preferences.volumeSfx);

    const quality = this.reducedMotion ? 'low' : this.settingsSystem.getFxQuality();
    this.scoreSystem = new ScoreSystem(this.getModeBestScore(), this.session.carry?.score ?? 0);
    this.comboSystem = new ComboSystem();
    const chapter = this.mode === 'creative' ? CHAPTER_COUNT - 1 : Math.floor(this.level.index / 6);
    const options = this.level.options;
    this.powerUpSystem = new PowerUpSystem(
      this.isWaveMode() ? new SeededRandom(getPowerUpSeed(this.runSeed, this.wave)) : undefined,
      dropTableFor(chapter, options?.powerUps),
      BALL_BONUS_DROP_TABLE,
      DROP_RATE_MULTIPLIER[options?.dropRate ?? 'normal']
    );
    this.particleSystem = new ParticleSystem(
      this,
      quality === 'low' ? 0.5 : quality === 'high' ? 1.25 : 1
    );
    this.fxManager = new FxManager(this, this.particleSystem, quality);
    this.juice = new Juice(this, this.reducedMotion);
    this.lives =
      this.session.carry?.lives ??
      (this.isWaveMode() ? ENDLESS_STARTING_LIVES : this.level.difficulty.initialLives);
    this.hudElapsedMs = HUD_EMIT_INTERVAL_MS;
    this.demoLaunchMs = 0;
    this.autopilot = false;
    this.ending = false;
    this.respawning = false;
    this.explosionsTriggered = 0;
    this.livesLost = 0;
    this.pickups = 0;
    this.riskPickups = 0;
    this.trophyClockMs = 0;
    this.gameTime = 0;
    this.explosions.length = 0;
    this.powerUps.length = 0;
    this.debugOverlay = undefined;
    this.effects.clear();
    this.laserCooldownMs = 0;
    this.moverClockMs = 0;
    this.phoenixQueue.length = 0;
    this.fuseQueue.length = 0;
    this.litFuses.clear();
    this.descendClockMs = 0;
    this.stormClockMs = 0;
    this.lastRainCombo = 0;
    this.announced.clear();

    new PlayfieldRenderer(this, this.theme).render();
    if (!this.reducedMotion) {
      this.particleSystem.startEmbers();
    }

    this.paddle = new Paddle(this);
    this.ballManager = new BallManager(this, this.paddle, {
      ballSpeed: this.level.difficulty.ballSpeed,
      maxBallSpeed: this.level.difficulty.maxBallSpeed,
      onBallSpawned: (ball) => this.juice.glow(ball.x, ball.y, this.theme.primary, 40, 40, 200, 0.6)
    });
    this.inputSystem = new InputSystem(this);
    // Keys must keep working for the HTML interface (Tab, Space on buttons...).
    this.input.keyboard?.disableGlobalCapture();

    this.createBricks();
    this.ballManager.createAttachedBall();
    this.stepContext = {
      bounds: { left: PLAYFIELD_LEFT, right: PLAYFIELD_RIGHT, top: PLAYFIELD_TOP },
      grid: this.grid,
      paddle: null,
      bouncePaddle: (ball) => this.bounceOffPaddle(ball as Ball),
      isActive: (brick) => brick.active,
      passThrough: (ball, brick) =>
        (brick.kind === 'teleporter' &&
          this.teleportPairs.has(brick) &&
          (ball as Ball).teleportReadyAt <= this.gameTime) ||
        (this.effects.has('fireBall') && brick.isBreakable)
    };
    this.lasers = new Lasers<Brick>(this, 0xff4d8d);
    this.lightning = this.add
      .graphics()
      .setDepth(DEPTHS.ball + 4)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.shieldBar = this.add
      .rectangle(540, SHIELD_Y, PLAYFIELD_RIGHT - PLAYFIELD_LEFT - 8, 6, 0x7fe8ff, 0.85)
      .setDepth(DEPTHS.paddle - 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);

    if (isDebugOverlayEnabled()) {
      this.debugOverlay = new DebugOverlay(this);
    }
    this.aiming = false;
    this.aimGraphics = this.add.graphics().setDepth(DEPTHS.ball + 2);
    this.aimArrow = this.add
      .image(0, 0, TEX.spark)
      .setDepth(DEPTHS.ball + 3)
      .setVisible(false)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.registerSceneInput();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdownSystems, this);
    this.emitHud();
  }

  public override update(time: number, delta: number): void {
    const frameMs = Math.min(delta, MAX_FRAME_MS);
    this.juice.update(frameMs);
    if (this.ending) {
      this.updatePowerUps(frameMs / 1000);
      return;
    }

    if (this.mode === 'demo' || this.autopilot) {
      this.updateDemoPilot(time, frameMs);
    } else {
      this.inputSystem.updatePaddle(this.paddle, frameMs);
    }
    this.paddle.afterMove(frameMs, this.reducedMotion);
    this.updateAim();

    const physicsMs = this.juice.scaleDelta(frameMs);
    this.gameTime += physicsMs;
    if (physicsMs > 0) {
      this.stepBalls(physicsMs / 1000);
      this.applyShield();
      this.updateLasers(physicsMs);
      this.effects.tick(physicsMs).forEach((type) => this.onEffectEnd(type));
    }
    if (this.ballManager.update(this.respawning)) {
      this.loseLife();
    }
    this.processExplosions();
    this.updateMechanics(physicsMs);
    this.updateLevelEvents(physicsMs);
    this.updatePowerUps(physicsMs / 1000);
    this.updateBallVisuals(frameMs);

    this.ballManager.updateAdaptiveLimit(delta);
    this.fxManager.tickPerformance(delta);
    this.ballManager.flushPendingClones();
    const combo = this.comboSystem.update(physicsMs);
    this.juice.combo(combo.streak);

    this.trophyClockMs += physicsMs;
    if (this.trophyClockMs >= 1000) {
      this.trophyClockMs = 0;
      this.checkTrophies(false);
    }

    this.hudElapsedMs += frameMs;
    if (this.hudElapsedMs >= HUD_EMIT_INTERVAL_MS) {
      this.emitHud();
    }
    this.debugOverlay?.update(delta, this.buildDebugOverlaySnapshot());
  }

  // ------------------------------------------------------------------ setup

  private normalizeSession(data: GameSceneData | undefined): GameSession {
    const mode: GameMode = data?.mode ?? (data?.source === 'creative' ? 'creative' : 'campaign');
    const session: GameSession = {
      mode,
      levelIndex: Math.max(0, Math.floor(data?.levelIndex ?? 0)),
      editorReturn: data?.editorReturn
    };
    if (mode === 'creative' && data?.draft && Array.isArray(data.draft.rows)) {
      session.draft = {
        name: String(data.draft.name ?? ''),
        rows: [...data.draft.rows],
        options: data.draft.options
      };
      if (data.community && typeof data.community.id === 'string') {
        session.community = { ...data.community };
      }
    }
    if (mode === 'endless' || mode === 'daily') {
      session.wave = Math.max(1, Math.floor(data?.wave ?? 1));
      session.seed = (data?.seed ?? 0) >>> 0;
      session.dateKey = data?.dateKey;
    }
    if (data?.carry) {
      session.carry = {
        score: Math.max(0, data.carry.score),
        lives: Math.max(1, data.carry.lives)
      };
    }
    return session;
  }

  /** Campaign or creative level, or the editor's unsaved draft when testing it. */
  private createSessionLevel(): LevelDefinition {
    const draft = this.session.draft;
    if (this.mode === 'creative' && draft) {
      try {
        return createLevelFromPattern(
          createPatternFromEditorRows(this.levelIndex, draft.name, draft.rows, draft.options),
          this.levelIndex
        );
      } catch {
        // Invalid draft: fall back to the saved slot.
      }
    }
    return this.levelSystem.getLevel(this.levelIndex, this.levelSource);
  }

  private createBricks(): void {
    const cols = Math.max(1, this.level.cols);
    const rows = Math.max(1, this.level.rows);
    const sample = this.level.bricks[0];
    const brickWidth =
      sample?.width ?? (PLAYFIELD_RIGHT - PLAYFIELD_LEFT - BRICK_GAP * (cols - 1)) / cols;
    this.grid = new BrickGrid<Brick>(
      cols,
      rows,
      PLAYFIELD_LEFT,
      PLAYFIELD_TOP,
      brickWidth + BRICK_GAP,
      BRICK_HEIGHT + BRICK_GAP
    );
    this.bricks = this.add.group();
    this.keysLeft = this.level.bricks.filter((spec) => spec.kind === 'key').length;
    this.level.bricks.forEach((spec) => {
      const brick = new Brick(this, spec);
      this.bricks.add(brick);
      this.grid.set(brick);
      if (spec.kind === 'gate') brick.locked = this.keysLeft > 0;
      const targetAlpha = spec.kind === 'invisible' ? GHOST_ALPHA : 1;
      if (spec.kind === 'invisible') brick.revealed = false;
      if (!this.reducedMotion && this.mode !== 'demo') {
        // Bricks drop into place row by row when the level starts.
        const targetY = brick.y;
        brick.setY(targetY - 26).setAlpha(0);
        this.tweens.add({
          targets: brick,
          y: targetY,
          alpha: targetAlpha,
          delay: spec.row * 9 + (spec.col % 2) * 6,
          duration: 260,
          ease: 'Back.easeOut'
        });
      } else {
        brick.setAlpha(targetAlpha);
      }
    });
    this.teleportPairs = pairTeleporters(
      this.getBricks().filter((brick) => brick.kind === 'teleporter')
    );
    this.createObstacleOverlays();
    // Neighbouring moving groups start in opposite directions, like gears.
    groupCells(this.getBricks().filter((brick) => brick.kind === 'mover')).forEach((group, index) =>
      group.forEach((brick) => (brick.moveDir = index % 2 === 0 ? 1 : -1))
    );
    this.bricksTotal = this.getBricks().filter((brick) => brick.isRequired).length;
    this.breakableLeft = this.bricksTotal;
    const kinds = new Set(this.level.bricks.map((spec) => spec.kind));
    NEW_KINDS.filter((kind) => kinds.has(kind)).forEach((kind) => this.discover(`brick:${kind}`));
  }

  private registerSceneInput(): void {
    this.input.on('pointerdown', this.startAiming, this);
    this.input.on('pointerup', this.releaseAim, this);
    this.input.on('pointerupoutside', this.releaseAim, this);
    this.input.keyboard?.on('keydown-SPACE', this.unlockAndLaunch, this);
    this.input.keyboard?.on('keydown-ENTER', this.unlockAndLaunch, this);
    this.input.keyboard?.on('keydown-P', this.pauseGame, this);
    this.input.keyboard?.on('keydown-ESC', this.pauseGame, this);
    this.input.keyboard?.on('keydown-R', this.restartLevel, this);
  }

  private shutdownSystems(): void {
    this.debugOverlay?.destroy();
    this.debugOverlay = undefined;
    this.inputSystem.destroy();
    this.ballManager.destroy();
    this.powerUps.length = 0;
    this.explosions.length = 0;
    this.lasers.clear();
    this.input.off('pointerdown', this.startAiming, this);
    this.input.off('pointerup', this.releaseAim, this);
    this.input.off('pointerupoutside', this.releaseAim, this);
    this.input.keyboard?.off('keydown-SPACE', this.unlockAndLaunch, this);
    this.input.keyboard?.off('keydown-ENTER', this.unlockAndLaunch, this);
    this.input.keyboard?.off('keydown-P', this.pauseGame, this);
    this.input.keyboard?.off('keydown-ESC', this.pauseGame, this);
    this.input.keyboard?.off('keydown-R', this.restartLevel, this);
  }

  /** Keyboard launch (Space/Enter): toward the current aim. */
  private unlockAndLaunch(): void {
    if (this.mode === 'demo' || this.ending) {
      return;
    }
    audio.unlock();
    this.aiming = false;
    this.inputSystem.frozen = false;
    this.launchAttachedBalls();
  }

  /** Pressing on the game with a ball on the paddle starts aiming instead of launching. */
  private startAiming(): void {
    if (this.mode === 'demo' || this.ending) {
      return;
    }
    audio.unlock();
    if (this.getBalls().some((ball) => ball.isAttached)) {
      this.aiming = true;
      this.inputSystem.frozen = true;
    }
  }

  /** Releasing the press launches toward the arrow. */
  private releaseAim(): void {
    if (!this.aiming) {
      return;
    }
    this.aiming = false;
    this.inputSystem.frozen = false;
    if (!this.ending) {
      this.launchAttachedBalls();
    }
  }

  // ------------------------------------------------------------------ physics

  private stepBalls(dt: number): void {
    const paddle = this.paddle;
    this.stepContext.paddle = {
      x: paddle.x,
      top: paddle.top,
      width: paddle.activeWidth,
      height: PADDLE_HEIGHT
    };
    const ballDt = dt * this.effects.ballTimeScale();
    for (const ball of this.ballManager.getActiveBalls()) {
      if (ball.isAttached) continue;
      this.stepEvents.length = 0;
      stepBall(ball, ballDt, this.stepContext, this.stepEvents);
      for (const event of this.stepEvents) {
        if (!ball.active || ball.isAttached) break;
        this.handleStepEvent(ball, event);
      }
      if (!ball.isAttached) {
        const keep = enforceMinVerticalAngle(ball.vx, ball.vy, 12);
        const speed = Math.max(ball.speed, this.ballManager.baseSpeed * 0.8);
        const v = setSpeed(keep.vx, keep.vy, speed);
        ball.vx = v.vx;
        ball.vy = v.vy;
      }
    }
  }

  private handleStepEvent(ball: Ball, event: StepEvent<Brick>): void {
    switch (event.type) {
      case 'wall': {
        ball.impact = 0.7;
        this.sfx('wall', { x: event.x });
        const onSide = event.side !== 'top';
        const glowX =
          event.side === 'left'
            ? PLAYFIELD_LEFT
            : event.side === 'right'
              ? PLAYFIELD_RIGHT
              : event.x;
        const glowY = event.side === 'top' ? PLAYFIELD_TOP : event.y;
        this.juice.glow(
          glowX,
          glowY,
          this.theme.primary,
          onSide ? 26 : 90,
          onSide ? 90 : 26,
          200,
          0.7
        );
        break;
      }
      case 'paddle':
        this.onPaddleHit(ball);
        break;
      case 'brick':
        this.onBrickContact(ball, event);
        break;
    }
  }

  /** A ball touched a brick: bounce damage, fire burn, explosive charges and combos. */
  private onBrickContact(ball: Ball, event: Extract<StepEvent<Brick>, { type: 'brick' }>): void {
    const brick = event.item;
    ball.impact = 1;
    if (brick.kind === 'teleporter' && event.pierced) {
      this.teleport(ball, brick);
      return;
    }
    if (!brick.isBreakable) {
      if (brick.kind === 'bumper') {
        this.bump(ball, brick);
        return;
      }
      this.sfx(brick.kind === 'gate' ? 'mechanism' : 'steel', { x: event.x });
      brick.flash(50);
      this.particleSystem.sparkBurst(event.x, event.y, 0xd8d2c4, 4);
      return;
    }
    const { x, y } = brick;
    if (event.pierced) {
      // Fire ball: burns straight through.
      this.sfx('fire', { x: event.x });
      this.particleSystem.sparkBurst(event.x, event.y, FIRE_TINT, 6);
      this.damageBrick(brick, 99, 0, ball, event.x, event.y);
      if (this.effects.has('bigBall')) this.burnAround(brick.col, brick.row, ball);
    } else {
      this.damageBrick(brick, this.effects.has('bigBall') ? 2 : 1, 0, ball, event.x, event.y);
    }
    if (this.effects.explosiveCharges > 0 && this.effects.useExplosiveCharge()) {
      this.explode(x, y, EXPLOSIVE_TINT, 1);
    }
  }

  /** Sun combo (big + fire): the ball also scorches the four neighbours. */
  private burnAround(col: number, row: number, ball: Ball): void {
    const neighbours = [
      this.grid.get(col + 1, row),
      this.grid.get(col - 1, row),
      this.grid.get(col, row + 1),
      this.grid.get(col, row - 1)
    ];
    neighbours.forEach((brick) => {
      if (brick && brick.active && brick.isBreakable) {
        this.damageBrick(brick, 1, 1, ball);
      }
    });
  }

  private bounceOffPaddle(ball: Ball): { vx: number; vy: number } {
    ball.speed = rampSpeed(
      Math.max(ball.speed, this.ballManager.baseSpeed),
      this.ballManager.maxSpeed
    );
    return paddleBounce({
      ballX: ball.x,
      paddleX: this.paddle.x,
      paddleWidth: this.paddle.activeWidth,
      paddleVx: this.paddle.vx,
      speed: ball.speed
    });
  }

  private onPaddleHit(ball: Ball): void {
    const offset = (ball.x - this.paddle.x) / (this.paddle.activeWidth / 2);
    ball.impact = 1;
    this.paddle.bump(0.8);
    this.sfx('paddle', { x: ball.x, offset });
    this.juice.ring(ball.x, this.paddle.top, this.theme.primary, 0.55, 260);
    this.particleSystem.sparkBurst(ball.x, this.paddle.top, this.theme.primary, 5);
    this.juice.shake(0.06);

    if (this.effects.has('stickyPaddle')) {
      ball.attachOffset = Phaser.Math.Clamp(
        ball.x - this.paddle.x,
        -this.paddle.activeWidth / 2 + 10,
        this.paddle.activeWidth / 2 - 10
      );
      ball.attachToPaddle(this.paddle);
    }
  }

  // ------------------------------------------------------------------ bricks

  /** Damages a brick; public so diagnostics can clear levels. */
  public damageBrick(
    brick: Brick,
    amount: number,
    chainDepth: number,
    sourceBall?: Ball,
    hitX = brick.x,
    hitY = brick.y
  ): void {
    if (!brick.active || !brick.isBreakable) {
      return;
    }
    if (!brick.revealed) {
      // Ghost brick: the first touch only reveals it (strong hits go straight through).
      this.reveal(brick);
      if (amount < 2) return;
    }

    const destroyed = brick.damage(amount);
    if (!destroyed) {
      brick.flash(55);
      this.punch(brick);
      this.sfx('brickHit', { x: hitX });
      this.particleSystem.sparkBurst(hitX, hitY, brick.spec.color, 4);
      return;
    }

    const { x, y } = brick;
    const { color, kind, powerUpChance, score } = brick.spec;
    const required = brick.isRequired;
    this.grid.remove(brick);
    this.bricks.remove(brick, false, false);
    brick.setActive(false);
    if (required) {
      this.breakableLeft = Math.max(0, this.breakableLeft - 1);
    }
    this.playBreakAnimation(brick);

    const combo = this.comboSystem.registerBreak();
    const awarded = this.scoreSystem.registerBrickBreak(
      score,
      combo.multiplier * this.effects.scoreMultiplier(),
      this.level.difficulty.scoreMultiplier
    );
    this.sfx('brickBreak', { x, combo: combo.streak });
    this.particleSystem.brickShatter(x, y, color, kind === 'explosive' ? 6 : 9);
    this.juice.popup(
      x,
      y - 10,
      `+${awarded}`,
      combo.streak >= 10 ? '#ffd36b' : '#fff4d6',
      combo.streak >= 10 ? 34 : 28
    );
    if (combo.streak > 0 && combo.streak % 10 === 0) {
      this.sfx('comboMilestone', { x });
      this.juice.popup(540, 1250, `COMBO ×${combo.streak}`, '#ffb423', 56, true);
      this.juice.shake(0.12);
    }

    if (kind === 'explosive') {
      this.explode(x, y, color, chainDepth);
    }
    this.onSpecialBrickDestroyed(brick, sourceBall);

    // Chain reactions break many bricks at once: they drop half as often.
    this.spawnPowerUp(
      x,
      y,
      chainDepth > 0 ? powerUpChance * 0.5 : powerUpChance,
      sourceBall,
      kind === 'bonus'
    );

    if (this.breakableLeft === 0 && !this.ending) {
      this.crumblePhoenixes();
      this.onLastBrick(x, y);
    }
    this.checkVictory();
  }

  // ------------------------------------------------------------------ special bricks

  private onSpecialBrickDestroyed(brick: Brick, sourceBall?: Ball): void {
    switch (brick.kind) {
      case 'crystal':
        this.splitBalls(sourceBall, [0.5]);
        this.juice.ring(brick.x, brick.y, brick.spec.color, 0.9, 300);
        break;
      case 'key':
        this.keysLeft = Math.max(0, this.keysLeft - 1);
        this.sfx('mechanism', { x: brick.x });
        if (this.keysLeft === 0) this.openGates();
        break;
      case 'phoenix':
        if (!this.ending) {
          this.phoenixQueue.push({ spec: brick.spec, at: this.gameTime + PHOENIX_RESPAWN_MS });
        }
        break;
      case 'fuse':
        this.igniteNeighbours(brick);
        break;
      default:
        break;
    }
  }

  private reveal(brick: Brick): void {
    brick.revealed = true;
    this.tweens.killTweensOf(brick);
    brick.setAlpha(1);
    brick.flash(90);
    this.sfx('mechanism', { x: brick.x });
    this.juice.ring(brick.x, brick.y, 0xffffff, 0.6, 240);
  }

  private openGates(): void {
    const gates = this.getBricks().filter((brick) => brick.kind === 'gate');
    if (gates.length === 0) return;
    if (this.mode !== 'demo') bridge.emit('notice', { kind: 'event', id: 'gatesOpen' });
    gates
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .forEach((gate, index) => {
        gate.locked = false;
        this.time.delayedCall(index * 28, () => {
          if (gate.active && this.scene.isActive()) this.damageBrick(gate, 99, 1);
        });
      });
  }

  private igniteNeighbours(brick: Brick): void {
    const neighbours = [
      this.grid.get(brick.col + 1, brick.row),
      this.grid.get(brick.col - 1, brick.row),
      this.grid.get(brick.col, brick.row + 1),
      this.grid.get(brick.col, brick.row - 1)
    ].filter(
      (item): item is Brick =>
        Boolean(item) && item!.active && item!.kind === 'fuse' && !this.litFuses.has(item!)
    );
    if (neighbours.length === 0) {
      // End of the fuse: boom.
      this.explode(brick.x, brick.y, brick.spec.color, 1);
      return;
    }
    neighbours.forEach((item) => {
      this.litFuses.add(item);
      this.fuseQueue.push({ brick: item, at: this.gameTime + FUSE_DELAY_MS });
      this.particleSystem.sparkBurst(item.x, item.y, 0xfff2b0, 3);
    });
  }

  /**
   * Bumpers and teleporters drawn in pixel art cover 2 × 2 cells: show one large sprite per
   * group (physics still uses the cells) so they read as one round bumper or one portal.
   */
  private createObstacleOverlays(): void {
    this.obstacleOverlays.clear();
    (['bumper', 'teleporter'] as const).forEach((kind) => {
      groupCells(this.getBricks().filter((brick) => brick.kind === kind)).forEach((group) => {
        if (group.length < 2) return;
        const left = Math.min(...group.map((brick) => brick.box.left));
        const right = Math.max(...group.map((brick) => brick.box.right));
        const top = Math.min(...group.map((brick) => brick.box.top));
        const bottom = Math.max(...group.map((brick) => brick.box.bottom));
        const size = Math.min(right - left, bottom - top) + 6;
        const first = group[0]!;
        const overlay = this.add
          .image((left + right) / 2, (top + bottom) / 2, first.texture.key)
          .setDisplaySize(size, size)
          .setDepth(DEPTHS.bricks + 1);
        group.forEach((brick) => {
          brick.setVisible(false);
          this.obstacleOverlays.set(brick, overlay);
        });
        if (kind === 'teleporter' && !this.reducedMotion) {
          this.tweens.add({ targets: overlay, angle: 360, duration: 4000, repeat: -1 });
        }
      });
    });
  }

  private teleport(ball: Ball, entry: Brick): void {
    const portal = this.teleportPairs.get(entry);
    if (!portal || portal.length === 0) return;
    const left = Math.min(...portal.map((brick) => brick.box.left));
    const right = Math.max(...portal.map((brick) => brick.box.right));
    const top = Math.min(...portal.map((brick) => brick.box.top));
    const bottom = Math.max(...portal.map((brick) => brick.box.bottom));
    const exitX = (left + right) / 2;
    const exitY = (top + bottom) / 2;
    const target = teleportExit(
      { x: exitX, y: exitY, halfWidth: (right - left) / 2, halfHeight: (bottom - top) / 2 },
      ball.vx,
      ball.vy,
      ball.radius
    );
    ball.setPosition(
      Phaser.Math.Clamp(target.x, PLAYFIELD_LEFT + ball.radius, PLAYFIELD_RIGHT - ball.radius),
      Math.max(PLAYFIELD_TOP + ball.radius, target.y)
    );
    ball.teleportReadyAt = this.gameTime + 220;
    this.sfx('teleport', { x: exitX });
    this.juice.ring(entry.x, entry.y, entry.spec.color, 0.8, 260);
    this.juice.ring(exitX, exitY, entry.spec.color, 1.1, 320);
    this.particleSystem.sparkBurst(exitX, exitY, entry.spec.color, 8);
  }

  private bump(ball: Ball, bumper: Brick): void {
    const speed = Math.min(this.ballManager.maxSpeed * 1.1, Math.max(ball.speed, 1) * 1.12);
    ball.speed = speed;
    const v = setSpeed(ball.vx, ball.vy, speed);
    ball.vx = v.vx;
    ball.vy = v.vy;
    const points = this.scoreSystem.addBonus(25 * this.effects.scoreMultiplier());
    this.juice.popup(bumper.x, bumper.y - 12, `+${points}`, '#ff9ad5', 24);
    this.juice.ring(bumper.x, bumper.y, bumper.spec.color, 0.9, 240);
    this.sfx('bumper', { x: bumper.x });
    const overlay = this.obstacleOverlays.get(bumper);
    if (overlay) {
      this.tweens.killTweensOf(overlay);
      const scale = overlay.scaleX;
      overlay.setScale(scale * 1.25);
      this.tweens.add({ targets: overlay, scale, duration: 180, ease: 'Back.easeOut' });
    } else {
      this.punch(bumper);
    }
  }

  // ------------------------------------------------------------------ level events

  private announce(id: 'descend' | 'storm' | 'bonusRain'): void {
    if (this.announced.has(id) || this.mode === 'demo') return;
    this.announced.add(id);
    bridge.emit('notice', { kind: 'event', id });
  }

  private updateLevelEvents(deltaMs: number): void {
    const options = this.level.options;
    if (!options || this.ending || this.getBalls().every((ball) => ball.isAttached)) return;

    if (options.descendEverySec) {
      this.descendClockMs += deltaMs;
      if (this.descendClockMs >= options.descendEverySec * 1000) {
        this.descendClockMs = 0;
        this.descendBricks();
      }
    }
    if (options.storm) {
      this.stormClockMs += deltaMs;
      if (this.stormClockMs >= STORM_INTERVAL_MS) {
        this.stormClockMs = 0;
        this.strikeLightning();
      }
    }
    if (options.bonusRain) {
      const streak = this.comboSystem.snapshot().streak;
      if (streak < this.lastRainCombo) this.lastRainCombo = 0;
      if (streak >= this.lastRainCombo + BONUS_RAIN_EVERY) {
        this.lastRainCombo = streak - (streak % BONUS_RAIN_EVERY);
        this.rainPowerUps();
      }
    }
  }

  /** Every brick moves down one row, as long as the lowest one stays above the limit. */
  private descendBricks(): void {
    const bricks = this.getBricks();
    const lowest = bricks.reduce((max, brick) => Math.max(max, brick.row), 0);
    if (bricks.length === 0 || lowest >= DESCEND_LIMIT_ROW) return;
    this.announce('descend');
    const pitchY = BRICK_HEIGHT + BRICK_GAP;
    bricks
      .sort((a, b) => b.row - a.row)
      .forEach((brick) => {
        this.grid.remove(brick);
        const x = (brick.box.left + brick.box.right) / 2;
        const y = (brick.box.top + brick.box.bottom) / 2 + pitchY;
        brick.moveToCell(brick.col, brick.row + 1, x, y);
        this.grid.set(brick);
        this.tweens.add({ targets: brick, y, duration: 260, ease: 'Back.easeOut' });
      });
    new Set(this.obstacleOverlays.values()).forEach((overlay) =>
      this.tweens.add({
        targets: overlay,
        y: overlay.y + pitchY,
        duration: 260,
        ease: 'Back.easeOut'
      })
    );
    this.sfx('mechanism', { x: 540 });
    this.juice.shake(0.12);
  }

  private strikeLightning(): void {
    const targets = this.getBricks().filter((brick) => brick.isBreakable);
    const target = targets[Math.floor(Math.random() * targets.length)];
    if (!target) return;
    this.announce('storm');
    const g = this.lightning;
    g.clear();
    g.lineStyle(4, 0xcfe8ff, 1);
    g.beginPath();
    let x = target.x + (Math.random() - 0.5) * 120;
    let y = PLAYFIELD_TOP;
    g.moveTo(x, y);
    const steps = 7;
    for (let index = 1; index <= steps; index += 1) {
      const t = index / steps;
      x = target.x + (Math.random() - 0.5) * 70 * (1 - t);
      y = PLAYFIELD_TOP + (target.y - PLAYFIELD_TOP) * t;
      g.lineTo(x, y);
    }
    g.strokePath();
    this.tweens.add({
      targets: g,
      alpha: { from: 1, to: 0 },
      duration: 260,
      onComplete: () => g.clear()
    });
    this.sfx('explosion', { x: target.x, intensity: 0.35 });
    this.juice.glow(target.x, target.y, 0xcfe8ff, 160, 160, 220, 0.9);
    this.damageBrick(target, 1, 1, undefined, target.x, target.y);
  }

  private rainPowerUps(): void {
    this.announce('bonusRain');
    for (let index = 0; index < 3; index += 1) {
      const x = PLAYFIELD_LEFT + 80 + Math.random() * (PLAYFIELD_RIGHT - PLAYFIELD_LEFT - 160);
      this.spawnSpecificPowerUp(x, PLAYFIELD_TOP + 30, this.powerUpSystem.rollAny());
    }
  }

  /** When the level is won, phoenix bricks burn out for good. */
  private crumblePhoenixes(): void {
    this.phoenixQueue.length = 0;
    this.getBricks()
      .filter((brick) => brick.kind === 'phoenix')
      .forEach((brick) => {
        this.grid.remove(brick);
        this.bricks.remove(brick, false, false);
        brick.setActive(false);
        this.particleSystem.brickShatter(brick.x, brick.y, brick.spec.color, 6);
        this.playBreakAnimation(brick);
      });
  }

  private updateMechanics(deltaMs: number): void {
    if (this.ending) return;
    // Fuses burn one link at a time.
    if (this.fuseQueue.length > 0) {
      const due = this.fuseQueue.filter((item) => item.at <= this.gameTime);
      if (due.length > 0) {
        this.fuseQueue.splice(
          0,
          this.fuseQueue.length,
          ...this.fuseQueue.filter((item) => item.at > this.gameTime)
        );
        due.forEach((item) => {
          if (item.brick.active) {
            this.sfx('fire', { x: item.brick.x });
            this.damageBrick(item.brick, 99, 1);
          }
        });
      }
    }
    // Phoenix bricks come back if the level is not finished yet.
    if (this.phoenixQueue.length > 0) {
      for (const item of this.phoenixQueue) {
        if (item.at > this.gameTime) continue;
        if (this.breakableLeft === 0) {
          item.at = Infinity;
          continue;
        }
        if (this.grid.get(item.spec.col, item.spec.row)) {
          item.at = this.gameTime + 1000;
          continue;
        }
        item.at = Infinity;
        const brick = new Brick(this, item.spec);
        this.bricks.add(brick);
        this.grid.set(brick);
        brick.setAlpha(0).setScale(brick.scaleX * 0.4, brick.scaleY * 0.4);
        this.tweens.add({
          targets: brick,
          alpha: 1,
          scaleX: brick.scaleX / 0.4,
          scaleY: brick.scaleY / 0.4,
          duration: 300,
          ease: 'Back.easeOut'
        });
        this.particleSystem.sparkBurst(brick.x, brick.y, item.spec.color, 8);
        this.sfx('fire', { x: brick.x });
      }
      this.phoenixQueue.splice(
        0,
        this.phoenixQueue.length,
        ...this.phoenixQueue.filter((item) => item.at !== Infinity)
      );
    }
    // Moving bricks slide one cell at a time.
    this.moverClockMs += deltaMs;
    if (this.moverClockMs >= MOVER_STEP_MS) {
      this.moverClockMs = 0;
      const groups = groupCells(this.getBricks().filter((brick) => brick.kind === 'mover'));
      for (const group of groups) {
        const dir = group[0]?.moveDir ?? 1;
        const step = moveGroup(group, dir, this.grid.cols, (col, row) => !this.grid.get(col, row));
        if (!step) continue;
        group.forEach((mover) => this.grid.remove(mover));
        group.forEach((mover) => {
          const col = mover.col + step.dx;
          const x = PLAYFIELD_LEFT + mover.spec.width / 2 + col * (mover.spec.width + BRICK_GAP);
          const y = (mover.box.top + mover.box.bottom) / 2;
          mover.moveToCell(col, mover.row, x, y);
          mover.moveDir = step.dir;
          this.grid.set(mover);
          this.tweens.add({ targets: mover, x, duration: 220, ease: 'Sine.easeInOut' });
        });
      }
    }
  }

  private punch(brick: Brick): void {
    this.tweens.killTweensOf(brick);
    brick.setDisplaySize(brick.spec.width + 1, brick.spec.height + 1);
    const baseX = brick.scaleX;
    const baseY = brick.scaleY;
    brick.setScale(baseX * 0.86, baseY * 0.8);
    this.tweens.add({
      targets: brick,
      scaleX: baseX,
      scaleY: baseY,
      duration: 160,
      ease: 'Back.easeOut'
    });
  }

  private playBreakAnimation(brick: Brick): void {
    this.tweens.killTweensOf(brick);
    brick.setDisplaySize(brick.spec.width + 1, brick.spec.height + 1);
    brick.setAlpha(1);
    brick.flash(70);
    brick.setDepth(brick.depth + 1);
    this.tweens.add({
      targets: brick,
      scaleX: brick.scaleX * 1.35,
      scaleY: brick.scaleY * 1.35,
      alpha: 0,
      duration: 150,
      ease: 'Quad.easeOut',
      onComplete: () => brick.destroy()
    });
  }

  private explode(x: number, y: number, color: number, chainDepth: number): void {
    this.explosionsTriggered += 1;
    const intensity = Math.max(0.3, 1 - chainDepth * 0.25);
    this.sfx('explosion', { x, intensity });
    this.particleSystem.explosion(x, y, color);
    this.juice.ring(x, y, 0xffa040, 1.5 * intensity + 0.4, 380);
    this.juice.glow(x, y, 0xff8a30, 220, 220, 260, 0.9);
    this.juice.shake(0.28 * intensity);
    if (chainDepth === 0) {
      this.juice.freeze(55);
      haptic(25);
    }
    if (chainDepth < 3) {
      this.explosions.push({
        x,
        y,
        depth: chainDepth + 1,
        at: this.gameTime + EXPLOSION_STAGGER_MS,
        color
      });
    }
  }

  /** Explosion chains resolve in waves, so the player sees the fire spread. */
  private processExplosions(): void {
    if (this.explosions.length === 0) return;
    const due = this.explosions.filter((explosion) => explosion.at <= this.gameTime);
    if (due.length === 0) return;
    this.explosions.splice(
      0,
      this.explosions.length,
      ...this.explosions.filter((e) => e.at > this.gameTime)
    );
    for (const explosion of due) {
      const targets = this.grid
        .around(explosion.x, explosion.y, 3, 3)
        .filter((brick) => brick.active && brick.isBreakable)
        .filter((brick) => !this.grid.isBlocked(explosion.x, explosion.y, brick.x, brick.y));
      targets.forEach((brick) => this.damageBrick(brick, 2, explosion.depth));
      if (this.ending) break;
    }
  }

  private onLastBrick(x: number, y: number): void {
    this.sfx(
      this.isWaveMode() && !(this.mode === 'daily' && this.wave >= DAILY_WAVE_COUNT)
        ? 'waveClear'
        : 'lastBrick',
      { x }
    );
    this.juice.slowMotion(0.25, 700);
    this.juice.ring(x, y, 0xffffff, 2.6, 700);
    this.juice.glow(x, y, this.theme.primary, 520, 520, 600, 0.7);
    this.juice.shake(0.35);
    haptic(60);
    if (!this.reducedMotion) {
      this.cameras.main.flash(180, 255, 220, 160, false);
    }
  }

  // ------------------------------------------------------------------ power-ups

  private spawnPowerUp(
    x: number,
    y: number,
    dropChance: number,
    sourceBall?: Ball,
    forceBallBonus = false
  ): void {
    const type = forceBallBonus
      ? this.powerUpSystem.rollBallBonus()
      : this.powerUpSystem.roll(dropChance);
    if (!type) {
      return;
    }
    this.spawnSpecificPowerUp(x, y, type, sourceBall);
  }

  private spawnSpecificPowerUp(x: number, y: number, type: PowerUpType, sourceBall?: Ball): void {
    // AIM only makes sense with a few balls to catch.
    if (type === 'stickyPaddle' && this.ballManager.getStats().activeCount > 3) {
      return;
    }
    const falling = this.powerUps.reduce((count, item) => count + (item.active ? 1 : 0), 0);
    let powerUp = this.powerUps.find((item) => !item.active);
    if (falling >= MAX_FALLING_CAPSULES || (!powerUp && this.powerUps.length >= MAX_POWER_UPS)) {
      // Too many capsules on screen: the drop becomes points instead of clutter.
      const points = this.scoreSystem.addBonus(50 * this.effects.scoreMultiplier());
      this.juice.popup(x, y, `+${points}`, '#ffe3a0', 22);
      return;
    }
    if (!powerUp) {
      powerUp = new PowerUp(this);
      this.powerUps.push(powerUp);
    }
    powerUp.reset(x, y, type, sourceBall);
    const scaleX = powerUp.scaleX;
    const scaleY = powerUp.scaleY;
    powerUp.setScale(scaleX * 0.3, scaleY * 0.3);
    this.tweens.add({ targets: powerUp, scaleX, scaleY, duration: 220, ease: 'Back.easeOut' });
  }

  private updatePowerUps(dt: number): void {
    const active = this.powerUps.filter((item) => item.active);
    if (active.length === 0) return;
    const maxSpeed = POWER_UP_DROP_SPEED * 1.2;
    for (const item of active) {
      item.vy = Math.min(maxSpeed, item.vy + 520 * dt);
      item.y += item.vy * dt;
      item.swayPhase += dt * 3.2;
      item.x += Math.sin(item.swayPhase) * 18 * dt;
      item.setRotation(Math.sin(item.swayPhase) * 0.08);
    }
    if (this.effects.has('magnet')) {
      // The magnet pulls good capsules toward the paddle and leaves risky ones alone.
      const pull = Math.min(1, dt * 3);
      for (const item of active) {
        if (!getPowerUpDefinition(item.powerUpType).risk && item.y < this.paddle.top) {
          item.x += (this.paddle.x - item.x) * pull;
        }
      }
    }
    separateFallers(active, POWER_UP_HALF_WIDTH * 2 + 10, PLAYFIELD_LEFT, PLAYFIELD_RIGHT, 0.35);

    if (this.ending) return;
    const paddleLeft = this.paddle.x - this.paddle.activeWidth / 2 - POWER_UP_HALF_WIDTH;
    const paddleRight = this.paddle.x + this.paddle.activeWidth / 2 + POWER_UP_HALF_WIDTH;
    const catchTop = this.paddle.top - POWER_UP_HALF_HEIGHT;
    const catchBottom = this.paddle.top + PADDLE_HEIGHT + POWER_UP_HALF_HEIGHT;
    for (const item of active) {
      if (
        item.x >= paddleLeft &&
        item.x <= paddleRight &&
        item.y >= catchTop &&
        item.y <= catchBottom
      ) {
        this.collectPowerUp(item);
      } else if (item.y > PADDLE_Y + 160) {
        this.sfx('powerMiss', { x: item.x });
        item.disable();
      }
    }
  }

  private collectPowerUp(powerUp: PowerUp): void {
    const type = powerUp.powerUpType;
    const definition = getPowerUpDefinition(type);
    const sourceBall = powerUp.sourceBall;
    powerUp.disable();
    this.sfx(definition.risk ? 'risk' : 'powerUp', { x: powerUp.x });
    this.juice.ring(powerUp.x, this.paddle.top, definition.color, 1, 360);
    this.juice.glow(
      this.paddle.x,
      this.paddle.y,
      definition.color,
      this.paddle.activeWidth * 1.6,
      90,
      320,
      0.75
    );
    this.juice.popup(powerUp.x, this.paddle.top - 40, definition.icon, '#ffffff', 40, true);
    this.paddle.bump(0.5);
    this.pickups += 1;
    if (definition.risk) this.riskPickups += 1;
    if (this.mode !== 'demo' && !this.autopilot) {
      const first = this.saveSystem.discover(`power:${type}`);
      bridge.emit('notice', { kind: 'pickup', id: type, first });
    }
    this.applyPowerUp(type, sourceBall);
  }

  /** First encounter with a power-up or brick: the interface explains it once. */
  private discover(id: string): void {
    if (this.mode === 'demo' || this.autopilot) return;
    if (this.saveSystem.discover(id)) {
      bridge.emit('notice', { kind: 'discovery', id });
    }
  }

  /** Applies a power-up effect; public so diagnostics can trigger effects directly. */
  public applyPowerUp(type: PowerUpType, sourceBall?: Ball): void {
    switch (type) {
      case 'multiBall':
        this.splitBalls(sourceBall, [-0.34, 0.34]);
        return;
      case 'splitBall':
        this.splitBalls(sourceBall, [0.6]);
        return;
      case 'extraLife':
        if (this.lives < MAX_LIVES) {
          this.lives = Math.min(this.lives + 1, MAX_LIVES);
          this.emitHud();
        }
        return;
      default:
        break;
    }
    const result = this.effects.activate(type);
    if (result.cancelled) this.onEffectEnd(result.cancelled);
    this.onEffectStart(type);
    result.newCombos.forEach((combo) => this.announceCombo(combo));
    this.emitHud();
  }

  private onEffectStart(type: PowerUpType): void {
    switch (type) {
      case 'widePaddle':
      case 'shrinkPaddle':
      case 'laserPaddle':
        this.paddle.setWidthScale(this.effects.paddleScale());
        if (type === 'laserPaddle') this.laserCooldownMs = 0;
        break;
      case 'stickyPaddle':
        this.paddle.setTint(0xffe7a8);
        break;
      case 'shield':
        this.shieldBar.setVisible(true).setAlpha(0.35 + this.effects.shieldCharges * 0.2);
        this.sfx('shield', { x: 540 });
        break;
      case 'fever':
        this.juice.popup(540, 1200, '×2', '#ffe066', 64, true);
        break;
      default:
        break;
    }
  }

  private onEffectEnd(type: PowerUpType): void {
    switch (type) {
      case 'widePaddle':
      case 'shrinkPaddle':
      case 'laserPaddle':
        this.paddle.setWidthScale(this.effects.paddleScale());
        break;
      case 'stickyPaddle':
        this.paddle.clearTint();
        this.launchAttachedBalls();
        break;
      default:
        break;
    }
    this.emitHud();
  }

  private announceCombo(combo: ComboId): void {
    if (this.mode !== 'demo' && !this.autopilot) this.saveSystem.discover(`combo:${combo}`);
    this.sfx('powerCombo', { x: 540 });
    this.juice.popup(540, 980, COMBO_NAMES[combo][this.language], '#ffb423', 64, true);
    this.juice.shake(0.2);
    if (this.mode !== 'demo') {
      bridge.emit('notice', { kind: 'combo', id: combo });
    }
  }

  /** Shield: a ball falling past the barrier bounces back once per charge. */
  private applyShield(): void {
    if (this.effects.shieldCharges <= 0) return;
    for (const ball of this.ballManager.getActiveBalls()) {
      if (ball.isAttached || ball.vy <= 0 || ball.y < SHIELD_Y - ball.radius) continue;
      if (!this.effects.useShield()) break;
      ball.y = SHIELD_Y - ball.radius - 1;
      ball.vy = -Math.abs(ball.vy);
      this.sfx('shield', { x: ball.x });
      this.juice.ring(ball.x, SHIELD_Y, 0x7fe8ff, 1.2, 320);
      this.particleSystem.sparkBurst(ball.x, SHIELD_Y, 0x7fe8ff, 10);
    }
    if (this.effects.shieldCharges <= 0) {
      this.shieldBar.setVisible(false);
    } else {
      this.shieldBar.setAlpha(0.35 + this.effects.shieldCharges * 0.2);
    }
  }

  private updateLasers(deltaMs: number): void {
    if (this.effects.has('laserPaddle') && !this.ending) {
      this.laserCooldownMs -= deltaMs;
      if (this.laserCooldownMs <= 0) {
        this.laserCooldownMs = LASER_INTERVAL_MS;
        const half = this.paddle.activeWidth / 2 - 14;
        this.lasers.fire(this.paddle.x - half, this.paddle.top - 6);
        this.lasers.fire(this.paddle.x + half, this.paddle.top - 6);
        this.sfx('laser', { x: this.paddle.x });
      }
    }
    this.lasers.update(
      deltaMs / 1000,
      this.grid,
      (brick) => brick.active,
      (brick, x, y) => {
        if (!brick.isBreakable) {
          this.particleSystem.sparkBurst(x, y, 0xd8d2c4, 3);
          return;
        }
        this.particleSystem.sparkBurst(x, y, 0xff4d8d, 4);
        const { x: bx, y: by } = brick;
        this.damageBrick(brick, 1, 0, undefined, x, y);
        if (this.effects.explosiveCharges > 0 && this.effects.useExplosiveCharge()) {
          this.explode(bx, by, EXPLOSIVE_TINT, 1);
        }
      }
    );
  }

  private splitBalls(sourceBall: Ball | undefined, offsets: number[]): void {
    const source = this.ballManager.getPowerUpSourceBall(sourceBall);
    if (!source) return;
    const created = this.ballManager.duplicateBallsOrQueue(source, offsets);
    if (created.length > 0) {
      this.sfx('ballSplit', { x: source.x });
      this.particleSystem.sparkBurst(source.x, source.y, 0xffe3a0, 8);
    }
  }

  // ------------------------------------------------------------------ visuals & input

  private updateBallVisuals(deltaMs: number): void {
    let trails = 0;
    const sizeScale = this.effects.has('bigBall') ? BIG_BALL_SCALE : 1;
    const tint = this.effects.has('fireBall')
      ? FIRE_TINT
      : this.effects.explosiveCharges > 0
        ? EXPLOSIVE_TINT
        : null;
    for (const ball of this.ballManager.getActiveBalls()) {
      ball.setSizeScale(sizeScale);
      ball.setEffectTint(tint);
      ball.updateLook(deltaMs);
      if (!ball.isAttached && !this.reducedMotion && trails < TRAIL_BALL_LIMIT) {
        this.particleSystem.trailAt(ball.x, ball.y);
        trails += 1;
      }
    }
  }

  private updateAim(): void {
    this.aimGraphics.clear();
    const attached = this.getBalls().find((ball) => ball.isAttached);
    if (!attached || this.mode === 'demo' || this.ending) {
      this.aimArrow.setVisible(false);
      this.ballManager.aim = null;
      if (!attached && this.aiming) {
        this.aiming = false;
        this.inputSystem.frozen = false;
      }
      return;
    }

    const pointerX = this.inputSystem.pointerX;
    const pointerY = this.inputSystem.pointerY;
    const angle =
      pointerX === null || pointerY === null
        ? 0
        : aimAngleToward(attached.x, attached.y, pointerX, pointerY);
    this.ballManager.aim = angle;

    // Dotted guide with the predicted bounce off the side walls; bright while the press is held.
    this.aimPulse += 0.06;
    const strength = this.aiming ? 1 : 0.35;
    const length = this.aiming ? 560 : 220;
    const path = aimPath(
      attached.x,
      attached.y,
      angle,
      length,
      PLAYFIELD_LEFT + attached.radius,
      PLAYFIELD_RIGHT - attached.radius
    );
    const dotSpacing = 26;
    let travelled = (this.aimPulse * 18) % dotSpacing;
    for (let index = 1; index < path.length; index += 1) {
      const from = path[index - 1];
      const to = path[index];
      if (!from || !to) continue;
      const segment = Math.hypot(to.x - from.x, to.y - from.y);
      for (let d = travelled; d < segment; d += dotSpacing) {
        const t = d / segment;
        const fade = 1 - (d + (index - 1) * 400) / (length + 80);
        this.aimGraphics.fillStyle(this.theme.primary, Math.max(0.12, fade) * strength);
        this.aimGraphics.fillCircle(
          from.x + (to.x - from.x) * t,
          from.y + (to.y - from.y) * t,
          this.aiming ? 5 : 3.5
        );
      }
      travelled = (travelled - segment) % dotSpacing;
      if (travelled < 0) travelled += dotSpacing;
    }
    // Arrow head just above the ball.
    const headDistance = 46;
    this.aimArrow
      .setVisible(true)
      .setPosition(
        attached.x + Math.sin(angle) * headDistance,
        attached.y - Math.cos(angle) * headDistance
      )
      .setRotation(angle - Math.PI / 2)
      .setDisplaySize(this.aiming ? 46 : 32, this.aiming ? 12 : 8)
      .setTint(this.theme.primary)
      .setAlpha(strength);
  }

  /** Attract-mode autopilot used behind the home screen and for media capture. */
  private updateDemoPilot(time: number, delta: number): void {
    const balls = this.getBalls();
    if (balls.some((ball) => ball.isAttached)) {
      this.demoLaunchMs += delta;
      if (this.demoLaunchMs > 650) {
        this.demoLaunchMs = 0;
        this.ballManager.launchAttachedBalls();
      }
    }
    const target = balls
      .filter((ball) => !ball.isAttached && ball.vy > 0)
      .sort((a, b) => b.y - a.y)[0];
    const aimX = target
      ? target.x + Math.sin(time / 900) * this.paddle.activeWidth * 0.3
      : this.paddle.x;
    const blend = 1 - Math.pow(1 - 0.2, delta / (1000 / 60));
    this.paddle.setCenterX(this.paddle.x + (aimX - this.paddle.x) * blend);
  }

  private sfx(name: SfxName, options?: SfxOptions): void {
    if (this.mode !== 'demo') {
      audio.play(name, options);
    }
  }

  // ------------------------------------------------------------------ lives, victory, results

  /** Loses a life; public so diagnostics can force a defeat. */
  public loseLife(): void {
    this.respawning = true;
    if (this.mode !== 'demo') {
      this.lives -= 1;
      this.livesLost += 1;
      // A lost life costs a tenth of the score: every ball counts.
      const removed = this.scoreSystem.addPenalty(lifePenalty(this.scoreSystem.snapshot().score));
      if (removed > 0) {
        this.juice.popup(this.paddle.x, this.paddle.top - 70, `-${removed}`, '#ff5a4a', 46, true);
      }
    }
    this.comboSystem.reset();
    this.sfx('lifeLost', { x: this.paddle.x });
    this.juice.shake(0.45);
    this.juice.glow(540, PADDLE_Y + 80, 0xff3b2b, 900, 260, 500, 0.8);
    haptic(120);
    if (!this.reducedMotion) {
      this.cameras.main.flash(140, 120, 20, 10, false);
    }
    this.emitHud();

    if (this.lives <= 0) {
      this.respawning = false;
      this.endGame();
      return;
    }

    this.time.delayedCall(600, () => {
      if (!this.scene.isActive()) return;
      if (!this.ending) {
        this.ballManager.createAttachedBall();
      }
      this.respawning = false;
    });
  }

  private isWaveMode(): boolean {
    return this.mode === 'endless' || this.mode === 'daily';
  }

  private getModeBestScore(): number {
    const save = this.saveSystem.snapshot();
    if (this.mode === 'endless') return save.records.endless.bestScore;
    if (this.mode === 'daily')
      return save.records.daily[this.session.dateKey ?? '']?.bestScore ?? 0;
    return save.bestScore;
  }

  private checkVictory(): void {
    if (this.ending || this.getBricks().some((brick) => brick.isRequired)) {
      return;
    }
    this.ending = true;
    this.ballManager.getActiveBalls().forEach((ball) => {
      this.tweens.add({ targets: ball, alpha: 0, duration: 400, delay: 300 });
    });

    if (this.mode === 'demo') {
      this.time.delayedCall(1400, () => {
        if (this.scene.isActive()) {
          this.scene.restart({
            mode: 'demo',
            levelIndex: (this.levelIndex + 1) % this.levelSystem.count
          });
        }
      });
      return;
    }

    if (this.isWaveMode()) {
      this.completeWave();
      return;
    }

    const previousBest = this.saveSystem.snapshot().bestScore;
    const objectiveMet = this.isObjectiveMet();
    this.scoreSystem.addEndBonuses(
      finishBonuses({
        livesLeft: this.lives,
        livesLost: this.livesLost,
        objectiveMet,
        elapsedMs: this.gameTime,
        parMs: parTimeMs(this.bricksTotal),
        multiplier: this.level.difficulty.scoreMultiplier
      })
    );
    const score = this.scoreSystem.snapshot().score;
    const recordsProgress = !this.editorReturn && this.levelSource === 'campaign';
    const scoreTarget = this.level.medalTargets.goldScore ?? 0;
    const met = challengesMet({ objectiveMet, score, scoreTarget, livesLost: this.livesLost });
    const medal = medalFor(met);
    let fresh: typeof met = [];

    if (recordsProgress) {
      this.saveSystem.updateBestScore(score);
      fresh = this.saveSystem.recordLevelResult(this.levelIndex, medal, met);
    }
    this.recordRunStats();
    const trophies = this.checkTrophies(true);
    this.time.delayedCall(450, () => this.sfx('levelClear'));
    this.emitHud();

    this.finishWithResult({
      outcome: 'victory',
      score,
      medal: recordsProgress ? medal : undefined,
      isNewBest: recordsProgress && score > previousBest,
      hasNext: recordsProgress && this.levelSystem.hasNext(this.levelIndex),
      challenges: recordsProgress
        ? {
            met,
            collected: this.saveSystem.getLevelChallenges(this.levelIndex),
            fresh,
            scoreTarget
          }
        : undefined,
      trophies
    });
  }

  private isObjectiveMet(): boolean {
    const combo = this.comboSystem.snapshot();
    const progress = this.getObjectiveProgress(
      this.ballManager.getStats().maxBallsReached,
      combo.bestStreak
    );
    return progress.current >= progress.target;
  }

  private runStats(cleared: boolean): RunStats {
    return {
      mode: this.mode,
      cleared,
      maxCombo: this.comboSystem.snapshot().bestStreak,
      maxBalls: this.ballManager.getStats().maxBallsReached,
      explosions: this.explosionsTriggered,
      pickups: this.pickups
    };
  }

  private recordRunStats(): void {
    if (this.mode === 'demo' || this.autopilot) return;
    const stats = this.runStats(false);
    this.saveSystem.addStats({
      riskCaught: this.riskPickups,
      capsulesCaught: this.pickups,
      bricksBroken: this.scoreSystem.snapshot().bricksBroken,
      livesLost: this.livesLost,
      bestCombo: stats.maxCombo,
      bestBalls: stats.maxBalls
    });
    this.riskPickups = 0;
    this.pickups = 0;
  }

  /** Unlocks earned trophies; during play they are announced at once, at the end in the result. */
  private checkTrophies(final: boolean): string[] {
    if (this.mode === 'demo' || this.autopilot) return [];
    const save = this.saveSystem.snapshot();
    const run = this.runStats(final && this.breakableLeft === 0);
    const unlocked = this.saveSystem.unlockAchievements(
      newlyUnlocked(this.saveSystem.progressSnapshot(), save.achievements, run)
    );
    if (!final) {
      unlocked.forEach((id) => bridge.emit('notice', { kind: 'achievement', id }));
    }
    return unlocked;
  }

  private completeWave(): void {
    const score = this.scoreSystem.snapshot().score;
    const isFinalDailyWave = this.mode === 'daily' && this.wave >= DAILY_WAVE_COUNT;

    if (isFinalDailyWave) {
      this.scoreSystem.addLifeBonus(this.lives);
      this.time.delayedCall(450, () => this.sfx('levelClear'));
      this.finishRun('victory', this.wave);
      return;
    }

    const nextWave = this.wave + 1;
    this.recordRunStats();
    this.checkTrophies(false);
    bridge.emit('waveCleared', { wave: this.wave, score, nextWave });
    this.time.delayedCall(WAVE_TRANSITION_MS, () => {
      if (!this.scene.isActive()) return;
      // Restarting resets balls, power-ups and timed effects; score and lives carry over.
      this.scene.restart({ ...this.session, wave: nextWave, carry: { score, lives: this.lives } });
    });
  }

  private finishRun(outcome: 'victory' | 'defeat', wavesCleared: number): void {
    const score = this.scoreSystem.snapshot().score;
    let isNewBest = false;
    if (this.mode === 'endless') {
      isNewBest = this.saveSystem.recordEndlessRun(score, wavesCleared);
    } else if (this.mode === 'daily' && this.session.dateKey) {
      isNewBest = this.saveSystem.recordDailyRun(this.session.dateKey, score, wavesCleared);
    }
    this.recordRunStats();
    const trophies = this.checkTrophies(true);
    this.emitHud();
    this.finishWithResult({
      outcome,
      score,
      wave: this.wave,
      wavesCleared,
      dateKey: this.session.dateKey,
      isNewBest,
      hasNext: false,
      trophies
    });
  }

  private finishWithResult(
    result: Pick<GameResult, 'outcome' | 'score' | 'isNewBest' | 'hasNext'> &
      Partial<
        Pick<GameResult, 'medal' | 'wave' | 'wavesCleared' | 'dateKey' | 'challenges' | 'trophies'>
      >
  ): void {
    const payload: GameResult = {
      breakdown: this.scoreSystem.breakdown(),
      mode: this.mode,
      levelIndex: this.levelIndex,
      levelName: this.level.name,
      editorReturn: this.editorReturn,
      session: { ...this.session, carry: undefined, wave: this.isWaveMode() ? 1 : undefined },
      ...result
    };
    this.time.delayedCall(this.reducedMotion ? 150 : 900, () => {
      bridge.emit('result', payload);
    });
  }

  private endGame(): void {
    this.ending = true;
    if (this.isWaveMode()) {
      this.finishRun('defeat', this.wave - 1);
      return;
    }
    const score = this.scoreSystem.snapshot().score;
    const previousBest = this.saveSystem.snapshot().bestScore;
    const recordsProgress = !this.editorReturn && this.levelSource === 'campaign';
    if (recordsProgress) {
      this.saveSystem.updateBestScore(score);
    }
    this.recordRunStats();
    const trophies = this.checkTrophies(true);
    this.emitHud();
    this.finishWithResult({
      outcome: 'defeat',
      score,
      isNewBest: recordsProgress && score > previousBest,
      hasNext: false,
      trophies
    });
  }

  private pauseGame(): void {
    if (this.ending || this.mode === 'demo') return;
    bridge.emit('pauseRequested', undefined);
  }

  private restartLevel(): void {
    if (this.mode === 'demo' || this.ending) return;
    this.scene.restart({
      ...this.session,
      carry: undefined,
      wave: this.isWaveMode() ? 1 : undefined
    });
  }

  // ------------------------------------------------------------------ HUD

  private emitHud(): void {
    this.hudElapsedMs = 0;
    if (this.mode === 'demo') return;
    bridge.emit('hud', this.buildHudState());
  }

  private buildHudState(): HudSnapshot {
    const combo = this.comboSystem.snapshot();
    const ballStats = this.ballManager.getStats();
    const score = this.scoreSystem.snapshot();
    return {
      mode: this.mode,
      levelIndex: this.levelIndex,
      levelName: this.level.name,
      chapter: this.level.chapter,
      wave: this.isWaveMode() ? this.wave : undefined,
      waveCount: this.mode === 'daily' ? DAILY_WAVE_COUNT : undefined,
      score: score.score,
      bestScore: Math.max(score.bestScore, score.score),
      lives: Math.max(0, this.lives),
      maxLives: MAX_LIVES,
      combo: combo.streak,
      bestCombo: combo.bestStreak,
      balls: ballStats.activeCount,
      bricksLeft: this.breakableLeft,
      bricksTotal: this.bricksTotal,
      waitingToLaunch: this.getBalls().some((ball) => ball.isAttached),
      effects: this.hudEffects(),
      objective: this.getObjectiveProgress(ballStats.maxBallsReached, combo.bestStreak),
      challenges:
        this.mode === 'campaign'
          ? {
              objective: this.isObjectiveMet(),
              score: score.score,
              target: this.level.medalTargets.goldScore ?? 0,
              flawless: this.livesLost === 0
            }
          : undefined
    };
  }

  private hudEffects(): HudSnapshot['effects'] {
    const list: HudSnapshot['effects'] = this.effects.list();
    if (this.effects.shieldCharges > 0) {
      list.push({ type: 'shield', ratio: 1, count: this.effects.shieldCharges });
    }
    if (this.effects.explosiveCharges > 0) {
      list.push({ type: 'explosiveBall', ratio: 1, count: this.effects.explosiveCharges });
    }
    return list;
  }

  private getObjectiveProgress(maxBalls: number, bestCombo: number): HudSnapshot['objective'] {
    if (this.isWaveMode()) {
      return {
        kind: 'clearWave',
        current: this.bricksTotal - this.breakableLeft,
        target: this.bricksTotal
      };
    }
    const objective = this.level.objective;
    const kind: ObjectiveKind = objective.type;
    switch (objective.type) {
      case 'reachBalls':
        return { kind, current: Math.min(maxBalls, objective.target), target: objective.target };
      case 'triggerExplosions':
        return {
          kind,
          current: Math.min(this.explosionsTriggered, objective.target),
          target: objective.target
        };
      case 'clearWithLives':
        return { kind, current: this.lives, target: objective.target };
      case 'bestCombo':
      default:
        return { kind, current: Math.min(bestCombo, objective.target), target: objective.target };
    }
  }

  private buildDebugOverlaySnapshot(): DebugOverlaySnapshot {
    const ballStats = this.ballManager.getStats();
    const performance = this.fxManager.getPerformanceSnapshot();
    return {
      fps: performance.fps,
      averageDeltaMs: performance.averageDeltaMs,
      fxQuality: this.fxManager.getQuality(),
      fxDegraded: this.fxManager.isDegraded(),
      activeBalls: ballStats.activeCount,
      activeBallLimit: ballStats.activeLimit,
      pendingClones: ballStats.pendingClones,
      remainingBricks: this.breakableLeft,
      activePowerUps: this.powerUps.filter((item) => item.active).length,
      activeEffects: this.effects
        .list()
        .map((effect) => effect.type)
        .join('+'),
      levelIndex: this.levelIndex,
      levelName: this.level.name
    };
  }

  private getBalls(): Ball[] {
    return this.ballManager.getActiveBalls();
  }

  private getBricks(): Brick[] {
    return this.bricks
      .getChildren()
      .filter((child): child is Brick => child instanceof Brick && child.active);
  }
}
