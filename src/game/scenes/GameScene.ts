import Phaser from 'phaser';
import { getTheme, type ThemeDefinition } from '../config/themeConfig';
import type { Ball } from '../entities/Ball';
import { Brick } from '../entities/Brick';
import { Paddle } from '../entities/Paddle';
import { PowerUp } from '../entities/PowerUp';
import type { LevelDefinition } from '../levels/levelTypes';
import {
  bridge,
  type GameMode,
  type GameResult,
  type GameSession,
  type HudSnapshot,
  type ObjectiveKind
} from '../bridge';
import {
  createWaveLevel,
  DAILY_WAVE_COUNT,
  ENDLESS_STARTING_LIVES,
  getPowerUpSeed
} from '../modes/waveGenerator';
import { SeededRandom } from '../utils/random';
import { AudioSystem } from '../systems/AudioSystem';
import { registerAudioSystem, unregisterAudioSystem } from '../systems/audioRegistry';
import { CollisionSystem } from '../systems/CollisionSystem';
import { ComboSystem } from '../systems/ComboSystem';
import { InputSystem } from '../systems/InputSystem';
import { LevelSystem } from '../systems/LevelSystem';
import { ParticleSystem } from '../systems/ParticleSystem';
import { PowerUpSystem, type PowerUpType } from '../systems/PowerUpSystem';
import { getSharedSaveSystem, type SaveSystem } from '../systems/SaveSystem';
import type { LevelMedal } from '../systems/SaveSystem';
import { SettingsSystem } from '../systems/SettingsSystem';
import { FxManager } from '../systems/FxManager';
import { ScoreSystem } from '../systems/ScoreSystem';
import { BallManager } from '../managers/BallManager';
import { PlayfieldRenderer } from '../managers/PlayfieldRenderer';
import { DebugOverlay, isDebugOverlayEnabled, type DebugOverlaySnapshot } from '../ui/DebugOverlay';
import {
  BALL_MAX_PADDLE_ANGLE_DEGREES,
  BALL_AXIS_LOCK_MIN_SPEED,
  BALL_MIN_SPEED,
  BALL_RADIUS,
  BRICK_GAP,
  MAX_LIVES,
  PADDLE_HEIGHT,
  POWER_UP_DROP_SPEED,
  WORLD_HEIGHT
} from '../utils/constants';
import {
  avoidAxisLock,
  calculatePaddleBounceVelocity,
  clamp,
  rectangleDistance
} from '../utils/math';

/** Accepts a full session, or the legacy `{ levelIndex, source }` shape used by the editor. */
type GameSceneData = Partial<GameSession> & {
  source?: 'campaign' | 'creative';
};

const HUD_EMIT_INTERVAL_MS = 100;
const WAVE_TRANSITION_MS = 900;

interface BallPhysicsSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export class GameScene extends Phaser.Scene {
  public balls!: Phaser.Physics.Arcade.Group;

  private levelSystem!: LevelSystem;
  private level!: LevelDefinition;
  private theme!: ThemeDefinition;
  private paddle!: Paddle;
  private ballManager!: BallManager;
  private bricks!: Phaser.Physics.Arcade.Group;
  private powerUps!: Phaser.Physics.Arcade.Group;
  private inputSystem!: InputSystem;
  private collisionSystem!: CollisionSystem;
  private particleSystem!: ParticleSystem;
  private powerUpSystem!: PowerUpSystem;
  private scoreSystem!: ScoreSystem;
  private comboSystem!: ComboSystem;
  private saveSystem!: SaveSystem;
  private settingsSystem!: SettingsSystem;
  private fxManager!: FxManager;
  private audioSystem!: AudioSystem;
  private debugOverlay?: DebugOverlay;
  private lives = 3;
  private levelIndex = 0;
  private levelSource: 'campaign' | 'creative' = 'campaign';
  private editorReturn?: GameSession['editorReturn'];
  private session!: GameSession;
  private mode: GameMode = 'campaign';
  private wave = 1;
  private runSeed = 0;
  private bricksTotal = 0;
  private hudElapsedMs = HUD_EMIT_INTERVAL_MS;
  private demoLaunchMs = 0;
  private reducedMotion = false;
  private autopilot = false;
  private ending = false;
  private respawning = false;
  private explosionsTriggered = 0;
  private readonly activeTimers = new Map<PowerUpType, Phaser.Time.TimerEvent>();
  private readonly ballPhysicsSnapshots = new WeakMap<Ball, BallPhysicsSnapshot>();
  private readonly lastIndestructibleWallBounceTimes = new WeakMap<Ball, number>();

  public constructor() {
    super('GameScene');
  }

  public get activeBallLimit(): number {
    return this.ballManager.getActiveLimit();
  }

  public set activeBallLimit(limit: number) {
    this.ballManager.setActiveLimit(limit);
  }

  public get pendingBallBonusClones(): number {
    return this.ballManager.getPendingClones();
  }

  public set pendingBallBonusClones(count: number) {
    this.ballManager.setPendingClones(count);
  }

  public get ballExpansionBlocked(): boolean {
    return this.ballManager.getExpansionBlocked();
  }

  public set ballExpansionBlocked(blocked: boolean) {
    this.ballManager.setExpansionBlocked(blocked);
  }

  public get ballLimitStressFrames(): number {
    return this.ballManager.getStressFrames();
  }

  public set ballLimitStressFrames(frames: number) {
    this.ballManager.setStressFrames(frames);
  }

  public createBall(attached: boolean): Ball | null {
    return this.ballManager.createBall(attached);
  }

  public launchAttachedBalls(): void {
    this.ballManager.launchAttachedBalls();
  }

  public flushPendingBallBonusClones(): void {
    this.ballManager.flushPendingClones();
  }

  public updateAdaptiveBallLimit(deltaMs: number): void {
    this.ballManager.updateAdaptiveLimit(deltaMs);
  }

  public create(data: GameSceneData): void {
    const mainCamera = this.cameras.main;
    this.tweens.killTweensOf(mainCamera);
    mainCamera.resetFX();
    mainCamera.setAlpha(1);
    mainCamera.setZoom(1);
    mainCamera.setScroll(0, 0);

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
        : this.levelSystem.getLevel(this.levelIndex, this.levelSource);
    const preferences = this.saveSystem.snapshot().preferences;
    this.reducedMotion = preferences.reducedMotion;
    this.theme = getTheme(preferences.themeId);
    this.audioSystem = new AudioSystem(
      this.mode !== 'demo' && preferences.soundEnabled,
      this.settingsSystem.getVolumeSfx()
    );
    registerAudioSystem(this.audioSystem);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unregisterAudioSystem(this.audioSystem);
    });
    this.scoreSystem = new ScoreSystem(this.getModeBestScore(), this.session.carry?.score ?? 0);
    this.comboSystem = new ComboSystem();
    this.powerUpSystem = this.isWaveMode()
      ? new PowerUpSystem(new SeededRandom(getPowerUpSeed(this.runSeed, this.wave)))
      : new PowerUpSystem();
    this.collisionSystem = new CollisionSystem();
    this.particleSystem = new ParticleSystem(this);
    this.fxManager = new FxManager(
      this,
      this.particleSystem,
      this.reducedMotion ? 'low' : this.settingsSystem.getFxQuality()
    );
    this.lives =
      this.session.carry?.lives ??
      (this.isWaveMode() ? ENDLESS_STARTING_LIVES : this.level.difficulty.initialLives);
    this.hudElapsedMs = HUD_EMIT_INTERVAL_MS;
    this.demoLaunchMs = 0;
    this.autopilot = false;
    this.ending = false;
    this.respawning = false;
    this.explosionsTriggered = 0;
    this.debugOverlay = undefined;
    this.activeTimers.clear();

    new PlayfieldRenderer(this, this.theme).render();

    this.bricks = this.physics.add.group({ allowGravity: false, immovable: true });
    this.powerUps = this.physics.add.group({
      classType: PowerUp,
      maxSize: 32,
      allowGravity: false,
      runChildUpdate: false
    });

    this.paddle = new Paddle(this);
    this.fxManager.applyEntityFx(this.paddle, 'paddle', this.theme);
    this.ballManager = new BallManager(this, this.paddle, {
      ballSpeed: this.level.difficulty.ballSpeed,
      maxBallSpeed: this.level.difficulty.maxBallSpeed,
      applyBallFx: (ball) => this.applyBallFx(ball),
      onBallActivated: (ball) => this.rememberBallPhysics(ball),
      onAttachedBallCreated: (ball) =>
        this.fxManager.playHit(ball.x, ball.y, this.theme.primary, 8),
      onAttachedBallLaunched: (ball) =>
        this.fxManager.playHit(ball.x, ball.y, this.theme.secondary, 10)
    });
    this.balls = this.ballManager.group;
    this.inputSystem = new InputSystem(this);
    // Keys must keep working for the HTML interface (Tab, Space on buttons...).
    this.input.keyboard?.disableGlobalCapture();
    this.createBricks();
    this.bricksTotal = this.getBricks().filter((brick) => brick.isBreakable).length;
    this.ballManager.createAttachedBall();

    if (isDebugOverlayEnabled()) {
      this.debugOverlay = new DebugOverlay(this);
    }
    this.registerCollisions();
    this.registerSceneInput();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdownSystems, this);
    this.emitHud();
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
    this.audioSystem.setEnabled(this.mode !== 'demo' && enabled);
    this.audioSystem.setVolumeSfx(volume);
  }

  public override update(time: number, delta: number): void {
    if (this.ending) {
      return;
    }

    if (this.mode === 'demo' || this.autopilot) {
      this.updateDemoPilot(time, delta);
    } else {
      this.inputSystem.updatePaddle(this.paddle, delta);
    }
    if (this.ballManager.update(this.respawning)) {
      this.loseLife();
    }
    this.updatePowerUps();
    this.ballManager.updateAdaptiveLimit(delta);
    this.fxManager.tickPerformance(delta);
    this.ballManager.flushPendingClones();
    this.comboSystem.update(delta);

    this.hudElapsedMs += delta;
    if (this.hudElapsedMs >= HUD_EMIT_INTERVAL_MS) {
      this.emitHud();
    }
    this.debugOverlay?.update(delta, this.buildDebugOverlaySnapshot());
  }

  private normalizeSession(data: GameSceneData | undefined): GameSession {
    const mode: GameMode = data?.mode ?? (data?.source === 'creative' ? 'creative' : 'campaign');
    const session: GameSession = {
      mode,
      levelIndex: Math.max(0, Math.floor(data?.levelIndex ?? 0)),
      editorReturn: data?.editorReturn
    };
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

  private isWaveMode(): boolean {
    return this.mode === 'endless' || this.mode === 'daily';
  }

  private getModeBestScore(): number {
    const save = this.saveSystem.snapshot();
    if (this.mode === 'endless') {
      return save.records.endless.bestScore;
    }
    if (this.mode === 'daily') {
      return save.records.daily[this.session.dateKey ?? '']?.bestScore ?? 0;
    }
    return save.bestScore;
  }

  /** Attract-mode autopilot used behind the home screen. */
  private updateDemoPilot(time: number, delta: number): void {
    const balls = this.getBalls();
    if (balls.some((ball) => ball.isAttached)) {
      this.demoLaunchMs += delta;
      if (this.demoLaunchMs > 700) {
        this.demoLaunchMs = 0;
        this.launchAttachedBalls();
      }
    }

    const target = balls
      .filter((ball) => !ball.isAttached && ball.arcadeBody.velocity.y > 0)
      .sort((a, b) => b.y - a.y)[0];
    const aimX = target
      ? target.x + Math.sin(time / 900) * this.paddle.activeWidth * 0.3
      : this.paddle.x;
    const blend = 1 - Math.pow(1 - 0.18, delta / (1000 / 60));
    this.paddle.setCenterX(this.paddle.x + (aimX - this.paddle.x) * blend);
  }

  private emitHud(): void {
    this.hudElapsedMs = 0;
    if (this.mode === 'demo') {
      return;
    }
    bridge.emit('hud', this.buildHudState());
  }

  private createBricks(): void {
    this.level.bricks.forEach((spec) => {
      const brick = new Brick(this, spec);
      this.bricks.add(brick);
      this.applyBrickFx(brick);
    });

    this.mergeWallRuns();
  }

  private applyBrickFx(brick: Brick): void {
    const kind = brick.spec.kind;
    if (kind === 'bonus') {
      this.fxManager.applyEntityFx(brick, 'brick-bonus', this.theme);
    } else if (kind === 'explosive') {
      this.fxManager.applyEntityFx(brick, 'brick-explosive', this.theme);
    } else if (kind === 'shield') {
      this.fxManager.applyEntityFx(brick, 'brick-shield', this.theme);
    } else if (kind === 'indestructible') {
      this.fxManager.applyEntityFx(brick, 'brick-indestructible', this.theme);
    } else {
      this.fxManager.applyEntityFx(brick, 'brick-standard', this.theme);
    }
  }

  private mergeWallRuns(): void {
    const wallMap = new Map<string, Brick>();
    this.getBricks().forEach((brick) => {
      if (!brick.isBreakable) {
        wallMap.set(`${brick.spec.row}:${brick.spec.col}`, brick);
      }
    });

    const consumed = new Set<string>();
    const halfGap = BRICK_GAP / 2;
    const keyOf = (row: number, col: number): string => `${row}:${col}`;
    const hasWall = (row: number, col: number): boolean => wallMap.has(keyOf(row, col));
    const isAvailableWall = (row: number, col: number): boolean => {
      const key = keyOf(row, col);
      return wallMap.has(key) && !consumed.has(key);
    };
    const disableAllFaces = (brick: Brick): void => {
      const body = brick.arcadeBody;
      const cc = body.checkCollision;
      cc.up = false;
      cc.down = false;
      cc.left = false;
      cc.right = false;
      body.enable = false;
    };
    const getRunExtensions = (
      rowStart: number,
      rowEnd: number,
      colStart: number,
      colEnd: number
    ): { left: number; right: number; up: number; down: number } => {
      let extendLeft = false;
      let extendRight = false;
      let extendUp = false;
      let extendDown = false;

      for (let row = rowStart; row <= rowEnd; row += 1) {
        extendLeft ||= hasWall(row, colStart - 1);
        extendRight ||= hasWall(row, colEnd + 1);
      }

      for (let col = colStart; col <= colEnd; col += 1) {
        extendUp ||= hasWall(rowStart - 1, col);
        extendDown ||= hasWall(rowEnd + 1, col);
      }

      return {
        left: extendLeft ? halfGap : 0,
        right: extendRight ? halfGap : 0,
        up: extendUp ? halfGap : 0,
        down: extendDown ? halfGap : 0
      };
    };
    const setMergedBody = (
      brick: Brick,
      width: number,
      height: number,
      extensions: { left: number; right: number; up: number; down: number }
    ): void => {
      const body = brick.arcadeBody;
      body.setSize(
        width + extensions.left + extensions.right,
        height + extensions.up + extensions.down,
        false
      );
      body.setOffset(-extensions.left, -extensions.up);
      body.updateFromGameObject();
    };

    wallMap.forEach((brick) => {
      const { row, col } = brick.spec;
      const key = keyOf(row, col);
      if (consumed.has(key)) return;

      const hasUp = isAvailableWall(row - 1, col);
      const hasDown = isAvailableWall(row + 1, col);
      const hasLeft = isAvailableWall(row, col - 1);
      const hasRight = isAvailableWall(row, col + 1);

      if (!hasUp && hasDown) {
        let runEnd = row;
        while (isAvailableWall(runEnd + 1, col)) {
          runEnd += 1;
        }
        if (runEnd > row) {
          const last = wallMap.get(keyOf(runEnd, col))!;
          const newH = last.y - brick.y + brick.spec.height;
          setMergedBody(brick, brick.spec.width, newH, getRunExtensions(row, runEnd, col, col));
          consumed.add(key);
          for (let r = row + 1; r <= runEnd; r += 1) {
            const k = keyOf(r, col);
            disableAllFaces(wallMap.get(k)!);
            consumed.add(k);
          }
          return;
        }
      }

      if (!hasLeft && hasRight && !consumed.has(key)) {
        let runEnd = col;
        while (isAvailableWall(row, runEnd + 1)) {
          runEnd += 1;
        }
        if (runEnd > col) {
          const last = wallMap.get(keyOf(row, runEnd))!;
          const newW = last.x - brick.x + brick.spec.width;
          setMergedBody(brick, newW, brick.spec.height, getRunExtensions(row, row, col, runEnd));
          consumed.add(key);
          for (let c = col + 1; c <= runEnd; c += 1) {
            const k = keyOf(row, c);
            disableAllFaces(wallMap.get(k)!);
            consumed.add(k);
          }
        }
      }
    });
  }

  private applyBallFx(ball: Ball): void {
    this.fxManager.applyEntityFx(ball, 'ball', this.theme);
  }

  private registerCollisions(): void {
    this.collisionSystem.register(
      this,
      this.paddle,
      this.ballManager.group,
      this.bricks,
      this.powerUps,
      {
        onBallPaddle: (ball) => this.handleBallPaddle(ball),
        onBallBrick: (ball, brick) => this.handleBallBrick(ball, brick),
        onPowerUpPaddle: (powerUp) => this.handlePowerUpPaddle(powerUp)
      }
    );
  }

  private registerSceneInput(): void {
    this.input.on('pointerdown', this.unlockAndLaunch, this);
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
    this.collisionSystem.destroy();
    this.input.off('pointerdown', this.unlockAndLaunch, this);
    this.input.keyboard?.off('keydown-SPACE', this.unlockAndLaunch, this);
    this.input.keyboard?.off('keydown-ENTER', this.unlockAndLaunch, this);
    this.input.keyboard?.off('keydown-P', this.pauseGame, this);
    this.input.keyboard?.off('keydown-ESC', this.pauseGame, this);
    this.input.keyboard?.off('keydown-R', this.restartLevel, this);
  }

  private unlockAndLaunch(): void {
    if (this.mode === 'demo' || this.ending) {
      return;
    }
    this.audioSystem.unlock();
    this.launchAttachedBalls();
  }

  private updatePowerUps(): void {
    this.getPowerUps().forEach((powerUp) => {
      powerUp.syncLabel();

      if (powerUp.y > WORLD_HEIGHT + 90) {
        powerUp.disable();
      }
    });
  }

  private handleBallPaddle(ball: Ball): void {
    if (ball.isAttached || ball.y > this.paddle.y + PADDLE_HEIGHT) {
      return;
    }

    const body = ball.arcadeBody;

    if (this.activeTimers.has('stickyPaddle')) {
      ball.attachToPaddle(this.paddle);
      this.rememberBallPhysics(ball);
      this.fxManager.playHit(ball.x, ball.y, this.theme.primary, 8);
      this.audioSystem.hit();
      return;
    }

    const speed = clamp(
      body.velocity.length() + 8,
      BALL_MIN_SPEED,
      this.level.difficulty.maxBallSpeed
    );
    const nextVelocity = avoidAxisLock(
      calculatePaddleBounceVelocity({
        ballX: ball.x,
        paddleX: this.paddle.x,
        paddleWidth: this.paddle.activeWidth,
        speed,
        maxAngleDegrees: BALL_MAX_PADDLE_ANGLE_DEGREES
      }),
      BALL_AXIS_LOCK_MIN_SPEED
    );

    ball.y = this.paddle.y - PADDLE_HEIGHT / 2 - BALL_RADIUS - 6;
    ball.arcadeBody.updateFromGameObject();
    ball.setVelocity(nextVelocity);
    this.audioSystem.hit();
  }

  private handleBallBrick(ball: Ball, brick: Brick): void {
    this.audioSystem.hit();
    if (this.resolveIndestructibleWallBounce(ball, brick)) {
      return;
    }

    this.damageBrick(brick, 1, 0, ball);
  }

  private rememberBallPhysics(ball: Ball): void {
    const body = ball.arcadeBody;
    this.ballPhysicsSnapshots.set(ball, {
      x: ball.x,
      y: ball.y,
      vx: body.velocity.x,
      vy: body.velocity.y
    });
  }

  private resolveIndestructibleWallBounce(ball: Ball, brick: Brick): boolean {
    if (brick.isBreakable) {
      return false;
    }

    const body = ball.arcadeBody;
    const wallBody = brick.arcadeBody;
    const now = this.time.now;
    const lastWallBounceAt = this.lastIndestructibleWallBounceTimes.get(ball);

    if (lastWallBounceAt !== undefined && now - lastWallBounceAt <= 1) {
      return true;
    }

    const previous = this.ballPhysicsSnapshots.get(ball);
    const incomingVx = this.resolveIncomingComponent(previous?.vx, body.velocity.x);
    const incomingVy = this.resolveIncomingComponent(previous?.vy, body.velocity.y);
    const wallLeft = wallBody.x;
    const wallRight = wallBody.x + wallBody.width;
    const wallTop = wallBody.y;
    const wallBottom = wallBody.y + wallBody.height;
    const wallCenterX = (wallLeft + wallRight) / 2;
    const wallCenterY = (wallTop + wallBottom) / 2;
    const horizontalOverlap =
      ball.x < wallCenterX ? ball.x + BALL_RADIUS - wallLeft : wallRight - (ball.x - BALL_RADIUS);
    const verticalOverlap =
      ball.y < wallCenterY ? ball.y + BALL_RADIUS - wallTop : wallBottom - (ball.y - BALL_RADIUS);
    let axis: 'x' | 'y';

    if (previous && previous.x + BALL_RADIUS <= wallLeft + 1 && incomingVx > 0) {
      axis = 'x';
    } else if (previous && previous.x - BALL_RADIUS >= wallRight - 1 && incomingVx < 0) {
      axis = 'x';
    } else if (previous && previous.y + BALL_RADIUS <= wallTop + 1 && incomingVy > 0) {
      axis = 'y';
    } else if (previous && previous.y - BALL_RADIUS >= wallBottom - 1 && incomingVy < 0) {
      axis = 'y';
    } else {
      axis = horizontalOverlap <= verticalOverlap ? 'x' : 'y';
    }

    let nextVx = incomingVx;
    let nextVy = incomingVy;

    if (axis === 'x') {
      const speedX = this.recoverBounceComponent(incomingVx, incomingVy, body.velocity.length());
      if (ball.x < wallCenterX) {
        ball.x = wallLeft - BALL_RADIUS - 0.5;
        nextVx = -speedX;
      } else {
        ball.x = wallRight + BALL_RADIUS + 0.5;
        nextVx = speedX;
      }
    } else {
      const speedY = this.recoverBounceComponent(incomingVy, incomingVx, body.velocity.length());
      if (ball.y < wallCenterY) {
        ball.y = wallTop - BALL_RADIUS - 0.5;
        nextVy = -speedY;
      } else {
        ball.y = wallBottom + BALL_RADIUS + 0.5;
        nextVy = speedY;
      }
    }

    const finalVelocity = avoidAxisLock({ x: nextVx, y: nextVy }, BALL_AXIS_LOCK_MIN_SPEED);
    body.reset(ball.x, ball.y);
    body.setVelocity(finalVelocity.x, finalVelocity.y);
    this.lastIndestructibleWallBounceTimes.set(ball, now);
    this.rememberBallPhysics(ball);
    return true;
  }

  private recoverBounceComponent(
    axisVelocity: number,
    otherVelocity: number,
    currentSpeed: number
  ): number {
    const currentAxisSpeed = Math.abs(axisVelocity);
    if (currentAxisSpeed >= BALL_AXIS_LOCK_MIN_SPEED) {
      return currentAxisSpeed;
    }

    const targetSpeed = Math.max(
      BALL_MIN_SPEED,
      currentSpeed,
      Math.hypot(axisVelocity, otherVelocity)
    );
    const recovered = Math.sqrt(
      Math.max(BALL_AXIS_LOCK_MIN_SPEED ** 2, targetSpeed ** 2 - otherVelocity ** 2)
    );
    return Math.max(BALL_AXIS_LOCK_MIN_SPEED, recovered);
  }

  private resolveIncomingComponent(
    previousVelocity: number | undefined,
    currentVelocity: number
  ): number {
    if (previousVelocity === undefined) {
      return currentVelocity;
    }

    return Math.abs(currentVelocity) > Math.abs(previousVelocity)
      ? currentVelocity
      : previousVelocity;
  }

  private handlePowerUpPaddle(powerUp: PowerUp): void {
    const type = powerUp.powerUpType;
    const sourceBall = powerUp.sourceBall;
    powerUp.disable();
    this.audioSystem.power();
    this.applyPowerUp(type, sourceBall);
  }

  private damageBrick(brick: Brick, amount: number, chainDepth: number, sourceBall?: Ball): void {
    if (!brick.active) {
      return;
    }

    if (!brick.isBreakable) {
      this.fxManager.playHit(brick.x, brick.y, brick.spec.color, 4);
      return;
    }

    const destroyed = brick.damage(amount);

    if (!destroyed) {
      this.fxManager.playHit(brick.x, brick.y, brick.spec.color, 5);
      this.tweens.add({
        targets: brick,
        scaleX: 0.94,
        scaleY: 0.9,
        duration: 55,
        yoyo: true
      });
      return;
    }

    const { x, y } = brick;
    const { color, kind, powerUpChance, score } = brick.spec;
    this.bricks.remove(brick, true, true);
    this.audioSystem.break();

    if (kind === 'explosive') {
      this.explosionsTriggered += 1;
      this.fxManager.playExplosion(x, y, color, 28);
      this.damageNearbyBricks(x, y, chainDepth + 1);
    } else {
      this.fxManager.playBreak(x, y, color, 16);
    }

    const combo = this.comboSystem.registerBreak();
    this.scoreSystem.registerBrickBreak(
      score,
      combo.multiplier,
      this.level.difficulty.scoreMultiplier
    );
    this.spawnPowerUp(x, y, powerUpChance, sourceBall, kind === 'bonus');
    this.checkVictory();
  }

  private damageNearbyBricks(x: number, y: number, chainDepth: number): void {
    if (chainDepth > 2) {
      return;
    }

    const walls = this.getBricks().filter((brick) => !brick.isBreakable);

    this.getBricks()
      .filter((brick) => brick.isBreakable && rectangleDistance(x, y, brick.x, brick.y, 78))
      .filter((brick) => !this.isExplosionBlocked(x, y, brick, walls))
      .forEach((brick) => {
        this.damageBrick(brick, 2, chainDepth, undefined);
      });
  }

  private isExplosionBlocked(fromX: number, fromY: number, target: Brick, walls: Brick[]): boolean {
    if (walls.length === 0) {
      return false;
    }

    const line = new Phaser.Geom.Line(fromX, fromY, target.x, target.y);

    return walls.some((wall) => {
      const rect = new Phaser.Geom.Rectangle(
        wall.x - wall.spec.width / 2,
        wall.y - wall.spec.height / 2,
        wall.spec.width,
        wall.spec.height
      );
      return Phaser.Geom.Intersects.LineToRectangle(line, rect);
    });
  }

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

    const powerUp = this.powerUps.get(x, y) as PowerUp | null;
    if (!powerUp) {
      return;
    }

    powerUp.reset(x, y, type, sourceBall);
    powerUp.arcadeBody.setVelocity(0, POWER_UP_DROP_SPEED);
    powerUp.setScale(0.4);
    this.tweens.add({
      targets: powerUp,
      scaleX: 1,
      scaleY: 1,
      duration: 180,
      ease: 'Back.easeOut'
    });
  }

  private applyPowerUp(type: PowerUpType, sourceBall?: Ball): void {
    switch (type) {
      case 'multiBall':
        this.applyMultiBall(sourceBall);
        break;
      case 'splitBall':
        this.applySplitBall(sourceBall);
        break;
      case 'widePaddle':
        this.setTimedEffect(
          type,
          11000,
          () => this.refreshPaddleWidth(),
          () => this.refreshPaddleWidth()
        );
        break;
      case 'stickyPaddle':
        this.setTimedEffect(
          type,
          9000,
          () => this.fxManager.playBreak(this.paddle.x, this.paddle.y - 26, this.theme.primary, 14),
          () => undefined
        );
        break;
      case 'extraLife':
        this.applyExtraLife();
        break;
    }
  }

  private refreshPaddleWidth(): void {
    const widthScale = this.activeTimers.has('widePaddle') ? 1.38 : 1;
    this.paddle.setWidthScale(widthScale);
  }

  private applyExtraLife(): void {
    if (this.lives >= MAX_LIVES) {
      return;
    }

    this.lives = Math.min(this.lives + 1, MAX_LIVES);
    this.fxManager.playBreak(this.paddle.x, this.paddle.y - 24, this.theme.danger, 14);
    this.emitHud();
  }

  private applyMultiBall(sourceBall?: Ball): void {
    const source = this.ballManager.getPowerUpSourceBall(sourceBall);

    if (source) {
      this.ballManager.duplicateBallsOrQueue(source, [-0.34, 0.34]);
    }

    this.cameraImpact(0.003, 100);
  }

  private applySplitBall(sourceBall?: Ball): void {
    const source = this.ballManager.getPowerUpSourceBall(sourceBall);

    if (source) {
      this.ballManager.duplicateBallsOrQueue(source, [0.7]);
    }

    this.cameraImpact(0.002, 80);
  }

  private cameraImpact(intensity: number, durationMs: number): void {
    if (!this.reducedMotion) {
      this.fxManager.cameraImpact(intensity, durationMs);
    }
  }

  private cameraFlash(color: number, durationMs: number): void {
    if (!this.reducedMotion) {
      this.fxManager.cameraFlash(color, durationMs);
    }
  }

  private setTimedEffect(
    type: PowerUpType,
    durationMs: number,
    onStart: () => void,
    onEnd: () => void
  ): void {
    this.activeTimers.get(type)?.remove(false);
    const timer = this.time.delayedCall(durationMs, () => {
      this.activeTimers.delete(type);
      onEnd();
    });
    this.activeTimers.set(type, timer);
    onStart();
  }

  private loseLife(): void {
    this.respawning = true;
    if (this.mode !== 'demo') {
      this.lives -= 1;
    }
    this.comboSystem.reset();
    this.audioSystem.danger();
    this.cameraImpact(0.005, 140);
    this.cameraFlash(this.theme.danger, 100);
    this.emitHud();

    if (this.lives <= 0) {
      this.respawning = false;
      this.endGame();
      return;
    }

    this.time.delayedCall(420, () => {
      if (!this.scene.isActive()) {
        return;
      }

      if (!this.ending) {
        this.ballManager.createAttachedBall();
      }
      this.respawning = false;
    });
  }

  private checkVictory(): void {
    if (this.getBricks().some((brick) => brick.isBreakable)) {
      return;
    }

    this.ending = true;

    if (this.mode === 'demo') {
      this.time.delayedCall(1200, () => {
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

    const stateBeforeBonus = this.scoreSystem.snapshot();
    const previousBest = this.saveSystem.snapshot().bestScore;
    this.scoreSystem.addLifeBonus(this.lives);
    const score = this.scoreSystem.snapshot().score;
    const medal = this.calculateLevelMedal(score);
    const recordsProgress = !this.editorReturn && this.levelSource === 'campaign';

    if (recordsProgress) {
      this.saveSystem.updateBestScore(score);
      this.saveSystem.completeLevel(this.levelIndex, medal);
    }

    this.cameraImpact(0.005, 200);
    this.cameraFlash(this.theme.primary, 140);
    this.emitHud();

    this.finishWithResult({
      outcome: 'victory',
      score: Math.max(score, stateBeforeBonus.score),
      medal,
      isNewBest: recordsProgress && score > previousBest,
      hasNext: recordsProgress && this.levelSystem.hasNext(this.levelIndex)
    });
  }

  private completeWave(): void {
    const score = this.scoreSystem.snapshot().score;
    const isFinalDailyWave = this.mode === 'daily' && this.wave >= DAILY_WAVE_COUNT;

    this.cameraImpact(0.004, 160);
    this.cameraFlash(this.theme.primary, 120);

    if (isFinalDailyWave) {
      this.scoreSystem.addLifeBonus(this.lives);
      this.finishRun('victory', this.wave);
      return;
    }

    const nextWave = this.wave + 1;
    bridge.emit('waveCleared', { wave: this.wave, score, nextWave });
    this.time.delayedCall(WAVE_TRANSITION_MS, () => {
      if (!this.scene.isActive()) {
        return;
      }
      // Restarting resets balls, power-ups and timed effects; score and lives carry over.
      this.scene.restart({
        ...this.session,
        wave: nextWave,
        carry: { score, lives: this.lives }
      });
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

    this.emitHud();
    this.finishWithResult({
      outcome,
      score,
      wave: this.wave,
      wavesCleared,
      dateKey: this.session.dateKey,
      isNewBest,
      hasNext: false
    });
  }

  private finishWithResult(
    result: Pick<GameResult, 'outcome' | 'score' | 'isNewBest' | 'hasNext'> &
      Partial<Pick<GameResult, 'medal' | 'wave' | 'wavesCleared' | 'dateKey'>>
  ): void {
    const payload: GameResult = {
      mode: this.mode,
      levelIndex: this.levelIndex,
      levelName: this.level.name,
      editorReturn: this.editorReturn,
      session: {
        ...this.session,
        carry: undefined,
        wave: this.isWaveMode() ? 1 : undefined
      },
      ...result
    };

    this.time.delayedCall(this.reducedMotion ? 120 : 520, () => {
      bridge.emit('result', payload);
    });
  }

  private calculateLevelMedal(score: number): LevelMedal {
    const combo = this.comboSystem.snapshot();
    const { medalTargets } = this.level;
    const hitGoldScore = medalTargets.goldScore !== undefined && score >= medalTargets.goldScore;
    const hitGoldCombo =
      medalTargets.goldBestCombo !== undefined && combo.bestStreak >= medalTargets.goldBestCombo;

    if (hitGoldScore || hitGoldCombo) {
      return 'gold';
    }

    if (this.lives >= medalTargets.silverLives) {
      return 'silver';
    }

    return 'bronze';
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

    this.emitHud();
    this.finishWithResult({
      outcome: 'defeat',
      score,
      isNewBest: recordsProgress && score > previousBest,
      hasNext: false
    });
  }

  private pauseGame(): void {
    if (this.ending || this.mode === 'demo') {
      return;
    }

    bridge.emit('pauseRequested', undefined);
  }

  private restartLevel(): void {
    if (this.mode === 'demo' || this.ending) {
      return;
    }

    // Wave modes restart the whole run, never a single wave with carried score.
    this.scene.restart({
      ...this.session,
      carry: undefined,
      wave: this.isWaveMode() ? 1 : undefined
    });
  }

  private buildHudState(): HudSnapshot {
    const combo = this.comboSystem.snapshot();
    const ballStats = this.ballManager.getStats();
    const score = this.scoreSystem.snapshot();
    const bricksLeft = this.getBricks().filter((brick) => brick.isBreakable).length;
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
      bricksLeft,
      bricksTotal: this.bricksTotal,
      waitingToLaunch: this.getBalls().some((ball) => ball.isAttached),
      effects: [...this.activeTimers.keys()],
      objective: this.getObjectiveProgress(bricksLeft, ballStats.maxBallsReached, combo.bestStreak)
    };
  }

  private getObjectiveProgress(
    bricksLeft: number,
    maxBalls: number,
    bestCombo: number
  ): HudSnapshot['objective'] {
    if (this.isWaveMode()) {
      return {
        kind: 'clearWave',
        current: this.bricksTotal - bricksLeft,
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
      remainingBricks: this.getBricks().filter((brick) => brick.isBreakable).length,
      activePowerUps: this.getPowerUps().length,
      activeEffects: this.getActiveEffectLabel(),
      levelIndex: this.levelIndex,
      levelName: this.level.name
    };
  }

  private getActiveEffectLabel(): string {
    return [...this.activeTimers.keys()].join('+');
  }

  private getBalls(): Ball[] {
    return this.ballManager.getActiveBalls();
  }

  private getBricks(): Brick[] {
    return this.bricks
      .getChildren()
      .filter((child): child is Brick => child instanceof Brick && child.active);
  }

  private getPowerUps(): PowerUp[] {
    return this.powerUps
      .getChildren()
      .filter((child): child is PowerUp => child instanceof PowerUp && child.active);
  }
}
