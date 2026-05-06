import Phaser from 'phaser';
import { getTheme, type ThemeDefinition } from '../config/themeConfig';
import { Ball } from '../entities/Ball';
import { Brick } from '../entities/Brick';
import { Paddle } from '../entities/Paddle';
import { PowerUp } from '../entities/PowerUp';
import type { LevelDefinition } from '../levels/levelTypes';
import { AudioSystem } from '../systems/AudioSystem';
import { CollisionSystem } from '../systems/CollisionSystem';
import { ComboSystem } from '../systems/ComboSystem';
import { InputSystem } from '../systems/InputSystem';
import { LevelSystem } from '../systems/LevelSystem';
import { ParticleSystem } from '../systems/ParticleSystem';
import { getPowerUpDefinition, PowerUpSystem, type PowerUpType } from '../systems/PowerUpSystem';
import { SaveSystem } from '../systems/SaveSystem';
import type { LevelMedal } from '../systems/SaveSystem';
import { SettingsSystem } from '../systems/SettingsSystem';
import { FxManager } from '../systems/FxManager';
import { ScoreSystem } from '../systems/ScoreSystem';
import { PlayfieldRenderer } from '../managers/PlayfieldRenderer';
import { Hud } from '../ui/Hud';
import {
  BALL_MAX_PADDLE_ANGLE_DEGREES,
  BALL_AXIS_LOCK_MIN_SPEED,
  BALL_LIMIT_GROWTH_STEP,
  BALL_LIMIT_STRESS_FRAME_MS,
  BALL_LIMIT_STRESS_FRAMES,
  BALL_MIN_SPEED,
  BALL_RADIUS,
  BRICK_GAP,
  INITIAL_ACTIVE_BALL_LIMIT,
  MAX_ACTIVE_BALLS,
  MAX_LIVES,
  PADDLE_HEIGHT,
  POWER_UP_DROP_SPEED,
  PLAYFIELD_LEFT,
  PLAYFIELD_RIGHT,
  WORLD_HEIGHT
} from '../utils/constants';
import {
  avoidAxisLock,
  calculatePaddleBounceVelocity,
  clamp,
  rectangleDistance
} from '../utils/math';

interface GameSceneData {
  levelIndex?: number;
  source?: 'campaign' | 'creative';
  editorReturn?: {
    mode: 'creative' | 'admin';
    slotIndex: number;
  };
}

interface BallPhysicsSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export class GameScene extends Phaser.Scene {
  private levelSystem!: LevelSystem;
  private level!: LevelDefinition;
  private theme!: ThemeDefinition;
  private paddle!: Paddle;
  private balls!: Phaser.Physics.Arcade.Group;
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
  private readonly ballsWithFx = new WeakSet<Ball>();
  private hud!: Hud;
  private lives = 3;
  private levelIndex = 0;
  private levelSource: 'campaign' | 'creative' = 'campaign';
  private editorReturn?: GameSceneData['editorReturn'];
  private ending = false;
  private respawning = false;
  private maxBallsReached = 1;
  private ballExpansionBlocked = false;
  private activeBallLimit = INITIAL_ACTIVE_BALL_LIMIT;
  private ballLimitStressFrames = 0;
  private pendingBallBonusClones = 0;
  private explosionsTriggered = 0;
  private readonly activeTimers = new Map<PowerUpType, Phaser.Time.TimerEvent>();
  private readonly ballNearWallFrames = new WeakMap<Ball, number>();
  private readonly ballPhysicsSnapshots = new WeakMap<Ball, BallPhysicsSnapshot>();
  private readonly lastIndestructibleWallBounceTimes = new WeakMap<Ball, number>();

  public constructor() {
    super('GameScene');
  }

  public create(data: GameSceneData): void {
    const mainCamera = this.cameras.main;
    this.tweens.killTweensOf(mainCamera);
    mainCamera.resetFX();
    mainCamera.setAlpha(1);
    mainCamera.setZoom(1);
    mainCamera.setScroll(0, 0);

    this.levelIndex = data.levelIndex ?? 0;
    this.levelSource = data.source ?? 'campaign';
    this.editorReturn = data.editorReturn;
    this.saveSystem = new SaveSystem();
    this.settingsSystem = new SettingsSystem(this.saveSystem);
    this.levelSystem = new LevelSystem(this.saveSystem);
    this.level = this.levelSystem.getLevel(this.levelIndex, this.levelSource);
    this.theme = getTheme(this.saveSystem.snapshot().preferences.themeId);
    this.audioSystem = new AudioSystem(
      this.saveSystem.snapshot().preferences.soundEnabled,
      this.settingsSystem.getVolumeSfx()
    );
    this.scoreSystem = new ScoreSystem(this.saveSystem.snapshot().bestScore);
    this.comboSystem = new ComboSystem();
    this.powerUpSystem = new PowerUpSystem();
    this.collisionSystem = new CollisionSystem();
    this.particleSystem = new ParticleSystem(this);
    this.fxManager = new FxManager(this, this.particleSystem, this.settingsSystem.getFxQuality());
    this.lives = this.level.difficulty.initialLives;
    this.ending = false;
    this.respawning = false;
    this.maxBallsReached = 1;
    this.ballExpansionBlocked = false;
    this.activeBallLimit = INITIAL_ACTIVE_BALL_LIMIT;
    this.ballLimitStressFrames = 0;
    this.pendingBallBonusClones = 0;
    this.explosionsTriggered = 0;
    this.activeTimers.clear();

    new PlayfieldRenderer(this, this.theme).render();

    this.balls = this.physics.add.group({
      classType: Ball,
      maxSize: MAX_ACTIVE_BALLS,
      allowGravity: false,
      runChildUpdate: false
    });
    this.bricks = this.physics.add.group({ allowGravity: false, immovable: true });
    this.powerUps = this.physics.add.group({
      classType: PowerUp,
      maxSize: 32,
      allowGravity: false,
      runChildUpdate: false
    });

    this.paddle = new Paddle(this);
    this.fxManager.applyEntityFx(this.paddle, 'paddle', this.theme);
    this.inputSystem = new InputSystem(this);
    this.createBricks();
    this.createBall(true);

    this.hud = new Hud(this, this.buildHudState(), this.theme);
    this.registerCollisions();
    this.registerSceneInput();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdownSystems, this);
  }

  public override update(_time: number, delta: number): void {
    if (this.ending) {
      return;
    }

    this.inputSystem.updatePaddle(this.paddle, delta);
    this.updateBalls();
    this.updatePowerUps();
    this.updateAdaptiveBallLimit(delta);
    this.fxManager.tickPerformance(delta);
    this.flushPendingBallBonusClones();
    this.comboSystem.update(delta);
    this.maxBallsReached = Math.max(this.maxBallsReached, this.getBalls().length);

    this.hud.update(this.buildHudState());
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

  private createBall(attached: boolean): Ball | null {
    const startX = this.paddle.x;
    const startY = this.paddle.y - 56;
    const ball = this.balls.get(startX, startY) as Ball | null;
    if (!ball) {
      return null;
    }

    ball.reset(startX, startY);
    this.applyBallFxOnce(ball);

    if (attached) {
      ball.attachToPaddle(this.paddle);
    }

    this.rememberBallPhysics(ball);
    this.particleSystem.burst(ball.x, ball.y, this.theme.primary, 8);
    return ball;
  }

  private applyBallFxOnce(ball: Ball): void {
    if (this.ballsWithFx.has(ball)) {
      return;
    }
    this.fxManager.applyEntityFx(ball, 'ball', this.theme);
    this.ballsWithFx.add(ball);
  }

  private registerCollisions(): void {
    this.collisionSystem.register(this, this.paddle, this.balls, this.bricks, this.powerUps, {
      onBallPaddle: (ball) => this.handleBallPaddle(ball),
      onBallBrick: (ball, brick) => this.handleBallBrick(ball, brick),
      onPowerUpPaddle: (powerUp) => this.handlePowerUpPaddle(powerUp)
    });
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
    this.audioSystem.unlock();
    this.launchAttachedBalls();
  }

  private launchAttachedBalls(): void {
    this.getBalls()
      .filter((ball) => ball.isAttached)
      .forEach((ball) => {
        ball.launch(this.level.difficulty.ballSpeed);
        this.particleSystem.burst(ball.x, ball.y, this.theme.secondary, 10);
      });
  }

  private detectWallTunneling(ball: Ball): void {
    if (ball.x < PLAYFIELD_LEFT - BALL_RADIUS || ball.x > PLAYFIELD_RIGHT + BALL_RADIUS) {
      this.blockBallExpansion('ball tunneled outside playfield');
      return;
    }

    this.detectStuckNearWall(ball);
  }

  private detectStuckNearWall(ball: Ball): void {
    const nearLeftWall = ball.x <= PLAYFIELD_LEFT + BALL_RADIUS * 3;
    const nearRightWall = ball.x >= PLAYFIELD_RIGHT - BALL_RADIUS * 3;

    if (!nearLeftWall && !nearRightWall) {
      this.ballNearWallFrames.delete(ball);
      return;
    }

    const frames = (this.ballNearWallFrames.get(ball) ?? 0) + 1;
    this.ballNearWallFrames.set(ball, frames);

    if (frames >= 90) {
      this.blockBallExpansion('ball trapped near wall');
    }
  }

  private updateBalls(): void {
    this.getBalls().forEach((ball) => {
      if (ball.isAttached) {
        ball.attachToPaddle(this.paddle);
        this.rememberBallPhysics(ball);
        return;
      }

      ball.maintainSpeed(BALL_MIN_SPEED, this.level.difficulty.maxBallSpeed);
      this.detectWallTunneling(ball);
      this.rememberBallPhysics(ball);

      if (ball.isOutOfPlay()) {
        ball.disable();
      }
    });

    if (this.getBalls().length === 0 && !this.respawning) {
      this.loseLife();
    }
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
      this.particleSystem.burst(ball.x, ball.y, this.theme.primary, 8);
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
      this.particleSystem.burst(brick.x, brick.y, brick.spec.color, 4);
      return;
    }

    const destroyed = brick.damage(amount);

    if (!destroyed) {
      this.particleSystem.burst(brick.x, brick.y, brick.spec.color, 5);
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
    this.particleSystem.burst(x, y, color, kind === 'explosive' ? 28 : 16);

    if (kind === 'explosive') {
      this.explosionsTriggered += 1;
      this.fxManager.cameraImpact(0.008, 180);
      this.fxManager.cameraFlash(this.theme.danger, 90);
      this.damageNearbyBricks(x, y, chainDepth + 1);
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
          () =>
            this.particleSystem.burst(this.paddle.x, this.paddle.y - 26, this.theme.primary, 14),
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
    this.particleSystem.burst(this.paddle.x, this.paddle.y - 24, this.theme.danger, 14);
    this.hud.update(this.buildHudState());
  }

  private applyMultiBall(sourceBall?: Ball): void {
    const source = this.getPowerUpSourceBall(sourceBall);

    if (source) {
      this.duplicateBallsOrQueue(source, [-0.34, 0.34]);
    }

    this.fxManager.cameraImpact(0.003, 100);
  }

  private applySplitBall(sourceBall?: Ball): void {
    const source = this.getPowerUpSourceBall(sourceBall);

    if (source) {
      this.duplicateBallsOrQueue(source, [0.7]);
    }

    this.fxManager.cameraImpact(0.002, 80);
  }

  private getPowerUpSourceBall(sourceBall?: Ball): Ball | null {
    if (sourceBall && sourceBall.active && !sourceBall.isAttached) {
      return sourceBall;
    }

    const launchedBall = this.getBalls().find((ball) => !ball.isAttached);

    if (launchedBall) {
      return launchedBall;
    }

    if (sourceBall && sourceBall.active) {
      return sourceBall;
    }

    return this.getBalls()[0] ?? null;
  }

  private duplicateBall(source: Ball, angleOffsetRadians: number): Ball | null {
    if (!this.canCreateMoreBalls()) {
      return null;
    }

    const newBall = this.balls.get(source.x, source.y) as Ball | null;
    if (!newBall) {
      return null;
    }

    if (source.isAttached) {
      newBall.configureAsLaunchedClone(source, angleOffsetRadians, this.level.difficulty.ballSpeed);
    } else {
      newBall.configureAsClone(source, angleOffsetRadians);
    }

    this.rememberBallPhysics(newBall);
    this.maxBallsReached = Math.max(this.maxBallsReached, this.getBalls().length);
    return newBall;
  }

  private duplicateBallsOrQueue(source: Ball, angleOffsetsRadians: number[]): void {
    const reservedSlots = this.reserveBallCloneSlots(angleOffsetsRadians.length);

    angleOffsetsRadians.forEach((angleOffsetRadians, index) => {
      if (index < reservedSlots && this.duplicateBall(source, angleOffsetRadians)) {
        return;
      }

      if (!this.isBallCloneLimitBlocked()) {
        this.pendingBallBonusClones += 1;
      }
    });
  }

  private reserveBallCloneSlots(requestedSlots: number): number {
    const ballCount = this.getBalls().length;

    if (requestedSlots <= 0 || ballCount >= MAX_ACTIVE_BALLS) {
      return 0;
    }

    const availableHardSlots = Math.min(requestedSlots, MAX_ACTIVE_BALLS - ballCount);
    const requiredLimit = ballCount + availableHardSlots;
    const blockedLimit = this.ballExpansionBlocked
      ? INITIAL_ACTIVE_BALL_LIMIT
      : this.activeBallLimit;

    if (requiredLimit <= blockedLimit) {
      return availableHardSlots;
    }

    if (this.ballExpansionBlocked) {
      return Math.max(0, Math.min(availableHardSlots, INITIAL_ACTIVE_BALL_LIMIT - ballCount));
    }

    this.activeBallLimit = Math.min(
      MAX_ACTIVE_BALLS,
      Math.max(this.activeBallLimit + BALL_LIMIT_GROWTH_STEP, requiredLimit)
    );

    return Math.max(0, Math.min(availableHardSlots, this.activeBallLimit - ballCount));
  }

  private flushPendingBallBonusClones(): void {
    if (this.pendingBallBonusClones <= 0 || this.isBallCloneLimitBlocked()) {
      return;
    }

    const source = this.getPowerUpSourceBall();

    if (!source) {
      return;
    }

    const offsets = [0.34, -0.34, 0.7, -0.7, 0.18, -0.18];

    while (this.pendingBallBonusClones > 0) {
      const offset = offsets[this.pendingBallBonusClones % offsets.length] ?? 0.34;
      if (!this.duplicateBall(source, offset)) {
        return;
      }
      this.pendingBallBonusClones -= 1;
    }
  }

  private canCreateMoreBalls(): boolean {
    const ballCount = this.getBalls().length;

    if (this.ballExpansionBlocked && ballCount >= INITIAL_ACTIVE_BALL_LIMIT) {
      return false;
    }

    if (ballCount >= MAX_ACTIVE_BALLS) {
      return false;
    }

    if (ballCount < this.activeBallLimit) {
      return true;
    }

    this.activeBallLimit = Math.min(
      MAX_ACTIVE_BALLS,
      this.activeBallLimit + BALL_LIMIT_GROWTH_STEP
    );
    return ballCount < this.activeBallLimit;
  }

  private isBallCloneLimitBlocked(): boolean {
    return this.ballExpansionBlocked && this.getBalls().length >= INITIAL_ACTIVE_BALL_LIMIT;
  }

  private updateAdaptiveBallLimit(deltaMs: number): void {
    if (this.ballExpansionBlocked || this.getBalls().length < INITIAL_ACTIVE_BALL_LIMIT) {
      this.ballLimitStressFrames = 0;
      return;
    }

    if (deltaMs < BALL_LIMIT_STRESS_FRAME_MS) {
      this.ballLimitStressFrames = 0;
      return;
    }

    this.ballLimitStressFrames += 1;

    if (this.ballLimitStressFrames >= BALL_LIMIT_STRESS_FRAMES) {
      this.blockBallExpansion(
        `frame time stayed above ${BALL_LIMIT_STRESS_FRAME_MS}ms near ${this.getBalls().length} balls`
      );
    }
  }

  private blockBallExpansion(reason: string): void {
    void reason;
    if (this.ballExpansionBlocked) {
      return;
    }
    this.ballExpansionBlocked = true;
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
    this.lives -= 1;
    this.comboSystem.reset();
    this.audioSystem.danger();
    this.fxManager.cameraImpact(0.005, 140);
    this.fxManager.cameraFlash(this.theme.danger, 100);

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
        this.createBall(true);
      }
      this.respawning = false;
    });
  }

  private checkVictory(): void {
    if (this.getBricks().some((brick) => brick.isBreakable)) {
      return;
    }

    this.ending = true;
    const stateBeforeBonus = this.scoreSystem.snapshot();
    this.scoreSystem.addLifeBonus(this.lives);
    const score = this.scoreSystem.snapshot().score;
    const medal = this.calculateLevelMedal(score);

    if (!this.editorReturn && this.levelSource === 'campaign') {
      this.saveSystem.updateBestScore(score);
      this.saveSystem.completeLevel(this.levelIndex, medal);
    }

    this.fxManager.cameraImpact(0.005, 200);
    this.fxManager.cameraFlash(this.theme.primary, 140);
    this.fxManager.cameraFadeOut(420, 0x000000);

    this.time.delayedCall(520, () => {
      if (!this.scene.isActive()) {
        return;
      }

      this.scene.start('VictoryScene', {
        score: Math.max(score, stateBeforeBonus.score),
        levelIndex: this.levelIndex,
        medal,
        editorReturn: this.editorReturn
      });
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
    const score = this.scoreSystem.snapshot().score;
    this.saveSystem.updateBestScore(score);

    this.fxManager.cameraFadeOut(460, 0x1a0606);

    this.time.delayedCall(460, () => {
      if (!this.scene.isActive()) {
        return;
      }

      this.scene.start('GameOverScene', {
        score,
        levelIndex: this.levelIndex,
        source: this.levelSource,
        editorReturn: this.editorReturn
      });
    });
  }

  private pauseGame(): void {
    if (this.ending) {
      return;
    }

    this.scene.launch('PauseScene', { levelIndex: this.levelIndex });
    this.scene.pause();
  }

  private restartLevel(): void {
    this.scene.restart({
      levelIndex: this.levelIndex,
      source: this.levelSource,
      editorReturn: this.editorReturn
    });
  }

  private buildHudState() {
    const combo = this.comboSystem.snapshot();
    return {
      levelName: this.level.name,
      objectiveLabel: this.getObjectiveHudLabel(),
      score: this.scoreSystem.snapshot().score,
      lives: this.lives,
      combo: combo.streak,
      bestCombo: combo.bestStreak,
      balls: this.getBalls().length,
      waitingToLaunch: this.getBalls().some((ball) => ball.isAttached),
      effectLabel: this.getActiveEffectLabel()
    };
  }

  private getActiveEffectLabel(): string {
    if (this.activeTimers.size === 0) {
      return '';
    }

    const labels = [...this.activeTimers.keys()].map((type) => getPowerUpDefinition(type).label);
    return labels.join('+');
  }

  private getObjectiveHudLabel(): string {
    const objective = this.level.objective;
    const combo = this.comboSystem.snapshot();

    switch (objective.type) {
      case 'reachBalls':
        return `${objective.label} ${Math.min(this.maxBallsReached, objective.target)}/${objective.target}`;
      case 'triggerExplosions':
        return `${objective.label} ${Math.min(this.explosionsTriggered, objective.target)}/${objective.target}`;
      case 'clearWithLives':
        return objective.label;
      case 'bestCombo':
      default:
        return `${objective.label} ${Math.min(combo.bestStreak, objective.target)}/${objective.target}`;
    }
  }

  private getBalls(): Ball[] {
    return this.balls
      .getChildren()
      .filter((child): child is Ball => child instanceof Ball && child.active);
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
