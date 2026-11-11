import type { BrickKind } from '../levels/levelTypes';

/**
 * Brick artwork painted on a 2D canvas. Kept free of Phaser so the HTML level editor draws
 * exactly the same bricks as the game.
 */

export const BRICK_W = 44;
export const BRICK_H = 40;

export function rgb(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

export function shade(color: number, amount: number): string {
  const [r, g, b] = rgb(color);
  const mix = (channel: number): number =>
    Math.round(amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

export function css(color: number, alpha = 1): string {
  const [r, g, b] = rgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function roundRect(
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

export function paintBrick(
  ctx: CanvasRenderingContext2D,
  kind: BrickKind,
  color: number,
  damage: number
): void {
  const w = BRICK_W;
  const h = BRICK_H;
  const r = 7;
  if (kind === 'bumper') {
    paintBumper(ctx, color, w, h);
    return;
  }
  if (kind === 'teleporter') {
    paintPortal(ctx, color, w, h);
    return;
  }
  const steel = kind === 'indestructible' || kind === 'gate';
  // Ghost bricks are glassy: the game hides them until the first touch.
  ctx.save();
  if (kind === 'invisible') ctx.globalAlpha = 0.55;

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
  if (kind === 'invisible') {
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

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
    case 'crystal': {
      // Faceted gem.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.strokeStyle = shade(color, -0.5);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 11);
      ctx.lineTo(cx + 9, cy - 3);
      ctx.lineTo(cx, cy + 11);
      ctx.lineTo(cx - 9, cy - 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 9, cy - 3);
      ctx.lineTo(cx + 9, cy - 3);
      ctx.moveTo(cx, cy - 11);
      ctx.lineTo(cx, cy + 11);
      ctx.stroke();
      break;
    }
    case 'key': {
      ctx.strokeStyle = shade(color, -0.6);
      ctx.fillStyle = shade(color, -0.6);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx - 8, cy, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillRect(cx - 3, cy - 1.5, 15, 3);
      ctx.fillRect(cx + 6, cy, 3, 6);
      ctx.fillRect(cx + 10, cy, 2.5, 4);
      break;
    }
    case 'gate': {
      // Bars and a padlock: closed until every key is broken.
      ctx.fillStyle = 'rgba(20, 16, 10, 0.55)';
      [10, 18, 26, 34].forEach((x) => ctx.fillRect(x, 5, 3, h - 10));
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(cx - 6, cy - 1, 12, 9);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy - 2, 4.5, Math.PI, 0);
      ctx.stroke();
      break;
    }
    case 'phoenix': {
      // Flame that comes back.
      const flame = ctx.createLinearGradient(0, cy - 12, 0, cy + 10);
      flame.addColorStop(0, '#fff4c2');
      flame.addColorStop(1, '#ff5a1f');
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 12);
      ctx.quadraticCurveTo(cx + 11, cy, cx + 5, cy + 9);
      ctx.quadraticCurveTo(cx, cy + 12, cx - 5, cy + 9);
      ctx.quadraticCurveTo(cx - 11, cy, cx, cy - 12);
      ctx.fill();
      break;
    }
    case 'invisible': {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.font = '900 20px system-ui, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', cx, cy);
      break;
    }
    case 'mover': {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.beginPath();
      ctx.moveTo(cx - 14, cy);
      ctx.lineTo(cx - 6, cy - 7);
      ctx.lineTo(cx - 6, cy + 7);
      ctx.closePath();
      ctx.moveTo(cx + 14, cy);
      ctx.lineTo(cx + 6, cy - 7);
      ctx.lineTo(cx + 6, cy + 7);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(cx - 6, cy - 2, 12, 4);
      break;
    }
    case 'fuse': {
      ctx.strokeStyle = '#2a160a';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(6, cy + 4);
      ctx.lineTo(14, cy - 4);
      ctx.lineTo(22, cy + 4);
      ctx.lineTo(30, cy - 4);
      ctx.lineTo(38, cy + 4);
      ctx.stroke();
      ctx.fillStyle = '#fff2b0';
      ctx.beginPath();
      ctx.arc(38, cy + 4, 3, 0, Math.PI * 2);
      ctx.fill();
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

function paintBumper(ctx: CanvasRenderingContext2D, color: number, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) / 2 - 2;
  const body = ctx.createRadialGradient(cx - 5, cy - 6, 2, cx, cy, radius);
  body.addColorStop(0, shade(color, 0.7));
  body.addColorStop(0.55, shade(color, 0));
  body.addColorStop(1, shade(color, -0.5));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
}

function paintPortal(ctx: CanvasRenderingContext2D, color: number, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) / 2 - 1;
  const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, radius);
  glow.addColorStop(0, '#0b0614');
  glow.addColorStop(0.55, shade(color, -0.6));
  glow.addColorStop(0.8, shade(color, 0.2));
  glow.addColorStop(1, css(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = shade(color, 0.6);
  ctx.lineWidth = 2;
  for (let index = 0; index < 3; index += 1) {
    ctx.beginPath();
    const start = (index * Math.PI * 2) / 3;
    ctx.arc(cx, cy, radius - 6, start, start + Math.PI / 2);
    ctx.stroke();
  }
}
