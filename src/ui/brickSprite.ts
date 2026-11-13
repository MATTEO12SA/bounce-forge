import { brickLookForSymbol } from '../game/levels/levelFactory';
import { BRICK_H, BRICK_W, paintBrick } from '../game/render/brickArt';

const spriteCache = new Map<string, HTMLCanvasElement>();

/** The game's own brick art for a symbol, painted once. */
export function brickSprite(symbol: string): HTMLCanvasElement | null {
  const cached = spriteCache.get(symbol);
  if (cached) return cached;
  const look = brickLookForSymbol(symbol);
  if (!look) return null;
  const canvas = document.createElement('canvas');
  canvas.width = BRICK_W;
  canvas.height = BRICK_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paintBrick(ctx, look.kind, look.color, 0);
  spriteCache.set(symbol, canvas);
  return canvas;
}
