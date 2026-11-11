import type { BrickKind, LevelDefinition } from '../game/levels/levelTypes';

const KIND_COLORS: Record<BrickKind, string> = {
  standard: '#ffb423',
  resistant: '#ffd36b',
  explosive: '#ff6b3d',
  bonus: '#5fe0a8',
  shield: '#7fb2d9',
  indestructible: '#5b5750'
};

/** Draws a crisp miniature of a level (bricks only) without loading the game engine. */
export function drawLevelPreview(
  canvas: HTMLCanvasElement,
  level: Pick<LevelDefinition, 'bricks'>,
  options: { dim?: boolean } = {}
): void {
  const ratio = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);

  const bricks = level.bricks;
  if (bricks.length === 0) {
    return;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  bricks.forEach((brick) => {
    minX = Math.min(minX, brick.x - brick.width / 2);
    maxX = Math.max(maxX, brick.x + brick.width / 2);
    minY = Math.min(minY, brick.y - brick.height / 2);
    maxY = Math.max(maxY, brick.y + brick.height / 2);
  });

  // Always show the full playfield width so layouts keep their real proportions.
  minX = Math.min(minX, 112);
  maxX = Math.max(maxX, 968);
  const pad = 10;
  const scale = Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY));
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;

  ctx.globalAlpha = options.dim ? 0.35 : 1;
  bricks.forEach((brick) => {
    ctx.fillStyle = KIND_COLORS[brick.kind];
    const w = Math.max(1, brick.width * scale - 0.6);
    const h = Math.max(1, brick.height * scale - 0.6);
    ctx.fillRect(
      offsetX + (brick.x - brick.width / 2 - minX) * scale,
      offsetY + (brick.y - brick.height / 2 - minY) * scale,
      w,
      h
    );
  });
}
