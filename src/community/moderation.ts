import { check, run, userId } from './api';
import { parseCreation, textProblem } from './rules';
import {
  CommunityError,
  type Appeal,
  type ModerationStatus,
  type ReportReason,
  type ReviewItem
} from './types';

/**
 * Player side of moderation: reports, community review votes and appeals. Every rule is enforced
 * by the database; the checks here only give instant feedback.
 */

export const REPORT_REASONS: ReportReason[] = ['offensive', 'spam', 'broken', 'copied', 'other'];
export const DETAILS_MAX = 300;
export const APPEAL_MAX = 500;

/** What the current player may do (signs in anonymously if needed). */
export function myModeration(): Promise<ModerationStatus> {
  return run(async (db) => {
    await userId(db);
    const raw = (check(await db.rpc('my_moderation')) ?? {}) as Record<string, unknown>;
    return {
      profile: raw.profile === true,
      trust: Number(raw.trust) || 0,
      strikes: Number(raw.strikes) || 0,
      bannedUntil: typeof raw.banned_until === 'string' ? raw.banned_until : null,
      canReport: raw.can_report !== false,
      canReview: raw.can_review === true,
      toReview: Math.max(0, Number(raw.to_review) || 0)
    };
  });
}

/** Ids of the creations this player already reported. */
export function myReports(): Promise<Set<string>> {
  return run(async (db) => {
    const id = await userId(db);
    const rows = check(
      await db.from('reports').select('creation_id').eq('reporter_id', id)
    ) as Array<{ creation_id: string }> | null;
    return new Set((rows ?? []).map((row) => row.creation_id));
  });
}

/** Reports a creation; returns its status afterwards ("review" when it was just hidden). */
export function reportCreation(id: string, reason: ReportReason, details: string): Promise<string> {
  const clean = details.trim().slice(0, DETAILS_MAX);
  const problem = textProblem(clean);
  if (problem) return Promise.reject(new CommunityError(problem));
  if (!REPORT_REASONS.includes(reason)) {
    return Promise.reject(new CommunityError('invalid_reason'));
  }
  return run(async (db) => {
    await userId(db);
    return String(
      check(await db.rpc('report_creation', { p_id: id, p_reason: reason, p_details: clean }))
    );
  });
}

interface ReviewRow {
  id: string;
  kind: string;
  title: string;
  description: string;
  level_count: number;
  difficulty: number;
  levels: unknown;
  author: string;
  reasons: Record<string, number> | null;
  details: unknown;
  votes: number;
  review_started_at: string | null;
}

/** Creations waiting for this player's vote (only for players allowed to review). */
export function reviewQueue(): Promise<ReviewItem[]> {
  return run(async (db) => {
    await userId(db);
    const rows = (check(await db.rpc('review_queue')) ?? []) as ReviewRow[];
    return rows.map((row) => {
      const reasons: ReviewItem['reasons'] = {};
      Object.entries(row.reasons ?? {}).forEach(([reason, count]) => {
        if (REPORT_REASONS.includes(reason as ReportReason)) {
          reasons[reason as ReportReason] = Math.max(0, Number(count) || 0);
        }
      });
      const when = row.review_started_at ?? new Date().toISOString();
      return {
        ...parseCreation({
          id: row.id,
          kind: row.kind,
          title: row.title,
          description: row.description,
          level_count: row.level_count,
          difficulty: row.difficulty,
          plays: 0,
          likes: 0,
          status: 'review',
          created_at: when,
          updated_at: when,
          levels: row.levels,
          author: { nickname: row.author }
        }),
        reasons,
        details: Array.isArray(row.details)
          ? row.details.filter((text): text is string => typeof text === 'string').slice(0, 10)
          : [],
        votes: Math.max(0, Number(row.votes) || 0)
      };
    });
  });
}

/** Votes to keep or remove; returns the status afterwards (review, published, removed, team). */
export function castVote(id: string, keep: boolean): Promise<string> {
  return run(async (db) => {
    await userId(db);
    return String(check(await db.rpc('cast_review_vote', { p_id: id, p_keep: keep })));
  });
}

/** Contests the removal of one of the player's creations (once). */
export function appealCreation(id: string, message: string): Promise<void> {
  const clean = message.trim().slice(0, APPEAL_MAX);
  const problem = textProblem(clean);
  if (problem) return Promise.reject(new CommunityError(problem));
  return run(async (db) => {
    await userId(db);
    check(await db.rpc('appeal_creation', { p_id: id, p_message: clean }));
  });
}

export function myAppeals(): Promise<Map<string, Appeal>> {
  return run(async (db) => {
    const id = await userId(db);
    const rows = check(
      await db.from('appeals').select('creation_id,status,decision_note').eq('author_id', id)
    ) as Array<{ creation_id: string; status: string; decision_note: string }> | null;
    return new Map(
      (rows ?? []).map((row) => [
        row.creation_id,
        {
          creationId: row.creation_id,
          status: (['accepted', 'rejected'].includes(row.status)
            ? row.status
            : 'pending') as Appeal['status'],
          note: String(row.decision_note ?? '')
        }
      ])
    );
  });
}
