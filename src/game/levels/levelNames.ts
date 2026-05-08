export const MAX_LEVEL_NAME_LENGTH = 120;

export function sanitizeLevelName(name: unknown, fallback: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  const safeName = trimmed.length > 0 ? trimmed : fallback;
  return safeName.slice(0, MAX_LEVEL_NAME_LENGTH);
}

export function sanitizeOptionalLevelName(name: unknown): string | undefined {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed.length > 0 ? trimmed.slice(0, MAX_LEVEL_NAME_LENGTH) : undefined;
}
