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
import { getTheme, type ThemeDefinition } from '../config/themeConfig';
import type { Ball } from '../entities/Ball';
import { Brick } from '../entities/Brick';
import { Paddle } from '../entities/Paddle';
import { POWER_UP_HALF_HEIGHT, POWER_UP_HALF_WIDTH, PowerUp } from '../entities/PowerUp';
import { createPatternFromEditorRows } from '../levels/editorGrid';
import { createLevelFromPattern } from '../levels/levelFactory';
import type { LevelDefinition } from '../levels/levelTypes';
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
import { getPowerUpDefinition, PowerUpSystem, type PowerUpType } from '../systems/PowerUpSystem';
import { getSharedSaveSystem, type LevelMedal, type SaveSystem } from '../systems/SaveSystem';
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
const MAX_POWER_UPS = 40;
const MAX_FRAME_MS = 50;
const TRAIL_BALL_LIMIT = 10;

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
  private readonly activeTimers = new Map<PowerUpType, Phaser.Time.TimerEvent>();

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
    this.theme = getTheme(preferences.themeId);
    audio.setEnabled(preferences.soundEnabled);
    audio.setVolume(preferences.volumeSfx);

    const quality = this.reducedMotion ? 'low' : this.settingsSystem.getFxQuality();
    this.scoreSystem = new ScoreSystem(this.getModeBestScore(), this.session.carry?.score ?? 0);
    this.comboSystem = new ComboSystem();
    this.powerUpSystem = this.isWaveMode()
      ? new PowerUpSystem(new SeededRandom(getPowerUpSeed(this.runSeed, this.wave)))
      : new PowerUpSystem();
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
    this.gameTime = 0;
    this.explosions.length = 0;
    this.powerUps.length = 0;
    this.debugOverlay = undefined;
    this.activeTimers.clear();

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
      isActive: (brick) => brick.active
    };

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
    }
    if (this.ballManager.update(this.respawning)) {
      this.loseLife();
    }
    this.processExplosions();
    this.updatePowerUps(physicsMs / 1000);
    this.updateBallVisuals(frameMs);

    this.ballManager.updateAdaptiveLimit(delta);
    this.fxManager.tickPerformance(delta);
    this.ballManager.flushPendingClones();
    const combo = this.comboSystem.update(physicsMs);
    this.juice.combo(combo.streak);

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
      session.draft = { name: String(data.draft.name ?? ''), rows: [...data.draft.rows] };
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
          createPatternFromEditorRows(this.levelIndex, draft.name, draft.rows),
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
    this.level.bricks.forEach((spec) => {
      const brick = new Brick(this, spec);
      this.bricks.add(brick);
      this.grid.set(brick);
      if (!this.reducedMotion && this.mode !== 'demo') {
        // Bricks drop into place row by row when the level starts.
        const targetY = brick.y;
        brick.setY(targetY - 26).setAlpha(0);
        this.tweens.add({
          targets: brick,
          y: targetY,
          alpha: 1,
          delay: spec.row * 9 + (spec.col % 2) * 6,
          duration: 260,
          ease: 'Back.easeOut'
        });
      }
    });
    this.bricksTotal = this.getBricks().filter((brick) => brick.isBreakable).length;
    this.breakableLeft = this.bricksTotal;
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
    for (const ball of this.ballManager.getActiveBalls()) {
      if (ball.isAttached) continue;
      this.stepEvents.length = 0;
      stepBall(ball, dt, this.stepContext, this.stepEvents);
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
        ball.impact = 1;
        if (!event.item.isBreakable) {
          this.sfx('steel', { x: event.x });
          event.item.flash(50);
          this.particleSystem.sparkBurst(event.x, event.y, 0xd8d2c4, 4);
        } else {
          this.damageBrick(event.item, 1, 0, ball, event.x, event.y);
        }
        break;
    }
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

    if (this.activeTimers.has('stickyPaddle')) {
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
    this.grid.remove(brick);
    this.bricks.remove(brick, false, false);
    brick.setActive(false);
    this.breakableLeft = Math.max(0, this.breakableLeft - 1);
    this.playBreakAnimation(brick);

    const combo = this.comboSystem.registerBreak();
    const awarded = this.scoreSystem.registerBrickBreak(
      score,
      combo.multiplier,
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

    this.spawnPowerUp(x, y, powerUpChance, sourceBall, kind === 'bonus');

    if (this.breakableLeft === 0 && !this.ending) {
      this.onLastBrick(x, y);
    }
    this.checkVictory();
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
    // AIM only makes sense with a few balls to catch.
    if (type === 'stickyPaddle' && this.ballManager.getStats().activeCount > 3) {
      return;
    }
    let powerUp = this.powerUps.find((item) => !item.active);
    if (!powerUp) {
      if (this.powerUps.length >= MAX_POWER_UPS) {
        // Too many capsules on screen: turn the drop into points instead of losing it.
        this.scoreSystem.registerBrickBreak(50, 1, 1);
        return;
      }
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
    this.sfx('powerUp', { x: powerUp.x });
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
    this.juice.popup(powerUp.x, this.paddle.top - 40, definition.label, '#ffffff', 40, true);
    this.paddle.bump(0.5);
    this.applyPowerUp(type, sourceBall);
  }

  /** Applies a power-up effect; public so diagnostics can trigger effects directly. */
  public applyPowerUp(type: PowerUpType, sourceBall?: Ball): void {
    switch (type) {
      case 'multiBall':
        this.splitBalls(sourceBall, [-0.34, 0.34]);
        break;
      case 'splitBall':
        this.splitBalls(sourceBall, [0.6]);
        break;
      case 'widePaddle':
        this.setTimedEffect(
          type,
          11000,
          () => this.paddle.setWidthScale(1.38),
          () => this.paddle.setWidthScale(1)
        );
        break;
      case 'stickyPaddle':
        this.setTimedEffect(
          type,
          9000,
          () => this.paddle.setTint(0xffe7a8),
          () => {
            this.paddle.clearTint();
            this.launchAttachedBalls();
          }
        );
        break;
      case 'extraLife':
        if (this.lives < MAX_LIVES) {
          this.lives = Math.min(this.lives + 1, MAX_LIVES);
          this.emitHud();
        }
        break;
    }
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

  // ------------------------------------------------------------------ visuals & input

  private updateBallVisuals(deltaMs: number): void {
    let trails = 0;
    for (const ball of this.ballManager.getActiveBalls()) {
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
    if (this.ending || this.getBricks().some((brick) => brick.isBreakable)) {
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
    this.time.delayedCall(450, () => this.sfx('levelClear'));
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

    if (isFinalDailyWave) {
      this.scoreSystem.addLifeBonus(this.lives);
      this.time.delayedCall(450, () => this.sfx('levelClear'));
      this.finishRun('victory', this.wave);
      return;
    }

    const nextWave = this.wave + 1;
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
      session: { ...this.session, carry: undefined, wave: this.isWaveMode() ? 1 : undefined },
      ...result
    };
    this.time.delayedCall(this.reducedMotion ? 150 : 900, () => {
      bridge.emit('result', payload);
    });
  }

  private calculateLevelMedal(score: number): LevelMedal {
    const combo = this.comboSystem.snapshot();
    const { medalTargets } = this.level;
    const hitGoldScore = medalTargets.goldScore !== undefined && score >= medalTargets.goldScore;
    const hitGoldCombo =
      medalTargets.goldBestCombo !== undefined && combo.bestStreak >= medalTargets.goldBestCombo;
    if (hitGoldScore || hitGoldCombo) return 'gold';
    if (this.lives >= medalTargets.silverLives) return 'silver';
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
      effects: [...this.activeTimers.keys()],
      objective: this.getObjectiveProgress(ballStats.maxBallsReached, combo.bestStreak)
    };
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
      activeEffects: [...this.activeTimers.keys()].join('+'),
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
