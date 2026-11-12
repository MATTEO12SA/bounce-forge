import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  newlyUnlocked,
  type ProgressSnapshot
} from '../src/game/progress/achievements';
import { challengesMet, medalFor } from '../src/game/progress/challenges';
import { finishBonuses, lifePenalty, parTimeMs } from '../src/game/progress/scoring';
import { SaveSystem } from '../src/game/systems/SaveSystem';
import { ScoreSystem } from '../src/game/systems/ScoreSystem';

class MemoryStorage {
  private readonly data = new Map<string, string>();
  public getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  public setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  public removeItem(key: string): void {
    this.data.delete(key);
  }
}

function emptyProgress(): ProgressSnapshot {
  return {
    completedLevels: [],
    levelMedals: {},
    levelChallenges: {},
    discovered: [],
    stats: { riskCaught: 0, bestCombo: 0, bestBalls: 0 },
    records: { endless: { bestWave: 0 }, daily: {} },
    creativeCount: 0
  };
}

describe('challenges and medals', () => {
  it('counts the challenges met in one run', () => {
    const run = { objectiveMet: true, score: 30000, scoreTarget: 25000, livesLost: 0 };
    expect(challengesMet(run)).toEqual(['objective', 'score', 'flawless']);
    expect(medalFor(challengesMet(run))).toBe('diamond');
    expect(medalFor(challengesMet({ ...run, livesLost: 1 }))).toBe('gold');
    expect(medalFor(challengesMet({ ...run, livesLost: 1, score: 10 }))).toBe('silver');
    expect(
      medalFor(challengesMet({ objectiveMet: false, score: 0, scoreTarget: 1, livesLost: 2 }))
    ).toBe('bronze');
  });
});

describe('scoring', () => {
  it('takes a tenth of the score for a lost life, at least 300, never below zero', () => {
    expect(lifePenalty(50000)).toBe(5000);
    expect(lifePenalty(1000)).toBe(300);
    expect(lifePenalty(120)).toBe(120);
    const score = new ScoreSystem();
    score.registerBrickBreak(100, 1, 1);
    expect(score.addPenalty(lifePenalty(score.snapshot().score))).toBe(100);
    expect(score.snapshot().score).toBe(0);
  });

  it('rewards a fast, flawless clear that met its objective', () => {
    const par = parTimeMs(200);
    const fast = finishBonuses({
      livesLeft: 3,
      livesLost: 0,
      objectiveMet: true,
      elapsedMs: par * 0.8,
      parMs: par,
      multiplier: 1
    });
    expect(fast.map((line) => line.id)).toEqual(['lives', 'flawless', 'objective', 'speed']);
    expect(fast.find((line) => line.id === 'speed')?.points).toBe(3000);
    const slow = finishBonuses({
      livesLeft: 1,
      livesLost: 2,
      objectiveMet: false,
      elapsedMs: par * 3,
      parMs: par,
      multiplier: 1
    });
    expect(slow).toEqual([{ id: 'lives', points: 500 }]);
  });

  it('explains the score line by line', () => {
    const score = new ScoreSystem();
    score.registerBrickBreak(100, 2, 1);
    score.addBonus(25);
    score.addEndBonuses([{ id: 'lives', points: 1000 }]);
    score.addPenalty(50);
    const lines = score.breakdown();
    expect(lines).toEqual([
      { id: 'bricks', points: 100 },
      { id: 'combo', points: 100 },
      { id: 'extras', points: 25 },
      { id: 'lives', points: 1000 },
      { id: 'penalties', points: -50 }
    ]);
    expect(lines.reduce((sum, line) => sum + line.points, 0)).toBe(score.snapshot().score);
  });
});

describe('trophies', () => {
  it('has unique ids and starts locked', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(25);
    expect(newlyUnlocked(emptyProgress(), {})).toEqual([]);
  });

  it('unlocks from saved progress and from the run that just ended', () => {
    const progress = emptyProgress();
    progress.completedLevels = [0, 1, 2, 3, 4, 5];
    progress.levelMedals = { '0': 'diamond' };
    const unlocked = newlyUnlocked(
      progress,
      {},
      {
        mode: 'campaign',
        cleared: true,
        maxCombo: 120,
        maxBalls: 10,
        explosions: 3,
        pickups: 0
      }
    );
    expect(unlocked).toEqual(
      expect.arrayContaining([
        'first-clear',
        'chapter-1',
        'first-gold',
        'first-diamond',
        'combo-50',
        'combo-100',
        'purist'
      ])
    );
    expect(newlyUnlocked(progress, { 'first-clear': 1 })).not.toContain('first-clear');
  });
});

describe('save v8', () => {
  it('collects challenges across runs and keeps the best medal', () => {
    const save = new SaveSystem(new MemoryStorage());
    expect(save.recordLevelResult(0, 'silver', ['objective'])).toEqual(['objective']);
    expect(save.recordLevelResult(0, 'silver', ['flawless'])).toEqual(['flawless']);
    expect(save.getLevelChallenges(0)).toEqual(['objective', 'flawless']);
    expect(save.getLevelMedal(0)).toBe('silver');
    save.recordLevelResult(0, 'diamond', ['objective', 'score', 'flawless']);
    save.recordLevelResult(0, 'bronze', []);
    expect(save.getLevelMedal(0)).toBe('diamond');
    expect(save.snapshot().unlockedLevel).toBe(1);
  });

  it('records stats and trophies once', () => {
    const storage = new MemoryStorage();
    const save = new SaveSystem(storage);
    save.addStats({ riskCaught: 2, bestCombo: 40 });
    save.addStats({ riskCaught: 1, bestCombo: 10 });
    expect(save.snapshot().stats).toMatchObject({ riskCaught: 3, bestCombo: 40 });
    expect(save.unlockAchievements(['creator', 'creator'])).toEqual(['creator']);
    expect(save.unlockAchievements(['creator'])).toEqual([]);
    const reloaded = new SaveSystem(storage);
    expect(reloaded.snapshot().achievements.creator).toBeGreaterThan(0);
    expect(reloaded.snapshot().version).toBe(8);
  });
});
