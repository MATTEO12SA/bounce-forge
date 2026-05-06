import { normalizeEditorRows, validateEditorRows } from './editorGrid';

const SHARE_PREFIX = 'BF1:';

interface SharedLevelPayload {
  v: 1;
  name?: string;
  rows: string[];
}

function encodeBase64(value: string): string {
  if (typeof btoa === 'function') {
    return btoa(value);
  }

  return Buffer.from(value, 'utf8').toString('base64');
}

function decodeBase64(value: string): string {
  if (typeof atob === 'function') {
    return atob(value);
  }

  return Buffer.from(value, 'base64').toString('utf8');
}

export function encodeCreativeLevelCode(rows: readonly string[], name?: string): string {
  const normalizedRows = normalizeEditorRows(rows);
  const validation = validateEditorRows(normalizedRows);

  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const payload: SharedLevelPayload = {
    v: 1,
    name,
    rows: normalizedRows
  };

  return `${SHARE_PREFIX}${encodeBase64(JSON.stringify(payload))}`;
}

export function decodeCreativeLevelCode(code: string): { name?: string; rows: string[] } {
  const trimmed = code.trim();

  if (!trimmed.startsWith(SHARE_PREFIX)) {
    throw new Error('Invalid Bounce Forge level code.');
  }

  const parsed = JSON.parse(
    decodeBase64(trimmed.slice(SHARE_PREFIX.length))
  ) as Partial<SharedLevelPayload>;

  if (parsed.v !== 1 || !Array.isArray(parsed.rows)) {
    throw new Error('Unsupported Bounce Forge level code.');
  }

  const rows = normalizeEditorRows(parsed.rows);
  const validation = validateEditorRows(rows);

  if (!validation.valid) {
    throw new Error(validation.message);
  }

  return {
    name: typeof parsed.name === 'string' ? parsed.name : undefined,
    rows
  };
}
