import { normalizeEditorRows, validateEditorRows } from './editorGrid';
import { sanitizeOptionalLevelName } from './levelNames';
import { sanitizeLevelOptions, type LevelOptions } from './levelOptions';

/** Legacy codes: base64 of a Latin-1 JSON string. Non-ASCII names could not be encoded. */
const LEGACY_PREFIX = 'BF1:';
/** Current codes: base64url of UTF-8 JSON, safe for accents and emoji. */
const SHARE_PREFIX = 'BF2:';
/** Same as BF2, plus level settings (power-ups, lives, events). Used only when settings exist. */
const OPTIONS_PREFIX = 'BF3:';

interface SharedLevelPayload {
  v: 1 | 2 | 3;
  name?: string;
  rows: string[];
  options?: LevelOptions;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function toBase64Url(value: string): string {
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return base64 + '='.repeat((4 - (base64.length % 4)) % 4);
}

export function encodeCreativeLevelCode(
  rows: readonly string[],
  name?: string,
  options?: LevelOptions
): string {
  const normalizedRows = normalizeEditorRows(rows);
  const validation = validateEditorRows(normalizedRows);

  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const payload: SharedLevelPayload = {
    v: 2,
    rows: normalizedRows
  };
  const safeName = sanitizeOptionalLevelName(name);

  if (safeName) {
    payload.name = safeName;
  }

  const cleanOptions = sanitizeLevelOptions(options);
  if (cleanOptions) {
    payload.v = 3;
    payload.options = cleanOptions;
  }

  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const prefix = cleanOptions ? OPTIONS_PREFIX : SHARE_PREFIX;
  return `${prefix}${toBase64Url(bytesToBase64(bytes))}`;
}

function parsePayload(code: string): Partial<SharedLevelPayload> {
  if (code.startsWith(SHARE_PREFIX) || code.startsWith(OPTIONS_PREFIX)) {
    const bytes = base64ToBytes(fromBase64Url(code.slice(SHARE_PREFIX.length)));
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    ) as Partial<SharedLevelPayload>;
  }

  if (code.startsWith(LEGACY_PREFIX)) {
    const binary =
      typeof atob === 'function'
        ? atob(code.slice(LEGACY_PREFIX.length))
        : Buffer.from(code.slice(LEGACY_PREFIX.length), 'base64').toString('latin1');
    return JSON.parse(binary) as Partial<SharedLevelPayload>;
  }

  throw new Error('Invalid Bounce Forge level code.');
}

export function decodeCreativeLevelCode(code: string): {
  name?: string;
  rows: string[];
  options?: LevelOptions;
} {
  const trimmed = code.trim().replace(/\s+/g, '');
  let parsed: Partial<SharedLevelPayload>;

  try {
    parsed = parsePayload(trimmed);
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid Bounce Forge level code.') {
      throw error;
    }
    throw new Error('Corrupted Bounce Forge level code.', { cause: error });
  }

  if ((parsed.v !== 1 && parsed.v !== 2 && parsed.v !== 3) || !Array.isArray(parsed.rows)) {
    throw new Error('Unsupported Bounce Forge level code.');
  }

  const rows = normalizeEditorRows(parsed.rows);
  const validation = validateEditorRows(rows);

  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const options = parsed.v === 3 ? sanitizeLevelOptions(parsed.options) : undefined;
  return {
    name: sanitizeOptionalLevelName(parsed.name),
    rows,
    ...(options ? { options } : {})
  };
}
