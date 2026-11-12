import Phaser from 'phaser';
import type { Brick } from '../entities/Brick';
import { ensureBrickTexture, TEX } from '../render/textures';
import {
  DEPTHS,
  PLAYFIELD_LEFT,
  PLAYFIELD_RIGHT,
  PLAYFIELD_TOP,
  WORLD_HEIGHT
} from '../utils/constants';
import {
  aimSpeed,
  BOSS_BOLT_SPEED,
  BOSS_INVULNERABLE_MS,
  BOSS_TELEGRAPH_MS,
  bossDamage,
  bossMaxHealth,
  bossPhase,
  boltHitsPaddle,
  PHASE_TIMING,
  volleySpeeds,
  type BossPhase
} from './boss';
import { groupCells, moveGroup } from './mechanics';

/** What the boss needs from the game scene. */
export interface BossHost {
  readonly scene: Phaser.Scene;
  readonly reducedMotion: boolean;
  gridCols(): number;
  isCellFree(col: number, row: number): boolean;
  /** Moves a whole group one cell sideways (grid and sprites). */
  moveCells(cells: readonly Brick[], dx: 1 | -1): void;
  paddle(): { x: number; top: number; width: number };
  /** X of the ball closest to the boss (for its eye), or null. */
  watchX(): number | null;
  /** Breaks one boss cell for good (score, counters, victory check). */
  breakCell(brick: Brick): void;
  onHit(x: number, y: number, phaseChanged: boolean): void;
  onDefeated(x: number, y: number): void;
  onPaddleHit(x: number): void;
  onFire(x: number): void;
}

interface Boss {
  cells: Brick[];
  health: number;
  maxHealth: number;
  phase: BossPhase;
  dir: 1 | -1;
  moveClock: number;
  fireClock: number;
  warned: boolean;
  invulnerableUntil: number;
  defeated: boolean;
  eye: Phaser.GameObjects.Graphics;
}

interface Bolt {
  sprite: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
}

const BOSS_COLOR = 0x9b2335;
const BAR_WIDTH = 520;

export class BossController {
  private readonly bosses: Boss[] = [];
  private readonly bolts: Bolt[] = [];
  private bar: Phaser.GameObjects.Graphics | null = null;
  private label: Phaser.GameObjects.Text | null = null;
  private time = 0;

  public constructor(
    private readonly host: BossHost,
    bossCells: Brick[]
  ) {
    groupCells(bossCells).forEach((cells, index) => {
      const maxHealth = bossMaxHealth(cells.length);
      this.bosses.push({
        cells,
        health: maxHealth,
        maxHealth,
        phase: 1,
        dir: index % 2 === 0 ? 1 : -1,
        moveClock: 0,
        // Staggered so twin bosses do not fire together; the first volley comes after a while.
        fireClock: -1200 - index * 900,
        warned: false,
        invulnerableUntil: 0,
        defeated: false,
        eye: host.scene.add.graphics().setDepth(DEPTHS.bricks + 2)
      });
    });
    if (this.bosses.length > 0) {
      this.bar = host.scene.add.graphics().setDepth(DEPTHS.overlay - 1);
      this.label = host.scene.add
        .text(540, PLAYFIELD_TOP + 8, '', {
          fontFamily: 'system-ui, "Segoe UI", Arial, sans-serif',
          fontSize: '20px',
          fontStyle: '800',
          color: '#ffd6d6'
        })
        .setOrigin(0.5, 0)
        .setDepth(DEPTHS.overlay);
      this.drawBar();
    }
  }

  public get active(): boolean {
    return this.bosses.some((boss) => !boss.defeated);
  }

  /** Total health left over total health (for the HUD). */
  public get ratio(): number {
    const max = this.bosses.reduce((sum, boss) => sum + boss.maxHealth, 0);
    const left = this.bosses.reduce((sum, boss) => sum + Math.max(0, boss.health), 0);
    return max > 0 ? left / max : 0;
  }

  public setLabel(text: string): void {
    this.label?.setText(text);
  }

  /** A ball, laser or explosion hit a boss cell. */
  public hit(brick: Brick, amount: number): void {
    const boss = this.bosses.find((item) => !item.defeated && item.cells.includes(brick));
    if (!boss || this.time < boss.invulnerableUntil) return;
    boss.invulnerableUntil = this.time + BOSS_INVULNERABLE_MS;
    boss.health = Math.max(0, boss.health - bossDamage(amount));
    const phase = bossPhase(boss.health, boss.maxHealth);
    const phaseChanged = phase !== boss.phase && boss.health > 0;
    if (phaseChanged) {
      boss.phase = phase;
      const texture = ensureBrickTexture(this.host.scene, 'boss', BOSS_COLOR, phase - 1);
      boss.cells.forEach((cell) => cell.active && cell.setTexture(texture));
    }
    boss.cells.forEach((cell) => cell.active && cell.flash(45));
    this.drawBar();
    const center = this.center(boss);
    if (boss.health <= 0) {
      this.defeat(boss, center);
      return;
    }
    this.host.onHit(center.x, center.y, phaseChanged);
  }

  public update(deltaMs: number): void {
    this.time += deltaMs;
    for (const boss of this.bosses) {
      if (boss.defeated) continue;
      const timing = PHASE_TIMING[boss.phase];
      boss.moveClock += deltaMs;
      if (boss.moveClock >= timing.moveMs) {
        boss.moveClock = 0;
        this.move(boss);
      }
      boss.fireClock += deltaMs;
      if (!boss.warned && boss.fireClock >= timing.fireMs - BOSS_TELEGRAPH_MS) {
        boss.warned = true;
        boss.cells.forEach((cell) => cell.active && cell.setTint(0xff9a9a));
      }
      if (boss.fireClock >= timing.fireMs) {
        boss.fireClock = 0;
        boss.warned = false;
        boss.cells.forEach((cell) => cell.active && cell.clearTint());
        this.fire(boss, timing.shots);
      }
      this.drawEye(boss);
    }
    this.updateBolts(deltaMs / 1000);
  }

  public destroy(): void {
    this.bolts.forEach((bolt) => bolt.sprite.destroy());
    this.bolts.length = 0;
    this.bosses.forEach((boss) => boss.eye.destroy());
    this.bar?.destroy();
    this.label?.destroy();
  }

  // ---------------------------------------------------------------- internals

  private center(boss: Boss): { x: number; y: number } {
    const cells = boss.cells.filter((cell) => cell.active);
    const list = cells.length > 0 ? cells : boss.cells;
    return {
      x: list.reduce((sum, cell) => sum + cell.x, 0) / list.length,
      y: list.reduce((sum, cell) => sum + cell.y, 0) / list.length
    };
  }

  private move(boss: Boss): void {
    const step = moveGroup(
      boss.cells.filter((cell) => cell.active),
      boss.dir,
      this.host.gridCols(),
      (col, row) => this.host.isCellFree(col, row)
    );
    if (!step) return;
    boss.dir = step.dir;
    this.host.moveCells(
      boss.cells.filter((cell) => cell.active),
      step.dx
    );
  }

  private fire(boss: Boss, shots: number): void {
    const cells = boss.cells.filter((cell) => cell.active);
    if (cells.length === 0) return;
    const center = this.center(boss);
    const bottom = Math.max(...cells.map((cell) => cell.box.bottom));
    const paddle = this.host.paddle();
    const aim = aimSpeed(center.x, paddle.x, paddle.top - bottom);
    volleySpeeds(shots, aim).forEach((vx) => {
      const sprite = this.host.scene.add
        .image(center.x, bottom + 10, TEX.glow)
        .setTint(0xff4040)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDisplaySize(34, 34)
        .setDepth(DEPTHS.ball - 1);
      this.bolts.push({ sprite, vx, vy: BOSS_BOLT_SPEED });
    });
    this.host.onFire(center.x);
  }

  private updateBolts(dt: number): void {
    const paddle = this.host.paddle();
    for (let index = this.bolts.length - 1; index >= 0; index -= 1) {
      const bolt = this.bolts[index]!;
      bolt.sprite.x += bolt.vx * dt;
      bolt.sprite.y += bolt.vy * dt;
      if (bolt.sprite.x < PLAYFIELD_LEFT + 10 || bolt.sprite.x > PLAYFIELD_RIGHT - 10) {
        bolt.vx = -bolt.vx;
      }
      if (!this.host.reducedMotion) bolt.sprite.setAngle(bolt.sprite.angle + 540 * dt);
      const hitPaddle = boltHitsPaddle(
        bolt.sprite.x,
        bolt.sprite.y,
        paddle.x,
        paddle.top,
        paddle.width
      );
      if (hitPaddle || bolt.sprite.y > WORLD_HEIGHT + 40) {
        if (hitPaddle) this.host.onPaddleHit(bolt.sprite.x);
        bolt.sprite.destroy();
        this.bolts.splice(index, 1);
      }
    }
  }

  private defeat(boss: Boss, center: { x: number; y: number }): void {
    boss.defeated = true;
    boss.eye.destroy();
    this.bolts.forEach((bolt) => bolt.sprite.destroy());
    this.bolts.length = 0;
    this.drawBar();
    const cells = boss.cells
      .filter((cell) => cell.active)
      .sort(
        (a, b) =>
          Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y)
      );
    // The armour falls apart from the core outwards.
    cells.forEach((cell, index) => {
      this.host.scene.time.delayedCall(this.host.reducedMotion ? 0 : index * 12, () => {
        if (cell.active) this.host.breakCell(cell);
      });
    });
    this.host.onDefeated(center.x, center.y);
  }

  private drawEye(boss: Boss): void {
    const { x, y } = this.center(boss);
    const cells = boss.cells.filter((cell) => cell.active);
    const width = cells.length
      ? Math.max(...cells.map((cell) => cell.box.right)) -
        Math.min(...cells.map((cell) => cell.box.left))
      : 0;
    // Bigger bosses get a bigger eye.
    const k = Math.max(1, Math.min(2.2, width / 260));
    const target = this.host.watchX();
    const look = target === null ? 0 : Math.max(-1, Math.min(1, (target - x) / 300));
    const eye = boss.eye;
    eye.clear();
    eye.fillStyle(0x1a0507, 0.9).fillEllipse(x, y, 58 * k, 34 * k);
    eye.fillStyle(0xfff1e6, 1).fillEllipse(x, y, 50 * k, 28 * k);
    const irisColor = boss.phase === 3 ? 0xff2a2a : boss.phase === 2 ? 0xff7a2a : 0xffb423;
    eye.fillStyle(irisColor, 1).fillCircle(x + look * 12 * k, y + 2 * k, 11 * k);
    eye.fillStyle(0x120406, 1).fillCircle(x + look * 13 * k, y + 2 * k, 5 * k);
  }

  private drawBar(): void {
    if (!this.bar) return;
    const bar = this.bar;
    bar.clear();
    if (!this.active) {
      this.label?.setVisible(false);
      return;
    }
    const left = 540 - BAR_WIDTH / 2;
    const top = PLAYFIELD_TOP + 34;
    const ratio = this.ratio;
    const phase = bossPhase(ratio, 1);
    bar.fillStyle(0x000000, 0.55).fillRoundedRect(left - 4, top - 4, BAR_WIDTH + 8, 18, 9);
    bar.fillStyle(phase === 3 ? 0xff2a2a : phase === 2 ? 0xff7a2a : 0xffb423, 1);
    bar.fillRoundedRect(left, top, Math.max(6, BAR_WIDTH * ratio), 10, 5);
  }
}
