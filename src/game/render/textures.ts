import type Phaser from 'phaser';
import type { BrickKind } from '../levels/levelTypes';
import type { PowerUpType } from '../systems/PowerUpSystem';

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

export const BRICK_TEXTURE_SCALE = 2;
const BRICK_W = 44;
const BRICK_H = 40;

function rgb(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

function shade(color: number, amount: number): string {
  const [r, g, b] = rgb(color);
  const mix = (channel: number): number =>
    Math.round(amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function css(color: number, alpha = 1): string {
  const [r, g, b] = rgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

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

function paintBrick(
  ctx: CanvasRenderingContext2D,
  kind: BrickKind,
  color: number,
  damage: number
): void {
  const w = BRICK_W;
  const h = BRICK_H;
  const r = 7;
  const steel = kind === 'indestructible';

  // Body gradient.
  const body = ctx.createLinearGradient(0, 0, 0, h);
  body.addColorStop(0, shade(color, steel ? 0.35 : 0.42));
  body.addColorStop(0.45, shade(color, 0));
  body.addColorStop(1, shade(color, steel ? -0.45 : -0.38));
  roundRect(ctx, 1, 1, w - 2, h - 2, r);
  ctx.fillStyle = body;
  ctx.fill();

  // Bevel: light top-left edge, dark bottom-right edge.
  ctx.save();
  roundRect(ctx, 1, 1, w - 2, h - 2, r);
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.fillRect(0, 0, w, 3);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.fillRect(0, 0, 3, h);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.fillRect(0, h - 4, w, 4);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.fillRect(w - 3, 0, 3, h);
  // Glossy highlight.
  const gloss = ctx.createLinearGradient(0, 2, 0, h * 0.5);
  gloss.addColorStop(0, 'rgba(255, 255, 255, 0.32)');
  gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gloss;
  roundRect(ctx, 4, 3, w - 8, h * 0.42, r - 2);
  ctx.fill();

  if (steel) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    for (let x = -h; x < w; x += 5) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + h, 0);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Outline.
  roundRect(ctx, 1, 1, w - 2, h - 2, r);
  ctx.lineWidth = 2;
  ctx.strokeStyle = steel ? 'rgba(20, 18, 15, 0.9)' : css(0x1a1206, 0.7);
  ctx.stroke();

  paintSymbol(ctx, kind, color, w, h);
  if (damage > 0) {
    paintCracks(ctx, damage, w, h);
  }
}

function paintSymbol(
  ctx: CanvasRenderingContext2D,
  kind: BrickKind,
  color: number,
  w: number,
  h: number
): void {
  const cx = w / 2;
  const cy = h / 2 + 1;
  ctx.save();
  switch (kind) {
    case 'resistant': {
      // Armour plate inset with two rivets.
      roundRect(ctx, 7, 8, w - 14, h - 15, 3);
      ctx.lineWidth = 2;
      ctx.strokeStyle = shade(color, -0.45);
      ctx.stroke();
      ctx.fillStyle = shade(color, -0.5);
      [11, w - 11].forEach((x) => {
        ctx.beginPath();
        ctx.arc(x, cy, 2.2, 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    }
    case 'explosive': {
      // Bomb with fuse and spark.
      ctx.fillStyle = '#1a1110';
      ctx.beginPath();
      ctx.arc(cx, cy + 2, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.beginPath();
      ctx.arc(cx - 3, cy - 1, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1a1110';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx + 5, cy - 5);
      ctx.quadraticCurveTo(cx + 9, cy - 11, cx + 13, cy - 9);
      ctx.stroke();
      ctx.fillStyle = '#fff2b0';
      ctx.beginPath();
      ctx.arc(cx + 13.5, cy - 9.5, 2.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'bonus': {
      // Five-point star.
      ctx.fillStyle = '#f6fff9';
      ctx.strokeStyle = shade(color, -0.45);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let index = 0; index < 10; index += 1) {
        const radius = index % 2 === 0 ? 11 : 4.6;
        const angle = -Math.PI / 2 + (index * Math.PI) / 5;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'shield': {
      // Shield crest.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.strokeStyle = shade(color, -0.55);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 11);
      ctx.lineTo(cx + 9, cy - 7);
      ctx.quadraticCurveTo(cx + 9, cy + 6, cx, cy + 11);
      ctx.quadraticCurveTo(cx - 9, cy + 6, cx - 9, cy - 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = shade(color, -0.25);
      ctx.fillRect(cx - 1.5, cy - 7, 3, 14);
      break;
    }
    case 'indestructible': {
      // Corner rivets.
      [
        [7, 8],
        [w - 7, 8],
        [7, h - 9],
        [w - 7, h - 9]
      ].forEach(([x, y]) => {
        ctx.fillStyle = '#2a2722';
        ctx.beginPath();
        ctx.arc(x ?? 0, y ?? 0, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.beginPath();
        ctx.arc((x ?? 0) - 0.8, (y ?? 0) - 0.8, 1.2, 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    }
    case 'standard':
    default: {
      // Small forged notch so plain bricks still read as bricks.
      ctx.fillStyle = shade(color, -0.3);
      ctx.fillRect(cx - 7, cy + 5, 14, 2);
      break;
    }
  }
  ctx.restore();
}

function paintCracks(ctx: CanvasRenderingContext2D, damage: number, w: number, h: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(20, 10, 4, 0.75)';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  const crack = (points: Array<[number, number]>): void => {
    ctx.beginPath();
    points.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
  };
  crack([
    [w * 0.18, 2],
    [w * 0.3, h * 0.35],
    [w * 0.22, h * 0.6],
    [w * 0.36, h - 2]
  ]);
  if (damage >= 2) {
    crack([
      [w - 3, h * 0.2],
      [w * 0.7, h * 0.42],
      [w * 0.78, h * 0.7],
      [w * 0.6, h - 2]
    ]);
    crack([
      [w * 0.3, h * 0.35],
      [w * 0.55, h * 0.5]
    ]);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    roundRect(ctx, 1, 1, w - 2, h - 2, 7);
    ctx.fill();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ power-ups

export function powerUpTextureKey(type: PowerUpType): string {
  return `bf-power-${type}`;
}

const POWER_ICONS: Record<PowerUpType, string> = {
  multiBall: '×3',
  splitBall: '×2',
  widePaddle: '↔',
  stickyPaddle: 'AIM',
  extraLife: '♥'
};

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

    ctx.fillStyle = '#10120e';
    ctx.font = `900 ${type === 'stickyPaddle' ? 30 : 38}px system-ui, "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(POWER_ICONS[type], w / 2, h / 2 + 2);
  });
  return key;
}

// ------------------------------------------------------------------ ball, paddle, effects

export function createSharedTextures(scene: Phaser.Scene): void {
  // Ball: white-hot core with an amber halo. Displayed at half size.
  makeCanvas(scene, TEX.ball, 64, 64, (ctx) => {
    const halo = ctx.createRadialGradient(32, 32, 10, 32, 32, 32);
    halo.addColorStop(0, 'rgba(255, 196, 80, 0.55)');
    halo.addColorStop(0.5, 'rgba(255, 150, 40, 0.18)');
    halo.addColorStop(1, 'rgba(255, 120, 20, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, 64, 64);
    const core = ctx.createRadialGradient(27, 26, 2, 32, 32, 16);
    core.addColorStop(0, '#ffffff');
    core.addColorStop(0.6, '#fff4d6');
    core.addColorStop(1, '#ffc65a');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(32, 32, 16, 0, Math.PI * 2);
    ctx.fill();
  });

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

  // Paddle (nine-slice source, 1:1 scale): pale metal body with glowing amber ends.
  makeCanvas(scene, TEX.paddle, 96, 34, (ctx) => {
    const glow = ctx.createLinearGradient(0, 0, 0, 34);
    glow.addColorStop(0, 'rgba(255, 170, 40, 0)');
    glow.addColorStop(0.5, 'rgba(255, 170, 40, 0.28)');
    glow.addColorStop(1, 'rgba(255, 170, 40, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 96, 34);

    const body = ctx.createLinearGradient(0, 6, 0, 28);
    body.addColorStop(0, '#fffaf0');
    body.addColorStop(0.5, '#e9dfcb');
    body.addColorStop(1, '#a8987a');
    roundRect(ctx, 2, 6, 92, 22, 11);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffb423';
    ctx.stroke();
    // Amber end caps.
    const caps = ctx.createLinearGradient(0, 6, 0, 28);
    caps.addColorStop(0, '#ffd27a');
    caps.addColorStop(1, '#e07b10');
    ctx.fillStyle = caps;
    roundRect(ctx, 2, 6, 20, 22, 11);
    ctx.fill();
    roundRect(ctx, 74, 6, 20, 22, 11);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillRect(24, 9, 48, 3);
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
