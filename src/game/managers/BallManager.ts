import type Phaser from 'phaser';
import { Ball } from '../entities/Ball';
import type { Paddle } from '../entities/Paddle';
import {
  BALL_LIMIT_GROWTH_STEP,
  BALL_LIMIT_STRESS_FRAME_MS,
  BALL_LIMIT_STRESS_FRAMES,
  BALL_MIN_SPEED,
  BALL_RADIUS,
  INITIAL_ACTIVE_BALL_LIMIT,
  MAX_ACTIVE_BALLS,
  PLAYFIELD_LEFT,
  PLAYFIELD_RIGHT
} from '../utils/constants';

export interface BallManagerStats {
  activeCount: number;
  activeLimit: number;
  pendingClones: number;
  maxBallsReached: number;
  expansionBlocked: boolean;
}

interface BallManagerOptions {
  ballSpeed: number;
  maxBallSpeed: number;
  applyBallFx: (ball: Ball) => void;
  onBallActivated: (ball: Ball) => void;
  onAttachedBallCreated: (ball: Ball) => void;
  onAttachedBallLaunched: (ball: Ball) => void;
  onExpansionBlocked?: (reason: string) => void;
}

export class BallManager {
  public readonly group: Phaser.Physics.Arcade.Group;

  private maxBallsReached = 1;
  private expansionBlocked = false;
  private activeLimit = INITIAL_ACTIVE_BALL_LIMIT;
  private stressFrames = 0;
  private pendingClones = 0;
  private readonly ballsWithFx = new WeakSet<Ball>();
  private readonly ballNearWallFrames = new WeakMap<Ball, number>();

  public constructor(
    private readonly scene: Phaser.Scene,
    private readonly paddle: Paddle,
    private readonly options: BallManagerOptions
  ) {
    this.group = scene.physics.add.group({
      classType: Ball,
      maxSize: MAX_ACTIVE_BALLS,
      allowGravity: false,
      runChildUpdate: false
    });
  }

  public createAttachedBall(): Ball | null {
    return this.createBall(true);
  }

  public createBall(attached: boolean): Ball | null {
    const startX = this.paddle.x;
    const startY = this.paddle.y - 56;
    const ball = this.acquireBall(startX, startY);

    if (!ball) {
      return null;
    }

    ball.reset(startX, startY);
    this.applyBallFxOnce(ball);

    if (attached) {
      ball.attachToPaddle(this.paddle);
    }

    this.options.onBallActivated(ball);
    this.options.onAttachedBallCreated(ball);
    this.refreshMaxBallsReached();
    return ball;
  }

  public launchAttachedBalls(): void {
    this.getActiveBalls()
      .filter((ball) => ball.isAttached)
      .forEach((ball) => {
        ball.launch(this.options.ballSpeed);
        this.options.onAttachedBallLaunched(ball);
      });
  }

  public update(isRespawning: boolean): boolean {
    this.getActiveBalls().forEach((ball) => {
      if (ball.isAttached) {
        ball.attachToPaddle(this.paddle);
        this.options.onBallActivated(ball);
        return;
      }

      ball.maintainSpeed(BALL_MIN_SPEED, this.options.maxBallSpeed);
      this.detectWallTunneling(ball);
      this.options.onBallActivated(ball);

      if (ball.isOutOfPlay()) {
        ball.disable();
        this.ballNearWallFrames.delete(ball);
      }
    });

    this.refreshMaxBallsReached();
    return this.getActiveBalls().length === 0 && !isRespawning;
  }

  public updateAdaptiveLimit(deltaMs: number): void {
    if (this.expansionBlocked || this.getActiveBalls().length < INITIAL_ACTIVE_BALL_LIMIT) {
      this.stressFrames = 0;
      return;
    }

    if (deltaMs < BALL_LIMIT_STRESS_FRAME_MS) {
      this.stressFrames = 0;
      return;
    }

    this.stressFrames += 1;

    if (this.stressFrames >= BALL_LIMIT_STRESS_FRAMES) {
      this.blockExpansion(
        `frame time stayed above ${BALL_LIMIT_STRESS_FRAME_MS}ms near ${
          this.getActiveBalls().length
        } balls`
      );
    }
  }

  public duplicateBallsOrQueue(source: Ball, angleOffsetsRadians: number[]): void {
    const reservedSlots = this.reserveCloneSlots(angleOffsetsRadians.length);

    angleOffsetsRadians.forEach((angleOffsetRadians, index) => {
      if (index < reservedSlots && this.duplicateBall(source, angleOffsetRadians)) {
        return;
      }

      if (!this.isCloneLimitBlocked()) {
        this.pendingClones += 1;
      }
    });
  }

  public flushPendingClones(sourceBall?: Ball): void {
    if (this.pendingClones <= 0 || this.isCloneLimitBlocked()) {
      return;
    }

    const source = this.getPowerUpSourceBall(sourceBall);

    if (!source) {
      return;
    }

    const offsets = [0.34, -0.34, 0.7, -0.7, 0.18, -0.18];

    while (this.pendingClones > 0) {
      const offset = offsets[this.pendingClones % offsets.length] ?? 0.34;
      if (!this.duplicateBall(source, offset)) {
        return;
      }
      this.pendingClones -= 1;
    }
  }

  public getPowerUpSourceBall(sourceBall?: Ball): Ball | null {
    if (sourceBall && sourceBall.active && !sourceBall.isAttached) {
      return sourceBall;
    }

    const launchedBall = this.getActiveBalls().find((ball) => !ball.isAttached);

    if (launchedBall) {
      return launchedBall;
    }

    if (sourceBall && sourceBall.active) {
      return sourceBall;
    }

    return this.getActiveBalls()[0] ?? null;
  }

  public getActiveBalls(): Ball[] {
    return this.group
      .getChildren()
      .filter((child): child is Ball => child instanceof Ball && child.active);
  }

  public getStats(): BallManagerStats {
    const activeCount = this.getActiveBalls().length;

    return {
      activeCount,
      activeLimit: this.expansionBlocked
        ? Math.min(this.activeLimit, INITIAL_ACTIVE_BALL_LIMIT)
        : this.activeLimit,
      pendingClones: this.pendingClones,
      maxBallsReached: Math.max(this.maxBallsReached, activeCount),
      expansionBlocked: this.expansionBlocked
    };
  }

  public getActiveLimit(): number {
    return this.activeLimit;
  }

  public setActiveLimit(limit: number): void {
    if (!Number.isFinite(limit)) {
      return;
    }

    this.activeLimit = Math.max(1, Math.min(MAX_ACTIVE_BALLS, Math.floor(limit)));
  }

  public getPendingClones(): number {
    return this.pendingClones;
  }

  public setPendingClones(count: number): void {
    if (!Number.isFinite(count)) {
      return;
    }

    this.pendingClones = Math.max(0, Math.floor(count));
  }

  public getExpansionBlocked(): boolean {
    return this.expansionBlocked;
  }

  public setExpansionBlocked(blocked: boolean): void {
    this.expansionBlocked = blocked;
  }

  public getStressFrames(): number {
    return this.stressFrames;
  }

  public setStressFrames(frames: number): void {
    if (!Number.isFinite(frames)) {
      return;
    }

    this.stressFrames = Math.max(0, Math.floor(frames));
  }

  private acquireBall(x: number, y: number): Ball | null {
    const reusable = this.group
      .getChildren()
      .find((child): child is Ball => child instanceof Ball && !child.active);

    if (reusable) {
      return reusable;
    }

    const pooled = this.group.get(x, y) as Ball | null;

    if (pooled) {
      return pooled;
    }

    if (this.group.getChildren().length >= MAX_ACTIVE_BALLS) {
      return null;
    }

    const ball = new Ball(this.scene, x, y);
    this.group.add(ball);
    return ball;
  }

  private applyBallFxOnce(ball: Ball): void {
    if (this.ballsWithFx.has(ball)) {
      return;
    }

    this.options.applyBallFx(ball);
    this.ballsWithFx.add(ball);
  }

  private detectWallTunneling(ball: Ball): void {
    if (ball.x < PLAYFIELD_LEFT - BALL_RADIUS || ball.x > PLAYFIELD_RIGHT + BALL_RADIUS) {
      this.blockExpansion('ball tunneled outside playfield');
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
      this.blockExpansion('ball trapped near wall');
    }
  }

  private duplicateBall(source: Ball, angleOffsetRadians: number): Ball | null {
    if (!this.canCreateMoreBalls()) {
      return null;
    }

    const newBall = this.acquireBall(source.x, source.y);
    if (!newBall) {
      return null;
    }

    if (source.isAttached) {
      newBall.configureAsLaunchedClone(source, angleOffsetRadians, this.options.ballSpeed);
    } else {
      newBall.configureAsClone(source, angleOffsetRadians);
    }

    this.applyBallFxOnce(newBall);
    this.options.onBallActivated(newBall);
    this.refreshMaxBallsReached();
    return newBall;
  }

  private reserveCloneSlots(requestedSlots: number): number {
    const ballCount = this.getActiveBalls().length;

    if (requestedSlots <= 0 || ballCount >= MAX_ACTIVE_BALLS) {
      return 0;
    }

    const availableHardSlots = Math.min(requestedSlots, MAX_ACTIVE_BALLS - ballCount);
    const requiredLimit = ballCount + availableHardSlots;
    const blockedLimit = this.expansionBlocked ? INITIAL_ACTIVE_BALL_LIMIT : this.activeLimit;

    if (requiredLimit <= blockedLimit) {
      return availableHardSlots;
    }

    if (this.expansionBlocked) {
      return Math.max(0, Math.min(availableHardSlots, INITIAL_ACTIVE_BALL_LIMIT - ballCount));
    }

    this.activeLimit = Math.min(
      MAX_ACTIVE_BALLS,
      Math.max(this.activeLimit + BALL_LIMIT_GROWTH_STEP, requiredLimit)
    );

    return Math.max(0, Math.min(availableHardSlots, this.activeLimit - ballCount));
  }

  private canCreateMoreBalls(): boolean {
    const ballCount = this.getActiveBalls().length;

    if (this.expansionBlocked && ballCount >= INITIAL_ACTIVE_BALL_LIMIT) {
      return false;
    }

    if (ballCount >= MAX_ACTIVE_BALLS) {
      return false;
    }

    if (ballCount < this.activeLimit) {
      return true;
    }

    this.activeLimit = Math.min(MAX_ACTIVE_BALLS, this.activeLimit + BALL_LIMIT_GROWTH_STEP);
    return ballCount < this.activeLimit;
  }

  private isCloneLimitBlocked(): boolean {
    return this.expansionBlocked && this.getActiveBalls().length >= INITIAL_ACTIVE_BALL_LIMIT;
  }

  private blockExpansion(reason: string): void {
    if (this.expansionBlocked) {
      return;
    }

    this.expansionBlocked = true;
    this.options.onExpansionBlocked?.(reason);
  }

  private refreshMaxBallsReached(): void {
    this.maxBallsReached = Math.max(this.maxBallsReached, this.getActiveBalls().length);
  }
}
