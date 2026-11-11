import type Phaser from 'phaser';
import { Ball } from '../entities/Ball';
import type { Paddle } from '../entities/Paddle';
import { launchVelocity } from '../physics/gameplayRules';
import {
  BALL_LIMIT_GROWTH_STEP,
  BALL_LIMIT_STRESS_FRAME_MS,
  BALL_LIMIT_STRESS_FRAMES,
  BALL_MIN_SPEED,
  INITIAL_ACTIVE_BALL_LIMIT,
  MAX_ACTIVE_BALLS
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
  onBallSpawned?: (ball: Ball) => void;
  onLaunched?: (ball: Ball) => void;
}

/** Pool of balls (max 96) with an adaptive limit that backs off when frames get slow. */
export class BallManager {
  private readonly pool: Ball[] = [];
  private maxBallsReached = 1;
  private expansionBlocked = false;
  private activeLimit = INITIAL_ACTIVE_BALL_LIMIT;
  private stressFrames = 0;
  private pendingClones = 0;
  /** Normalised pointer aim (-1..1) for the next launch, or null for a random tilt. */
  public aim: number | null = null;

  public constructor(
    private readonly scene: Phaser.Scene,
    private readonly paddle: Paddle,
    private readonly options: BallManagerOptions
  ) {}

  public get baseSpeed(): number {
    return this.options.ballSpeed;
  }

  public get maxSpeed(): number {
    return this.options.maxBallSpeed;
  }

  public createAttachedBall(): Ball | null {
    return this.createBall(true);
  }

  public createBall(attached: boolean): Ball | null {
    const ball = this.acquireBall();
    if (!ball) {
      return null;
    }
    ball.reset(this.paddle.x, this.paddle.top - ball.radius - 1);
    ball.speed = this.options.ballSpeed;
    if (attached) {
      ball.attachToPaddle(this.paddle);
    } else {
      const v = launchVelocity(ball.speed, null, Math.random);
      ball.launch(v.vx, v.vy);
    }
    this.options.onBallSpawned?.(ball);
    this.refreshMaxBallsReached();
    return ball;
  }

  public launchAttachedBalls(): void {
    const attached = this.getActiveBalls().filter((ball) => ball.isAttached);
    attached.forEach((ball, index) => {
      // Several caught balls fan out instead of travelling on top of each other.
      const spread = attached.length > 1 ? (index / (attached.length - 1) - 0.5) * 0.5 : 0;
      const aim = this.aim === null ? null : this.aim + spread;
      const v = launchVelocity(Math.max(ball.speed, this.options.ballSpeed), aim, Math.random);
      ball.launch(v.vx, v.vy);
      this.options.onLaunched?.(ball);
    });
  }

  /** Keeps attached balls glued to the paddle and removes balls that fell out. */
  public update(isRespawning: boolean): boolean {
    for (const ball of this.pool) {
      if (!ball.active) continue;
      if (ball.isAttached) {
        ball.attachToPaddle(this.paddle);
      } else if (ball.isOutOfPlay()) {
        ball.disable();
      }
    }
    this.refreshMaxBallsReached();
    return this.countActive() === 0 && !isRespawning;
  }

  public updateAdaptiveLimit(deltaMs: number): void {
    if (this.expansionBlocked || this.countActive() < INITIAL_ACTIVE_BALL_LIMIT) {
      this.stressFrames = 0;
      return;
    }
    if (deltaMs < BALL_LIMIT_STRESS_FRAME_MS) {
      this.stressFrames = 0;
      return;
    }
    this.stressFrames += 1;
    if (this.stressFrames >= BALL_LIMIT_STRESS_FRAMES) {
      this.expansionBlocked = true;
    }
  }

  public duplicateBallsOrQueue(source: Ball, angleOffsetsRadians: number[]): Ball[] {
    const created: Ball[] = [];
    angleOffsetsRadians.forEach((offset) => {
      const ball = this.duplicateBall(source, offset);
      if (ball) {
        created.push(ball);
      } else if (!this.isCloneLimitBlocked() && this.countActive() < MAX_ACTIVE_BALLS) {
        this.pendingClones += 1;
      }
    });
    return created;
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
    const launched = this.getActiveBalls().find((ball) => !ball.isAttached);
    if (launched) {
      return launched;
    }
    if (sourceBall && sourceBall.active) {
      return sourceBall;
    }
    return this.getActiveBalls()[0] ?? null;
  }

  public getActiveBalls(): Ball[] {
    return this.pool.filter((ball) => ball.active);
  }

  public getStats(): BallManagerStats {
    const activeCount = this.countActive();
    return {
      activeCount,
      activeLimit: this.currentLimit(),
      pendingClones: this.pendingClones,
      maxBallsReached: Math.max(this.maxBallsReached, activeCount),
      expansionBlocked: this.expansionBlocked
    };
  }

  public getActiveLimit(): number {
    return this.activeLimit;
  }

  public setActiveLimit(limit: number): void {
    if (Number.isFinite(limit)) {
      this.activeLimit = Math.max(1, Math.min(MAX_ACTIVE_BALLS, Math.floor(limit)));
    }
  }

  public getPendingClones(): number {
    return this.pendingClones;
  }

  public setPendingClones(count: number): void {
    if (Number.isFinite(count)) {
      this.pendingClones = Math.max(0, Math.floor(count));
    }
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
    if (Number.isFinite(frames)) {
      this.stressFrames = Math.max(0, Math.floor(frames));
    }
  }

  public destroy(): void {
    this.pool.length = 0;
  }

  private countActive(): number {
    let count = 0;
    for (const ball of this.pool) {
      if (ball.active) count += 1;
    }
    return count;
  }

  private currentLimit(): number {
    return this.expansionBlocked
      ? Math.min(this.activeLimit, INITIAL_ACTIVE_BALL_LIMIT)
      : this.activeLimit;
  }

  private acquireBall(): Ball | null {
    const reusable = this.pool.find((ball) => !ball.active);
    if (reusable) {
      return reusable;
    }
    if (this.pool.length >= MAX_ACTIVE_BALLS) {
      return null;
    }
    const ball = new Ball(this.scene);
    this.pool.push(ball);
    return ball;
  }

  private duplicateBall(source: Ball, angleOffsetRadians: number): Ball | null {
    if (!this.canCreateMoreBalls()) {
      return null;
    }
    const ball = this.acquireBall();
    if (!ball) {
      return null;
    }
    ball.reset(source.x, source.y);
    const speed = Math.max(BALL_MIN_SPEED, source.speed || this.options.ballSpeed);
    const baseAngle = source.isAttached ? -Math.PI / 2 : Math.atan2(source.vy, source.vx);
    const angle = baseAngle + angleOffsetRadians;
    ball.launch(Math.cos(angle) * speed, Math.sin(angle) * speed);
    ball.speed = speed;
    this.options.onBallSpawned?.(ball);
    this.refreshMaxBallsReached();
    return ball;
  }

  private canCreateMoreBalls(): boolean {
    const count = this.countActive();
    if (count >= MAX_ACTIVE_BALLS) {
      return false;
    }
    if (this.expansionBlocked && count >= INITIAL_ACTIVE_BALL_LIMIT) {
      return false;
    }
    if (count < this.activeLimit) {
      return true;
    }
    this.activeLimit = Math.min(MAX_ACTIVE_BALLS, this.activeLimit + BALL_LIMIT_GROWTH_STEP);
    return count < this.activeLimit;
  }

  private isCloneLimitBlocked(): boolean {
    return this.expansionBlocked && this.countActive() >= INITIAL_ACTIVE_BALL_LIMIT;
  }

  private refreshMaxBallsReached(): void {
    this.maxBallsReached = Math.max(this.maxBallsReached, this.countActive());
  }
}
