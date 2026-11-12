import type { SupabaseClient } from '@supabase/supabase-js';
import { check, FULL_COLUMNS, SUPABASE_KEY, SUPABASE_URL } from './api';
import { setAdminState } from './adminState';
import { errorCode, parseCreation } from './rules';
import { CommunityError, type CommunityLevel, type Creation } from './types';

/**
 * Admin panel client. It uses its own Supabase session (e-mail + password account created in the
 * Supabase dashboard and listed in the `admins` table), separate from the player's anonymous
 * account, so signing in as admin never replaces the player's nickname or publications.
 * Every admin function checks `is_admin()` on the server.
 */

let adminPromise: Promise<SupabaseClient> | null = null;

function adminClient(): Promise<SupabaseClient> {
  adminPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'bounce-forge.admin' }
    })
  );
  return adminPromise;
}

async function admin<T>(task: (db: SupabaseClient) => Promise<T>): Promise<T> {
  try {
    return await task(await adminClient());
  } catch (error) {
    throw new CommunityError(errorCode(error));
  }
}

export type AdminFilter =
  | 'attention'
  | 'review'
  | 'team'
  | 'appeals'
  | 'reported'
  | 'removed'
  | 'all';
export const ADMIN_FILTERS: AdminFilter[] = [
  'attention',
  'review',
  'team',
  'appeals',
  'reported',
  'removed',
  'all'
];
export type AdminAction = 'keep' | 'remove' | 'delete';
export type PlayerAction = 'ban' | 'unban' | 'reset_strikes' | 'reset_trust' | 'rename' | 'delete';

export interface AdminOverview {
  review: number;
  team: number;
  appeals: number;
  reported: number;
  published: number;
  removed: number;
  players: number;
  banned: number;
}

export interface AdminAuthor {
  id: string;
  nickname: string;
  trust: number;
  strikes: number;
  bannedUntil: string | null;
}

export interface AdminCreation {
  id: string;
  kind: 'level' | 'campaign';
  title: string;
  description: string;
  status: string;
  teamReview: boolean;
  levelCount: number;
  difficulty: number;
  plays: number;
  likes: number;
  updatedAt: string;
  preview: CommunityLevel | null;
  author: AdminAuthor;
  reports: Array<{
    reason: string;
    details: string;
    by: string;
    at: string;
    outcome: string | null;
  }>;
  votes: { keep: number; remove: number };
  appeal: { message: string; status: string; at: string; note: string } | null;
}

export interface AdminPlayer {
  id: string;
  nickname: string;
  trust: number;
  strikes: number;
  bannedUntil: string | null;
  createdAt: string;
  creations: number;
  reports: number;
  reportsRejected: number;
}

export interface AdminLogEntry {
  id: number;
  title: string;
  action: string;
  actor: string;
  note: string;
  at: string;
}

/** Signed-in admin e-mail, or null (not signed in, or the account is not an admin). */
export async function adminSession(): Promise<{ email: string; isAdmin: boolean } | null> {
  return admin(async (db) => {
    const session = check(await db.auth.getSession()).session;
    if (!session?.user) {
      setAdminState(null);
      return null;
    }
    const isAdmin = Boolean(check(await db.rpc('is_admin')));
    const state = { email: session.user.email ?? '', isAdmin };
    setAdminState(state);
    return state;
  });
}

export async function adminSignIn(email: string, password: string): Promise<boolean> {
  const db = await adminClient().catch((error: unknown) => {
    throw new CommunityError(errorCode(error));
  });
  const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
  if (error) {
    throw new CommunityError(/fetch|network/i.test(error.message) ? 'offline' : 'admin_login');
  }
  const isAdmin = await admin(async (client) => Boolean(check(await client.rpc('is_admin'))));
  setAdminState({ email: email.trim(), isAdmin });
  return isAdmin;
}

export function adminSignOut(): Promise<void> {
  return admin(async (db) => {
    await db.auth.signOut();
    setAdminState(null);
  });
}

export function adminOverview(): Promise<AdminOverview> {
  return admin(async (db) => {
    const raw = (check(await db.rpc('admin_overview')) ?? {}) as Record<string, unknown>;
    const n = (key: string): number => Math.max(0, Number(raw[key]) || 0);
    return {
      review: n('review'),
      team: n('team'),
      appeals: n('appeals'),
      reported: n('reported'),
      published: n('published'),
      removed: n('removed'),
      players: n('players'),
      banned: n('banned')
    };
  });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function adminCreations(filter: AdminFilter, search: string): Promise<AdminCreation[]> {
  return admin(async (db) => {
    const rows = (check(
      await db.rpc('admin_creations', { p_filter: filter, p_search: search.trim().slice(0, 40) })
    ) ?? []) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const author = (row.author ?? {}) as Record<string, unknown>;
      const votes = (row.votes ?? {}) as Record<string, unknown>;
      const appeal = row.appeal as Record<string, unknown> | null;
      const parsed = parseCreation({
        id: text(row.id),
        kind: text(row.kind),
        title: text(row.title),
        description: text(row.description),
        level_count: Number(row.level_count),
        difficulty: Number(row.difficulty),
        plays: Number(row.plays),
        likes: Number(row.likes),
        status: 'published',
        created_at: text(row.created_at),
        updated_at: text(row.updated_at),
        preview: row.preview
      });
      return {
        id: parsed.id,
        kind: parsed.kind,
        title: parsed.title,
        description: parsed.description,
        status: text(row.status),
        teamReview: row.team_review === true,
        levelCount: parsed.levelCount,
        difficulty: parsed.difficulty,
        plays: parsed.plays,
        likes: parsed.likes,
        updatedAt: parsed.updatedAt,
        preview: parsed.preview,
        author: {
          id: text(author.id),
          nickname: text(author.nickname) || '?',
          trust: Number(author.trust) || 0,
          strikes: Number(author.strikes) || 0,
          bannedUntil: text(author.banned_until) || null
        },
        reports: (Array.isArray(row.reports) ? row.reports : []).map((item) => {
          const report = item as Record<string, unknown>;
          return {
            reason: text(report.reason),
            details: text(report.details),
            by: text(report.by) || '?',
            at: text(report.at),
            outcome: text(report.outcome) || null
          };
        }),
        votes: { keep: Number(votes.keep) || 0, remove: Number(votes.remove) || 0 },
        appeal: appeal
          ? {
              message: text(appeal.message),
              status: text(appeal.status),
              at: text(appeal.at),
              note: text(appeal.note)
            }
          : null
      };
    });
  });
}

/** Full creation (any status) so the admin can play it. */
export function adminGetCreation(id: string): Promise<Creation> {
  return admin(async (db) => {
    const row = check(await db.from('creations').select(FULL_COLUMNS).eq('id', id).maybeSingle());
    if (!row) throw new CommunityError('not_found');
    return parseCreation(row as unknown as Parameters<typeof parseCreation>[0]);
  });
}

export function adminModerate(id: string, action: AdminAction, note: string): Promise<string> {
  return admin(async (db) =>
    String(
      check(
        await db.rpc('admin_moderate', { p_id: id, p_action: action, p_note: note.slice(0, 300) })
      )
    )
  );
}

export function adminPlayers(search: string): Promise<AdminPlayer[]> {
  return admin(async (db) => {
    const rows = (check(await db.rpc('admin_players', { p_search: search.trim().slice(0, 40) })) ??
      []) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: text(row.id),
      nickname: text(row.nickname) || '?',
      trust: Number(row.trust) || 0,
      strikes: Number(row.strikes) || 0,
      bannedUntil: text(row.banned_until) || null,
      createdAt: text(row.created_at),
      creations: Number(row.creations) || 0,
      reports: Number(row.reports) || 0,
      reportsRejected: Number(row.reports_rejected) || 0
    }));
  });
}

export function adminPlayerAction(id: string, action: PlayerAction, days = 0): Promise<void> {
  return admin(async (db) => {
    check(await db.rpc('admin_player_action', { p_user: id, p_action: action, p_days: days }));
  });
}

export function adminLog(): Promise<AdminLogEntry[]> {
  return admin(async (db) => {
    const rows = (check(await db.rpc('admin_log')) ?? []) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id) || 0,
      title: text(row.title),
      action: text(row.action),
      actor: text(row.actor),
      note: text(row.note),
      at: text(row.at)
    }));
  });
}
