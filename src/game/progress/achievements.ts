import { MEDAL_RANK, type ChallengeId, type Medal } from './challenges';

/**
 * Trophies: long-term goals to collect. Each one is a pure check on the saved progress (and, for
 * a few, on the run that just happened), with a progress bar where it makes sense.
 */

export const CAMPAIGN_LEVELS = 30;
export const LEVELS_PER_CHAPTER = 6;
const POWER_UP_COUNT = 15;
const MECHANISM_COUNT = 9;
const COMBO_COUNT = 3;
const DAILY_WAVES = 3;

/** What a single run achieved (only the in-run trophies look at it). */
export interface RunStats {
  mode: string;
  cleared: boolean;
  maxCombo: number;
  maxBalls: number;
  explosions: number;
  pickups: number;
}

export interface ProgressSnapshot {
  completedLevels: readonly number[];
  levelMedals: Readonly<Record<string, Medal>>;
  levelChallenges: Readonly<Record<string, readonly ChallengeId[]>>;
  discovered: readonly string[];
  stats: { riskCaught: number; bestCombo: number; bestBalls: number };
  records: {
    endless: { bestWave: number };
    daily: Readonly<Record<string, { wavesCleared: number }>>;
  };
  creativeCount: number;
}

export interface AchievementDef {
  id: string;
  icon: string;
  /** Current and target values, for the progress bar. */
  progress: (save: ProgressSnapshot, run?: RunStats) => [number, number];
}

const medalCount = (save: ProgressSnapshot, atLeast: Medal): number =>
  Object.values(save.levelMedals).filter((medal) => MEDAL_RANK[medal] >= MEDAL_RANK[atLeast])
    .length;

const challengeCount = (save: ProgressSnapshot): number =>
  Object.values(save.levelChallenges).reduce((sum, list) => sum + list.length, 0);

const chapterCleared = (save: ProgressSnapshot, chapter: number): [number, number] => {
  const levels = Array.from(
    { length: LEVELS_PER_CHAPTER },
    (_, index) => chapter * LEVELS_PER_CHAPTER + index
  );
  return [levels.filter((level) => save.completedLevels.includes(level)).length, levels.length];
};

const bestChapterInGold = (save: ProgressSnapshot): number => {
  let best = 0;
  for (let chapter = 0; chapter < CAMPAIGN_LEVELS / LEVELS_PER_CHAPTER; chapter += 1) {
    let count = 0;
    for (let index = 0; index < LEVELS_PER_CHAPTER; index += 1) {
      const medal = save.levelMedals[String(chapter * LEVELS_PER_CHAPTER + index)];
      if (medal && MEDAL_RANK[medal] >= MEDAL_RANK.gold) count += 1;
    }
    best = Math.max(best, count);
  }
  return best;
};

const discoveredCount = (save: ProgressSnapshot, prefix: string): number =>
  save.discovered.filter((id) => id.startsWith(prefix)).length;

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first-clear', icon: '⚒', progress: (s) => [Math.min(1, s.completedLevels.length), 1] },
  ...[0, 1, 2, 3, 4].map(
    (chapter): AchievementDef => ({
      id: `chapter-${chapter + 1}`,
      icon: ['🔥', '⛓', '💥', '🌪', '⚙'][chapter] ?? '★',
      progress: (s) => chapterCleared(s, chapter)
    })
  ),
  { id: 'first-gold', icon: '🥇', progress: (s) => [Math.min(1, medalCount(s, 'gold')), 1] },
  {
    id: 'first-diamond',
    icon: '💎',
    progress: (s) => [Math.min(1, medalCount(s, 'diamond')), 1]
  },
  {
    id: 'golden-chapter',
    icon: '👑',
    progress: (s) => [bestChapterInGold(s), LEVELS_PER_CHAPTER]
  },
  { id: 'all-gold', icon: '🏆', progress: (s) => [medalCount(s, 'gold'), CAMPAIGN_LEVELS] },
  {
    id: 'all-diamond',
    icon: '💠',
    progress: (s) => [medalCount(s, 'diamond'), CAMPAIGN_LEVELS]
  },
  { id: 'challenges-30', icon: '◎', progress: (s) => [Math.min(30, challengeCount(s)), 30] },
  { id: 'challenges-60', icon: '◉', progress: (s) => [Math.min(60, challengeCount(s)), 60] },
  {
    id: 'challenges-90',
    icon: '✪',
    progress: (s) => [challengeCount(s), CAMPAIGN_LEVELS * 3]
  },
  {
    id: 'combo-50',
    icon: '×',
    progress: (s, r) => [Math.min(50, Math.max(s.stats.bestCombo, r?.maxCombo ?? 0)), 50]
  },
  {
    id: 'combo-100',
    icon: '✕',
    progress: (s, r) => [Math.min(100, Math.max(s.stats.bestCombo, r?.maxCombo ?? 0)), 100]
  },
  {
    id: 'balls-30',
    icon: '●',
    progress: (s, r) => [Math.min(30, Math.max(s.stats.bestBalls, r?.maxBalls ?? 0)), 30]
  },
  {
    id: 'balls-60',
    icon: '⁂',
    progress: (s, r) => [Math.min(60, Math.max(s.stats.bestBalls, r?.maxBalls ?? 0)), 60]
  },
  {
    id: 'explosions-25',
    icon: '✹',
    progress: (_s, r) => [Math.min(25, r?.explosions ?? 0), 25]
  },
  {
    id: 'all-powerups',
    icon: '✦',
    progress: (s) => [discoveredCount(s, 'power:'), POWER_UP_COUNT]
  },
  {
    id: 'all-mechanisms',
    icon: '⚙',
    progress: (s) => [discoveredCount(s, 'brick:'), MECHANISM_COUNT]
  },
  { id: 'all-combos', icon: '✧', progress: (s) => [discoveredCount(s, 'combo:'), COMBO_COUNT] },
  {
    id: 'risk-taker',
    icon: '⚠',
    progress: (s) => [Math.min(10, s.stats.riskCaught), 10]
  },
  {
    id: 'purist',
    icon: '✋',
    progress: (_s, r) => [r?.mode === 'campaign' && r.cleared && r.pickups === 0 ? 1 : 0, 1]
  },
  {
    id: 'endless-10',
    icon: '∞',
    progress: (s) => [Math.min(10, s.records.endless.bestWave), 10]
  },
  {
    id: 'daily-done',
    icon: '📅',
    progress: (s) => [
      Object.values(s.records.daily).some((record) => record.wavesCleared >= DAILY_WAVES) ? 1 : 0,
      1
    ]
  },
  { id: 'creator', icon: '✎', progress: (s) => [Math.min(1, s.creativeCount), 1] }
];

export function isUnlocked(def: AchievementDef, save: ProgressSnapshot, run?: RunStats): boolean {
  const [current, target] = def.progress(save, run);
  return current >= target;
}

/** Trophies earned now that were not unlocked before. */
export function newlyUnlocked(
  save: ProgressSnapshot,
  alreadyUnlocked: Readonly<Record<string, number>>,
  run?: RunStats
): string[] {
  return ACHIEVEMENTS.filter((def) => !alreadyUnlocked[def.id] && isUnlocked(def, save, run)).map(
    (def) => def.id
  );
}
