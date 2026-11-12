import type { SupabaseClient } from '@supabase/supabase-js';
import {
  errorCode,
  nicknameProblem,
  parseCreation,
  PAGE_SIZE,
  searchPattern,
  sortOrder
} from './rules';
import {
  CommunityError,
  type CommunityLevel,
  type Creation,
  type CreationSummary,
  type KindFilter,
  type Profile,
  type SortKey
} from './types';

/**
 * Community library client. supabase-js is only downloaded when a community screen is opened,
 * and every player gets an anonymous account the first time it is needed.
 */

const env = import.meta.env as Record<string, string | undefined>;
/** Public project URL and publishable key: safe to ship in the page (rules live in the database). */
export const SUPABASE_URL = env.VITE_SUPABASE_URL ?? 'https://gxeixluoxfhcqguxmems.supabase.co';
export const SUPABASE_KEY =
  env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_b2PUr2QemidoCHjTXPS_JQ_5KLyN7Is';

const SUMMARY_COLUMNS =
  'id,kind,title,description,level_count,difficulty,plays,likes,status,created_at,updated_at,author:profiles(nickname),preview:levels->0';
export const FULL_COLUMNS =
  'id,kind,title,description,level_count,difficulty,plays,likes,status,created_at,updated_at,version,levels,author_id,author:profiles(nickname)';

let clientPromise: Promise<SupabaseClient> | null = null;

function client(): Promise<SupabaseClient> {
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'bounce-forge.community' }
    })
  );
  return clientPromise;
}

export async function run<T>(task: (db: SupabaseClient) => Promise<T>): Promise<T> {
  try {
    return await task(await client());
  } catch (error) {
    throw new CommunityError(errorCode(error));
  }
}

export function check<R extends { data: unknown; error: unknown }>(result: R): R['data'] {
  if (result.error) throw result.error;
  return result.data;
}

/** Signs the player in anonymously if needed; returns their user id. */
export async function userId(db: SupabaseClient): Promise<string> {
  const session = check(await db.auth.getSession()).session;
  if (session?.user) return session.user.id;
  const signed = check(await db.auth.signInAnonymously());
  if (!signed.user) throw new CommunityError('auth_required');
  return signed.user.id;
}

/** The signed-in player's id, without creating an account; null when there is none. */
export async function currentUserId(): Promise<string | null> {
  try {
    const db = await client();
    return check(await db.auth.getSession()).session?.user.id ?? null;
  } catch {
    return null;
  }
}

export function listCreations(query: {
  sort: SortKey;
  kind: KindFilter;
  search: string;
  page: number;
}): Promise<CreationSummary[]> {
  return run(async (db) => {
    let request = db.from('creations').select(SUMMARY_COLUMNS).eq('status', 'published');
    if (query.kind !== 'all') request = request.eq('kind', query.kind);
    const pattern = searchPattern(query.search);
    if (pattern) request = request.ilike('title', pattern);
    sortOrder(query.sort).forEach((order) => {
      request = request.order(order.column, { ascending: order.ascending });
    });
    const from = Math.max(0, query.page) * PAGE_SIZE;
    const rows = check(await request.range(from, from + PAGE_SIZE - 1));
    return (rows as unknown as Parameters<typeof parseCreation>[0][]).map(parseCreation);
  });
}

export function getCreation(id: string): Promise<Creation> {
  return run(async (db) => {
    const row = check(await db.from('creations').select(FULL_COLUMNS).eq('id', id).maybeSingle());
    if (!row) throw new CommunityError('not_found');
    return parseCreation(row as unknown as Parameters<typeof parseCreation>[0]);
  });
}

export function myProfile(): Promise<Profile | null> {
  return run(async (db) => {
    const id = await userId(db);
    const row = check(
      await db.from('profiles').select('id,nickname').eq('id', id).maybeSingle()
    ) as { id: string; nickname: string } | null;
    return row ? { id: row.id, nickname: row.nickname } : null;
  });
}

export function setNickname(nickname: string): Promise<Profile> {
  const clean = nickname.trim();
  const problem = nicknameProblem(clean);
  if (problem) return Promise.reject(new CommunityError(problem));
  return run(async (db) => {
    const id = await userId(db);
    const existing = check(await db.from('profiles').select('id').eq('id', id).maybeSingle());
    if (existing) {
      check(await db.from('profiles').update({ nickname: clean }).eq('id', id));
    } else {
      check(await db.from('profiles').insert({ id, nickname: clean }));
    }
    return { id, nickname: clean };
  });
}

export function publish(input: {
  kind: 'level' | 'campaign';
  title: string;
  description: string;
  levels: CommunityLevel[];
  difficulty: number;
  id?: string;
}): Promise<string> {
  return run(async (db) => {
    await userId(db);
    const id = check(
      await db.rpc('publish_creation', {
        p_kind: input.kind,
        p_title: input.title.trim(),
        p_description: input.description.trim(),
        p_levels: input.levels,
        p_difficulty: input.difficulty,
        p_id: input.id ?? null
      })
    );
    return String(id);
  });
}

export function myCreations(): Promise<CreationSummary[]> {
  return run(async (db) => {
    const id = await userId(db);
    const rows = check(
      await db
        .from('creations')
        .select(SUMMARY_COLUMNS)
        .eq('author_id', id)
        .order('updated_at', { ascending: false })
    );
    return (rows as unknown as Parameters<typeof parseCreation>[0][]).map(parseCreation);
  });
}

export function setListed(id: string, listed: boolean): Promise<void> {
  return run(async (db) => {
    await userId(db);
    check(await db.rpc('set_creation_listed', { p_id: id, p_listed: listed }));
  });
}

export function deleteCreation(id: string): Promise<void> {
  return run(async (db) => {
    await userId(db);
    check(await db.from('creations').delete().eq('id', id));
  });
}

/** Counts a play (once per player and day); failures are ignored, playing must never break. */
export async function recordPlay(id: string, completed: boolean): Promise<void> {
  try {
    await run(async (db) => {
      await userId(db);
      check(await db.rpc('record_play', { p_id: id, p_completed: completed }));
    });
  } catch {
    // Offline or blocked: the game goes on.
  }
}

export function toggleLike(id: string): Promise<boolean> {
  return run(async (db) => {
    await userId(db);
    return Boolean(check(await db.rpc('toggle_like', { p_id: id })));
  });
}

export function likedAmong(ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return Promise.resolve(new Set());
  return run(async (db) => {
    await userId(db);
    const rows = check(
      await db
        .from('likes')
        .select('creation_id')
        .in('creation_id', [...ids])
    ) as Array<{ creation_id: string }>;
    return new Set(rows.map((row) => row.creation_id));
  });
}
