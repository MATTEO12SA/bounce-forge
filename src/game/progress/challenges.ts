/**
 * Level challenges and medals.
 *
 * Every campaign level has three challenges: its objective, a score target and a flawless run (no
 * life lost). The medal of a run counts the challenges met IN THAT RUN — bronze for clearing,
 * silver for one, gold for two, diamond for all three at once. Challenges are also collected one
 * by one across runs, so a player can chase them separately before going for the diamond.
 */

export type ChallengeId = 'objective' | 'score' | 'flawless';
export type Medal = 'bronze' | 'silver' | 'gold' | 'diamond';

export const CHALLENGE_IDS: readonly ChallengeId[] = ['objective', 'score', 'flawless'];
export const MEDALS: readonly Medal[] = ['bronze', 'silver', 'gold', 'diamond'];

export const MEDAL_RANK: Record<Medal, number> = { bronze: 1, silver: 2, gold: 3, diamond: 4 };

export interface RunSummary {
  objectiveMet: boolean;
  score: number;
  scoreTarget: number;
  livesLost: number;
}

export function challengesMet(run: RunSummary): ChallengeId[] {
  const met: ChallengeId[] = [];
  if (run.objectiveMet) met.push('objective');
  if (run.scoreTarget > 0 && run.score >= run.scoreTarget) met.push('score');
  if (run.livesLost === 0) met.push('flawless');
  return met;
}

/** Medal of a cleared run. */
export function medalFor(met: readonly ChallengeId[]): Medal {
  return MEDALS[Math.min(3, met.length)] ?? 'bronze';
}

export function betterMedal(a: Medal | undefined, b: Medal | undefined): Medal | undefined {
  if (!a) return b;
  if (!b) return a;
  return MEDAL_RANK[b] > MEDAL_RANK[a] ? b : a;
}

export function isMedal(value: unknown): value is Medal {
  return typeof value === 'string' && value in MEDAL_RANK;
}

export function isChallengeId(value: unknown): value is ChallengeId {
  return value === 'objective' || value === 'score' || value === 'flawless';
}
