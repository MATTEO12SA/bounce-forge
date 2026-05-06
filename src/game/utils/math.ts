export interface Vector2Like {
  x: number;
  y: number;
}

export interface PaddleBounceInput {
  ballX: number;
  paddleX: number;
  paddleWidth: number;
  speed: number;
  maxAngleDegrees: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * clamp(amount, 0, 1);
}

export function magnitude(vector: Vector2Like): number {
  return Math.hypot(vector.x, vector.y);
}

export function normalizeVelocity(vector: Vector2Like, targetSpeed: number): Vector2Like {
  const current = magnitude(vector);

  if (current === 0) {
    return { x: 0, y: -targetSpeed };
  }

  const scale = targetSpeed / current;
  return { x: vector.x * scale, y: vector.y * scale };
}

export function clampVelocitySpeed(
  vector: Vector2Like,
  minSpeed: number,
  maxSpeed: number
): Vector2Like {
  const speed = clamp(magnitude(vector), minSpeed, maxSpeed);
  return normalizeVelocity(vector, speed);
}

export function avoidAxisLock(vector: Vector2Like, minAxisSpeed: number): Vector2Like {
  const speed = magnitude(vector);

  if (speed === 0) {
    return { x: minAxisSpeed, y: -minAxisSpeed };
  }

  let x = vector.x;
  let y = vector.y;

  if (Math.abs(x) < minAxisSpeed) {
    x = minAxisSpeed * (x < 0 ? -1 : 1);
  }

  if (Math.abs(y) < minAxisSpeed) {
    y = minAxisSpeed * (y < 0 ? -1 : 1);
  }

  return normalizeVelocity({ x, y }, speed);
}

export function calculatePaddleBounceVelocity(input: PaddleBounceInput): Vector2Like {
  const halfWidth = Math.max(input.paddleWidth / 2, 1);
  const impact = clamp((input.ballX - input.paddleX) / halfWidth, -1, 1);
  const maxAngle = (input.maxAngleDegrees * Math.PI) / 180;
  const angle = -Math.PI / 2 + impact * maxAngle;

  return {
    x: Math.cos(angle) * input.speed,
    y: Math.sin(angle) * input.speed
  };
}

export function rectangleDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  maxDistance: number
): boolean {
  return Math.abs(ax - bx) <= maxDistance && Math.abs(ay - by) <= maxDistance;
}
