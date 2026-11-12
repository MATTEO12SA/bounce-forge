import type { LevelOptions } from '../game/levels/levelOptions';

/** One level inside a published creation. */
export interface CommunityLevel {
  name: string;
  rows: string[];
  options?: LevelOptions;
}

export type CreationKind = 'level' | 'campaign';
export type CreationStatus = 'published' | 'unlisted' | 'review' | 'removed';
export type SortKey = 'popular' | 'new' | 'played' | 'easy' | 'hard';
export type KindFilter = 'all' | CreationKind;

/** A creation as listed in the library (only its first level, for the preview). */
export interface CreationSummary {
  id: string;
  kind: CreationKind;
  title: string;
  description: string;
  levelCount: number;
  difficulty: number;
  plays: number;
  likes: number;
  status: CreationStatus;
  createdAt: string;
  updatedAt: string;
  author: string;
  preview: CommunityLevel | null;
}

export interface Creation extends CreationSummary {
  levels: CommunityLevel[];
  version: number;
  /** Author's user id (to recognise one's own creations); empty when unknown. */
  authorId: string;
}

export type ReportReason = 'offensive' | 'spam' | 'broken' | 'copied' | 'other';

/** What the current player may do in moderation (from `my_moderation`). */
export interface ModerationStatus {
  profile: boolean;
  trust: number;
  strikes: number;
  bannedUntil: string | null;
  canReport: boolean;
  canReview: boolean;
  toReview: number;
}

/** A creation waiting for community votes. */
export interface ReviewItem extends Creation {
  reasons: Partial<Record<ReportReason, number>>;
  details: string[];
  votes: number;
}

export interface Appeal {
  creationId: string;
  status: 'pending' | 'accepted' | 'rejected';
  note: string;
}

export interface Profile {
  id: string;
  nickname: string;
}

/** Errors the interface knows how to explain. */
export type CommunityErrorCode =
  | 'offline'
  | 'auth_required'
  | 'nickname_required'
  | 'nickname_taken'
  | 'nickname_invalid'
  | 'publish_banned'
  | 'rate_limited'
  | 'invalid_level'
  | 'invalid_level_count'
  | 'invalid_title'
  | 'invalid_description'
  | 'too_large'
  | 'not_found'
  | 'offensive_text'
  | 'nickname_offensive'
  | 'links_forbidden'
  | 'duplicate'
  | 'too_simple'
  | 'report_blocked'
  | 'report_quota'
  | 'already_reported'
  | 'cannot_report_own'
  | 'invalid_reason'
  | 'not_eligible'
  | 'already_voted'
  | 'appeal_exists'
  | 'not_admin'
  | 'admin_login'
  | 'unknown';

export class CommunityError extends Error {
  public constructor(public readonly code: CommunityErrorCode) {
    super(code);
  }
}
