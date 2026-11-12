import type { BallLook, PaddleLook, TrailLook } from '../config/skins';
import { roundRect } from './brickArt';

/**
 * Canvas painters for the skins, shared by the game textures and the interface previews
 * (no Phaser here).
 */

const rgba = ([r, g, b]: readonly [number, number, number], alpha: number): string =>
  `rgba(${r}, ${g}, ${b}, ${alpha})`;

/** Paddle nine-slice source, 96 × 34. */
export function paintPaddle(ctx: CanvasRenderingContext2D, look: PaddleLook): void {
  const glow = ctx.createLinearGradient(0, 0, 0, 34);
  glow.addColorStop(0, rgba(look.glow, 0));
  glow.addColorStop(0.5, rgba(look.glow, 0.28));
  glow.addColorStop(1, rgba(look.glow, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 96, 34);

  const body = ctx.createLinearGradient(0, 6, 0, 28);
  body.addColorStop(0, look.body[0]);
  body.addColorStop(0.5, look.body[1]);
  body.addColorStop(1, look.body[2]);
  roundRect(ctx, 2, 6, 92, 22, 11);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = look.edge;
  ctx.stroke();
  const caps = ctx.createLinearGradient(0, 6, 0, 28);
  caps.addColorStop(0, look.caps[0]);
  caps.addColorStop(1, look.caps[1]);
  ctx.fillStyle = caps;
  roundRect(ctx, 2, 6, 20, 22, 11);
  ctx.fill();
  roundRect(ctx, 74, 6, 20, 22, 11);
  ctx.fill();
  ctx.fillStyle = look.shine;
  ctx.fillRect(24, 9, 48, 3);
}

/** Ball texture, 64 × 64 (displayed at half size). */
export function paintBall(ctx: CanvasRenderingContext2D, look: BallLook): void {
  const halo = ctx.createRadialGradient(32, 32, 10, 32, 32, 32);
  halo.addColorStop(0, rgba(look.halo, 0.55));
  halo.addColorStop(0.5, rgba(look.halo, 0.18));
  halo.addColorStop(1, rgba(look.halo, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 64, 64);
  const core = ctx.createRadialGradient(27, 26, 2, 32, 32, 16);
  core.addColorStop(0, look.core[0]);
  core.addColorStop(0.6, look.core[1]);
  core.addColorStop(1, look.core[2]);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(32, 32, 16, 0, Math.PI * 2);
  ctx.fill();
  if (look.ring) {
    ctx.strokeStyle = look.ring;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(32, 32, 15, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** Interface preview of a trail: fading dots behind a plain ball, on a canvas of any size. */
export function paintTrailPreview(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  look: TrailLook
): void {
  const y = height / 2;
  const count = 9;
  if (look.tints.length > 0) {
    for (let index = 0; index < count; index += 1) {
      const t = index / (count - 1);
      const tint = look.tints[index % look.tints.length] ?? 0xffffff;
      const x = width * 0.12 + t * width * 0.62;
      const radius = 3 + t * (6 + look.scale * 20);
      const alpha = Math.min(1, 0.15 + t * (look.alpha * 2.2));
      ctx.fillStyle = `rgba(${(tint >> 16) & 255}, ${(tint >> 8) & 255}, ${tint & 255}, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = '#fff4d6';
  ctx.beginPath();
  ctx.arc(width * 0.82, y, Math.min(12, height * 0.3), 0, Math.PI * 2);
  ctx.fill();
}
