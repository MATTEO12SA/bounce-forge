import { normalizeEditorRows, validateEditorRows } from '../game/levels/editorGrid';
import { sanitizeLevelOptions } from '../game/levels/levelOptions';
import { sanitizeOptionalLevelName } from '../game/levels/levelNames';
import {
  CommunityError,
  type CommunityErrorCode,
  type CommunityLevel,
  type CreationSummary,
  type SortKey
} from './types';

/**
 * Pure rules of the community library (no network): validation before publishing, sorting,
 * parsing of server rows and errors. The server checks the same things again.
 */

export const NICKNAME_PATTERN = /^[\p{L}\p{N} _.-]{3,20}$/u;
export const TITLE_MIN = 3;
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 300;
export const CAMPAIGN_MIN = 2;
export const CAMPAIGN_MAX = 24;
export const PAGE_SIZE = 24;

export function validNickname(nickname: string): boolean {
  return NICKNAME_PATTERN.test(nickname.trim());
}

/** Turns a saved level into the published format, or throws `invalid_level`. */
export function toCommunityLevel(
  name: string,
  rows: readonly string[],
  options?: unknown
): CommunityLevel {
  const normalized = normalizeEditorRows(rows);
  if (!validateEditorRows(normalized).valid) {
    throw new CommunityError('invalid_level');
  }
  const cleanOptions = sanitizeLevelOptions(options);
  return {
    name: sanitizeOptionalLevelName(name) ?? 'Level',
    rows: normalized,
    ...(cleanOptions ? { options: cleanOptions } : {})
  };
}

/** Checks a publication before sending it; returns the first problem found. */
export function checkPublication(input: {
  kind: 'level' | 'campaign';
  title: string;
  description: string;
  levels: readonly CommunityLevel[];
}): CommunityErrorCode | null {
  const title = input.title.trim();
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) return 'invalid_title';
  if (input.description.length > DESCRIPTION_MAX) return 'invalid_description';
  const count = input.levels.length;
  if (input.kind === 'level' && count !== 1) return 'invalid_level_count';
  if (input.kind === 'campaign' && (count < CAMPAIGN_MIN || count > CAMPAIGN_MAX)) {
    return 'invalid_level_count';
  }
  const valid = input.levels.every(
    (level) => level.rows.length === 58 && validateEditorRows(level.rows).valid
  );
  return valid ? null : 'invalid_level';
}

/** Database ordering for each sort of the library. */
export function sortOrder(sort: SortKey): Array<{ column: string; ascending: boolean }> {
  switch (sort) {
    case 'new':
      return [{ column: 'created_at', ascending: false }];
    case 'played':
      return [
        { column: 'plays', ascending: false },
        { column: 'created_at', ascending: false }
      ];
    case 'easy':
      return [
        { column: 'difficulty', ascending: true },
        { column: 'likes', ascending: false }
      ];
    case 'hard':
      return [
        { column: 'difficulty', ascending: false },
        { column: 'likes', ascending: false }
      ];
    case 'popular':
    default:
      return [
        { column: 'likes', ascending: false },
        { column: 'plays', ascending: false },
        { column: 'created_at', ascending: false }
      ];
  }
}

/** Escapes a search for a SQL `ilike` pattern. */
export function searchPattern(search: string): string | null {
  const clean = search.trim().slice(0, 40);
  if (clean.length < 2) return null;
  return `%${clean.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

const KNOWN_ERRORS: CommunityErrorCode[] = [
  'auth_required',
  'nickname_required',
  'publish_banned',
  'rate_limited',
  'invalid_level',
  'invalid_level_count',
  'invalid_title',
  'invalid_description',
  'too_large',
  'not_found'
];

/** Maps a Supabase / PostgREST / network error to a code the interface can explain. */
export function errorCode(error: unknown): CommunityErrorCode {
  if (error instanceof CommunityError) return error.code;
  const source = (error ?? {}) as { code?: string; message?: string; name?: string };
  const message = String(source.message ?? '');
  if (source.code === '23505') return 'nickname_taken';
  if (source.code === '23514') return 'nickname_invalid';
  const known = KNOWN_ERRORS.find((code) => message.includes(code));
  if (known) return known;
  if (source.name === 'TypeError' || /fetch|network|Failed to fetch|NetworkError/i.test(message)) {
    return 'offline';
  }
  return 'unknown';
}

interface CreationRow {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  level_count: number;
  difficulty: number;
  plays: number;
  likes: number;
  status: string;
  created_at: string;
  updated_at: string;
  version?: number;
  levels?: unknown;
  preview?: unknown;
  author?: { nickname?: string } | Array<{ nickname?: string }> | null;
}

function parseLevel(value: unknown): CommunityLevel | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as { name?: unknown; rows?: unknown; options?: unknown };
  if (!Array.isArray(source.rows)) return null;
  const rows = normalizeEditorRows(
    source.rows.filter((row): row is string => typeof row === 'string')
  );
  if (!validateEditorRows(rows).valid) return null;
  const options = sanitizeLevelOptions(source.options);
  return {
    name: sanitizeOptionalLevelName(source.name) ?? 'Level',
    rows,
    ...(options ? { options } : {})
  };
}

/** Parses a row from the `creations` table (untrusted data). */
export function parseCreation(row: CreationRow): CreationSummary & {
  levels: CommunityLevel[];
  version: number;
} {
  const author = Array.isArray(row.author) ? row.author[0] : row.author;
  const levels = Array.isArray(row.levels)
    ? row.levels.map(parseLevel).filter((level): level is CommunityLevel => level !== null)
    : [];
  return {
    id: String(row.id),
    kind: row.kind === 'campaign' ? 'campaign' : 'level',
    title: String(row.title ?? '').slice(0, TITLE_MAX),
    description: String(row.description ?? '').slice(0, DESCRIPTION_MAX),
    levelCount: Number(row.level_count) || levels.length || 1,
    difficulty: Math.max(1, Math.min(5, Number(row.difficulty) || 1)),
    plays: Math.max(0, Number(row.plays) || 0),
    likes: Math.max(0, Number(row.likes) || 0),
    status: (['published', 'unlisted', 'review', 'removed'].includes(row.status)
      ? row.status
      : 'published') as CreationSummary['status'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    author: String(author?.nickname ?? '?').slice(0, 20),
    preview: parseLevel(row.preview) ?? levels[0] ?? null,
    levels,
    version: Number(row.version) || 1
  };
}

/** Game speed for a community level: harder creations play a bit faster. */
export function paceIndexFor(difficulty: number): number {
  return (Math.max(1, Math.min(5, Math.round(difficulty))) - 1) * 5 + 3;
}
