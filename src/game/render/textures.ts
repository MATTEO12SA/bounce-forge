import type Phaser from 'phaser';
import type { BrickKind } from '../levels/levelTypes';
import { getPowerUpDefinition, type PowerUpType } from '../config/powerUps';
import { ballLook, DEFAULT_SKINS, paddleLook, type SkinChoice } from '../config/skins';
import { BRICK_H, BRICK_W, css, paintBrick, roundRect, shade } from './brickArt';
import { paintBall, paintPaddle } from './skinArt';

/**
 * Procedural "Forge lumineuse" art. Every texture is painted once on a 2D canvas at twice the
 * display resolution and reused by batched sprites, which is both prettier and far cheaper than
 * hundreds of vector shapes.
 */

export const TEX = {
  ball: 'bf-ball',
  glow: 'bf-glow',
  ring: 'bf-ring',
  ember: 'bf-ember',
  shard: 'bf-shard',
  spark: 'bf-spark',
  paddle: 'bf-paddle',
  vignette: 'bf-vignette',
  danger: 'bf-danger'
} as const;

function makeCanvas(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void
): void {
  if (scene.textures.exists(key)) {
    return;
  }
  const texture = scene.textures.createCanvas(key, width, height);
  if (!texture) {
    return;
  }
  const ctx = texture.getContext();
  draw(ctx);
  texture.refresh();
}

// ------------------------------------------------------------------ skins

const activeKeys = { paddle: TEX.paddle as string, ball: TEX.ball as string };

/** Paints (once) the chosen skins and makes new paddles and balls use them. */
export function useSkins(scene: Phaser.Scene, skins: SkinChoice): void {
  activeKeys.paddle = `bf-paddle-${skins.paddle}`;
  activeKeys.ball = `bf-ball-${skins.ball}`;
  makeCanvas(scene, activeKeys.paddle, 96, 34, (ctx) => paintPaddle(ctx, paddleLook(skins.paddle)));
  makeCanvas(scene, activeKeys.ball, 64, 64, (ctx) => paintBall(ctx, ballLook(skins.ball)));
}

export function paddleTextureKey(): string {
  return activeKeys.paddle;
}

export function ballTextureKey(): string {
  return activeKeys.ball;
}

// ------------------------------------------------------------------ bricks

export function brickTextureKey(kind: BrickKind, color: number, damage: number): string {
  return `bf-brick-${kind}-${color.toString(16)}-${damage}`;
}

/** Creates (once) and returns the texture for a brick kind, colour and damage stage (0-2). */
export function ensureBrickTexture(
  scene: Phaser.Scene,
  kind: BrickKind,
  color: number,
  damage: number
): string {
  const key = brickTextureKey(kind, color, damage);
  makeCanvas(scene, key, BRICK_W, BRICK_H, (ctx) => paintBrick(ctx, kind, color, damage));
  return key;
}

// ------------------------------------------------------------------ power-ups

export function powerUpTextureKey(type: PowerUpType): string {
  return `bf-power-${type}`;
}

export const POWER_UP_SIZE = { width: 84, height: 44 };

export function ensurePowerUpTexture(
  scene: Phaser.Scene,
  type: PowerUpType,
  color: number
): string {
  const key = powerUpTextureKey(type);
  const w = POWER_UP_SIZE.width * 2;
  const h = POWER_UP_SIZE.height * 2;
  makeCanvas(scene, key, w, h, (ctx) => {
    // Soft outer glow.
    const glow = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, w / 2);
    glow.addColorStop(0, css(color, 0.55));
    glow.addColorStop(1, css(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const px = 12;
    const py = 10;
    const pw = w - px * 2;
    const ph = h - py * 2;
    const body = ctx.createLinearGradient(0, py, 0, py + ph);
    body.addColorStop(0, shade(color, 0.5));
    body.addColorStop(0.5, shade(color, 0));
    body.addColorStop(1, shade(color, -0.4));
    roundRect(ctx, px, py, pw, ph, ph / 2);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.stroke();
    // Gloss.
    roundRect(ctx, px + 10, py + 6, pw - 20, ph * 0.35, ph * 0.18);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fill();

    const definition = getPowerUpDefinition(type);
    if (definition.risk) {
      // Hazard stripes: a risk capsule has a drawback and a score reward.
      ctx.save();
      roundRect(ctx, px, py, pw, ph, ph / 2);
      ctx.clip();
      ctx.fillStyle = 'rgba(20, 8, 6, 0.28)';
      for (let x = px - ph; x < px + pw; x += 22) {
        ctx.beginPath();
        ctx.moveTo(x, py + ph);
        ctx.lineTo(x + 11, py + ph);
        ctx.lineTo(x + 11 + ph, py);
        ctx.lineTo(x + ph, py);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    const icon = definition.icon;
    const size = icon.length >= 3 ? 28 : icon.length === 2 ? 34 : 40;
    ctx.font = `900 ${size}px system-ui, "Segoe UI", "Segoe UI Emoji", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = definition.risk ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.55)';
    ctx.strokeText(icon, w / 2, h / 2 + 2);
    ctx.fillStyle = '#10120e';
    ctx.fillText(icon, w / 2, h / 2 + 2);
  });
  return key;
}

// ------------------------------------------------------------------ ball, paddle, effects

export function createSharedTextures(scene: Phaser.Scene): void {
  // Default ball and paddle (the selected skins get their own textures, see useSkins).
  makeCanvas(scene, TEX.ball, 64, 64, (ctx) => paintBall(ctx, ballLook(DEFAULT_SKINS.ball)));
  makeCanvas(scene, TEX.paddle, 96, 34, (ctx) =>
    paintPaddle(ctx, paddleLook(DEFAULT_SKINS.paddle))
  );

  makeCanvas(scene, TEX.glow, 64, 64, (ctx) => {
    const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    glow.addColorStop(0, 'rgba(255, 255, 255, 1)');
    glow.addColorStop(0.35, 'rgba(255, 255, 255, 0.45)');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 64, 64);
  });

  makeCanvas(scene, TEX.ring, 128, 128, (ctx) => {
    ctx.strokeStyle = 'rgba(255, 255, 255, 1)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(64, 64, 52, 0, Math.PI * 2);
    ctx.stroke();
  });

  makeCanvas(scene, TEX.ember, 16, 16, (ctx) => {
    const glow = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    glow.addColorStop(0, 'rgba(255, 240, 200, 1)');
    glow.addColorStop(0.4, 'rgba(255, 170, 60, 0.7)');
    glow.addColorStop(1, 'rgba(255, 120, 20, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 16, 16);
  });

  makeCanvas(scene, TEX.shard, 10, 6, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(3, 0);
    ctx.lineTo(10, 1);
    ctx.lineTo(7, 6);
    ctx.closePath();
    ctx.fill();
  });

  makeCanvas(scene, TEX.spark, 24, 6, (ctx) => {
    const line = ctx.createLinearGradient(0, 0, 24, 0);
    line.addColorStop(0, 'rgba(255, 255, 255, 0)');
    line.addColorStop(1, 'rgba(255, 255, 255, 1)');
    ctx.fillStyle = line;
    roundRect(ctx, 0, 1, 24, 4, 2);
    ctx.fill();
  });

  makeCanvas(scene, TEX.vignette, 256, 256, (ctx) => {
    const v = ctx.createRadialGradient(128, 110, 40, 128, 128, 182);
    v.addColorStop(0, 'rgba(0, 0, 0, 0)');
    v.addColorStop(1, 'rgba(0, 0, 0, 0.62)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, 256, 256);
  });

  makeCanvas(scene, TEX.danger, 8, 128, (ctx) => {
    const d = ctx.createLinearGradient(0, 0, 0, 128);
    d.addColorStop(0, 'rgba(255, 60, 40, 0)');
    d.addColorStop(1, 'rgba(255, 60, 40, 0.42)');
    ctx.fillStyle = d;
    ctx.fillRect(0, 0, 8, 128);
  });
}
