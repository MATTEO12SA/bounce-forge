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
import { PowerUpSystem, type PowerUpType } from '../systems/PowerUpSystem';
import { SaveSystem } from '../systems/SaveSystem';
import type { LevelMedal } from '../systems/SaveSystem';
import { ScoreSystem } from '../systems/ScoreSystem';
import { Hud } from '../ui/Hud';
import {
  BALL_MAX_PADDLE_ANGLE_DEGREES,
  BALL_AXIS_LOCK_MIN_SPEED,
  BALL_MIN_SPEED,
  BALL_RADIUS,
  BRICK_GAP,
  DEPTHS,
  MAX_ACTIVE_BALLS,
  MAX_LIVES,
  PADDLE_HEIGHT,
  POWER_UP_DROP_SPEED,
  PLAYFIELD_BOTTOM,
  PLAYFIELD_LEFT,
  PLAYFIELD_RIGHT,
  PLAYFIELD_TOP,
  PLAYFIELD_WIDTH,
  WORLD_HEIGHT,
  WORLD_WIDTH
} from '../utils/constants';
import {
  avoidAxisLock,
  calculatePaddleBounceVelocity,
  clamp,
  rectangleDistance
} from '../utils/math';

interface GameSceneData {
  levelIndex?: number;
  source?: 'campaign' | 'custom';
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
  private audioSystem!: AudioSystem;
  private hud!: Hud;
  private lives = 3;
  private levelIndex = 0;
  private ending = false;
  private respawning = false;
  private maxBallsReached = 1;
  private explosionsTriggered = 0;
  private readonly activeTimers = new Map<PowerUpType, Phaser.Time.TimerEvent>();
  private readonly ballNearWallFrames = new WeakMap<Ball, number>();
  private readonly ballPhysicsSnapshots = new WeakMap<Ball, BallPhysicsSnapshot>();
  private readonly lastIndestructibleWallBounceTimes = new WeakMap<Ball, number>();

  public constructor() {
    super('GameScene');
  }

  public create(data: GameSceneData): void {
    this.levelIndex = data.levelIndex ?? 0;
    this.saveSystem = new SaveSystem();
    this.levelSystem = new LevelSystem(this.saveSystem);
    this.level = this.levelSystem.getLevel(this.levelIndex, data.source ?? 'campaign');
    this.theme = getTheme(this.saveSystem.snapshot().preferences.themeId);
    this.audioSystem = new AudioSystem(this.saveSystem.snapshot().preferences.soundEnabled);
    this.scoreSystem = new ScoreSystem(this.saveSystem.snapshot().bestScore);
    this.comboSystem = new ComboSystem();
    this.powerUpSystem = new PowerUpSystem();
    this.collisionSystem = new CollisionSystem();
    this.particleSystem = new ParticleSystem(this);
    this.lives = this.level.difficulty.initialLives;
    this.ending = false;
    this.respawning = false;
    this.maxBallsReached = 1;
    this.explosionsTriggered = 0;
    this.activeTimers.clear();

    this.drawBackground();

    this.balls = this.physics.add.group({ allowGravity: false });
    this.bricks = this.physics.add.group({ allowGravity: false, immovable: true });
    this.powerUps = this.physics.add.group({ allowGravity: false });

    this.paddle = new Paddle(this);
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
    this.comboSystem.update(delta);
    this.maxBallsReached = Math.max(this.maxBallsReached, this.getBalls().length);

    this.hud.update(this.buildHudState());
  }

  private drawBackground(): void {
    const graphics = this.add.graphics().setDepth(DEPTHS.background);

    graphics.fillGradientStyle(
      this.theme.backgroundTop,
      this.theme.backgroundTop,
      this.theme.backgroundBottom,
      this.theme.backgroundBottom,
      1
    );
    graphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    graphics.lineStyle(1, this.theme.playfieldGrid, 0.1);
    for (let x = 40; x < WORLD_WIDTH; x += 72) {
      graphics.lineBetween(x, 0, x, WORLD_HEIGHT);
    }
    for (let y = 44; y < WORLD_HEIGHT; y += 72) {
      graphics.lineBetween(0, y, WORLD_WIDTH, y);
    }

    graphics.fillGradientStyle(
      this.theme.railOuter,
      this.theme.railInner,
      this.theme.railOuter,
      this.theme.railInner,
      0.95
    );
    graphics.fillRect(0, 0, PLAYFIELD_LEFT - 22, WORLD_HEIGHT);
    graphics.fillGradientStyle(
      this.theme.railInner,
      this.theme.railOuter,
      this.theme.railInner,
      this.theme.railOuter,
      0.95
    );
    graphics.fillRect(PLAYFIELD_RIGHT + 22, 0, WORLD_WIDTH - PLAYFIELD_RIGHT - 22, WORLD_HEIGHT);

    graphics.lineStyle(2, this.theme.borderDim, 0.32);
    for (let x = 18; x < PLAYFIELD_LEFT - 22; x += 38) {
      graphics.lineBetween(x, 0, x, WORLD_HEIGHT);
    }
    for (let x = PLAYFIELD_RIGHT + 36; x < WORLD_WIDTH; x += 38) {
      graphics.lineBetween(x, 0, x, WORLD_HEIGHT);
    }
    for (let y = 20; y < WORLD_HEIGHT; y += 38) {
      graphics.lineBetween(0, y, PLAYFIELD_LEFT - 22, y);
      graphics.lineBetween(PLAYFIELD_RIGHT + 22, y, WORLD_WIDTH, y);
    }

    graphics.fillGradientStyle(
      this.theme.railInner,
      this.theme.wallHighlight,
      this.theme.railOuter,
      this.theme.wall,
      1
    );
    graphics.fillRect(PLAYFIELD_LEFT - 22, 0, 22, WORLD_HEIGHT);
    graphics.fillGradientStyle(
      this.theme.wallHighlight,
      this.theme.railInner,
      this.theme.wall,
      this.theme.railOuter,
      1
    );
    graphics.fillRect(PLAYFIELD_RIGHT, 0, 22, WORLD_HEIGHT);
    graphics.fillGradientStyle(
      this.theme.wallHighlight,
      this.theme.wallHighlight,
      this.theme.wall,
      this.theme.wall,
      1
    );
    graphics.fillRect(PLAYFIELD_LEFT - 22, PLAYFIELD_TOP - 22, PLAYFIELD_WIDTH + 44, 22);

    graphics.fillGradientStyle(
      this.theme.playfieldTop,
      this.theme.playfieldTop,
      this.theme.playfieldBottom,
      this.theme.playfieldBottom,
      1
    );
    graphics.fillRect(
      PLAYFIELD_LEFT,
      PLAYFIELD_TOP,
      PLAYFIELD_WIDTH,
      PLAYFIELD_BOTTOM - PLAYFIELD_TOP
    );

    graphics.lineStyle(1, this.theme.playfieldGrid, 0.13);
    for (let x = PLAYFIELD_LEFT + 40; x < PLAYFIELD_RIGHT; x += 56) {
      graphics.lineBetween(x, PLAYFIELD_TOP, x, PLAYFIELD_BOTTOM);
    }
    for (let y = PLAYFIELD_TOP + 64; y < PLAYFIELD_BOTTOM; y += 64) {
      graphics.lineBetween(PLAYFIELD_LEFT, y, PLAYFIELD_RIGHT, y);
    }

    graphics.lineStyle(2, this.theme.borderDim, 0.95);
    graphics.strokeRect(
      PLAYFIELD_LEFT - 0.5,
      PLAYFIELD_TOP - 0.5,
      PLAYFIELD_WIDTH + 1,
      PLAYFIELD_BOTTOM - PLAYFIELD_TOP + 1
    );

    graphics.lineStyle(4, this.theme.borderDim, 0.48);
    for (let x = PLAYFIELD_LEFT - 18; x <= PLAYFIELD_LEFT - 4; x += 5) {
      graphics.lineBetween(x, 0, x, WORLD_HEIGHT);
    }
    for (let x = PLAYFIELD_RIGHT + 4; x <= PLAYFIELD_RIGHT + 18; x += 5) {
      graphics.lineBetween(x, 0, x, WORLD_HEIGHT);
    }

    graphics.lineStyle(2, this.theme.railEdge, 0.46);
    graphics.lineBetween(
      PLAYFIELD_LEFT - 22,
      PLAYFIELD_TOP - 22,
      PLAYFIELD_RIGHT + 22,
      PLAYFIELD_TOP - 22
    );
    graphics.fillGradientStyle(0xffffff, 0xffffff, 0xffffff, 0xffffff, 0.05, 0.02, 0, 0);
    graphics.fillRect(PLAYFIELD_LEFT, PLAYFIELD_TOP, PLAYFIELD_WIDTH, 460);
  }

  private createBricks(): void {
    this.level.bricks.forEach((spec) => {
      const brick = new Brick(this, spec);
      this.bricks.add(brick);
    });

    this.mergeWallRuns();
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

  private createBall(attached: boolean): Ball {
    const ball = new Ball(this, this.paddle.x, this.paddle.y - 56);

    if (attached) {
      ball.attachToPaddle(this.paddle);
    }

    this.balls.add(ball);
    this.rememberBallPhysics(ball);
    this.particleSystem.burst(ball.x, ball.y, this.theme.primary, 8);
    return ball;
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
      console.error(
        `[BALL TUNNELED] Ball escaped playfield at (${ball.x.toFixed(1)}, ${ball.y.toFixed(1)}) ` +
          `with vel (${ball.arcadeBody.velocity.x.toFixed(1)}, ${ball.arcadeBody.velocity.y.toFixed(1)}) ` +
          `— playfield is [${PLAYFIELD_LEFT}, ${PLAYFIELD_RIGHT}]`
      );
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

    if (frames === 30) {
      console.warn(
        `[BALL OSCILLATING] Ball at (${ball.x.toFixed(1)}, ${ball.y.toFixed(1)}) ` +
          `near ${nearLeftWall ? 'LEFT' : 'RIGHT'} wall for ${frames} frames ` +
          `vel=(${ball.arcadeBody.velocity.x.toFixed(1)}, ${ball.arcadeBody.velocity.y.toFixed(1)})`
      );
    } else if (frames === 90) {
      console.error(
        `[BALL STUCK ON WALL] Ball trapped near ${nearLeftWall ? 'LEFT' : 'RIGHT'} wall ` +
          `for ${frames} frames at (${ball.x.toFixed(1)}, ${ball.y.toFixed(1)}) — bug not self-resolving`
      );
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
        this.balls.remove(ball, true, true);
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
        this.powerUps.remove(powerUp, true, true);
      }
    });
  }

  private handleBallPaddle(ball: Ball): void {
    if (ball.isAttached || ball.y > this.paddle.y + PADDLE_HEIGHT) {
      return;
    }

    const body = ball.arcadeBody;
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
    this.powerUps.remove(powerUp, true, true);
    this.audioSystem.power();
    this.applyPowerUp(type, powerUp.sourceBall);
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
      this.particleSystem.shake(0.005, 130);
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

    const powerUp = new PowerUp(this, x, y, type, sourceBall);
    this.powerUps.add(powerUp);
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
      this.duplicateBall(source, -0.34);
      this.duplicateBall(source, 0.34);
    }

    this.particleSystem.shake(0.003, 100);
  }

  private applySplitBall(sourceBall?: Ball): void {
    const source = this.getPowerUpSourceBall(sourceBall);

    if (source) {
      this.duplicateBall(source, 0.7);
    }

    this.particleSystem.shake(0.002, 80);
  }

  private getPowerUpSourceBall(sourceBall?: Ball): Ball | null {
    if (sourceBall && sourceBall.active && !sourceBall.isAttached) {
      return sourceBall;
    }

    return this.getBalls().find((ball) => !ball.isAttached) ?? null;
  }

  private duplicateBall(source: Ball, angleOffsetRadians: number): Ball | null {
    if (this.getBalls().length >= MAX_ACTIVE_BALLS) {
      return null;
    }

    const newBall = source.duplicateWithAngle(angleOffsetRadians);
    this.balls.add(newBall);
    this.rememberBallPhysics(newBall);
    this.maxBallsReached = Math.max(this.maxBallsReached, this.getBalls().length);
    return newBall;
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
    this.particleSystem.shake(0.004, 120);

    if (this.lives <= 0) {
      this.respawning = false;
      this.endGame();
      return;
    }

    this.time.delayedCall(420, () => {
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
    this.saveSystem.updateBestScore(score);
    const medal = this.calculateLevelMedal(score);
    this.saveSystem.completeLevel(this.levelIndex, medal);
    this.particleSystem.shake(0.004, 180);

    this.time.delayedCall(520, () => {
      this.scene.start('VictoryScene', {
        score: Math.max(score, stateBeforeBonus.score),
        levelIndex: this.levelIndex,
        medal
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

    this.time.delayedCall(460, () => {
      this.scene.start('GameOverScene', {
        score,
        levelIndex: this.levelIndex
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
    this.scene.restart({ levelIndex: this.levelIndex });
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
      waitingToLaunch: this.getBalls().some((ball) => ball.isAttached)
    };
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
