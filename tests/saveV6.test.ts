import { describe, expect, it } from 'vitest';
import { SaveSystem } from '../src/game/systems/SaveSystem';
import { SAVE_STORAGE_KEY } from '../src/game/utils/constants';
import { createMemoryStorage } from '../src/game/utils/storage';

describe('save v6', () => {
  it('migrates a v5 save without losing progress or creative slots', () => {
    const storage = createMemoryStorage();
    storage.setItem(
      SAVE_STORAGE_KEY,
      JSON.stringify({
        version: 5,
        bestScore: 9100,
        unlockedLevel: 7,
        completedLevels: [0, 1, 2, 3, 4, 5, 6],
        levelMedals: { '0': 'gold', '3': 'silver' },
        preferences: {
          soundEnabled: false,
          themeId: 'forge',
          volumeSfx: 0.4,
          volumeMusic: 0.2,
          fxQuality: 'high',
          fullscreen: false
        },
        creativeLevelSlots: {}
      })
    );

    const data = new SaveSystem(storage).snapshot();
    expect(data.version).toBe(7);
    expect(data.bestScore).toBe(9100);
    expect(data.unlockedLevel).toBe(7);
    expect(data.levelMedals['0']).toBe('gold');
    expect(data.preferences.soundEnabled).toBe(false);
    expect(data.preferences.fxQuality).toBe('high');
    expect(['fr', 'en']).toContain(data.preferences.language);
    expect(data.records.endless).toEqual({ bestScore: 0, bestWave: 0 });
    expect(JSON.parse(storage.getItem(SAVE_STORAGE_KEY) ?? '{}').version).toBe(7);
  });

  it('keeps endless and daily records separate', () => {
    const storage = createMemoryStorage();
    const save = new SaveSystem(storage);

    expect(save.recordEndlessRun(1200, 4)).toBe(true);
    expect(save.recordEndlessRun(900, 6)).toBe(false);
    expect(save.recordDailyRun('2026-11-11', 5000, 2)).toBe(true);
    expect(save.recordDailyRun('2026-11-11', 4000, 3)).toBe(false);
    expect(save.recordDailyRun('not-a-date', 99, 1)).toBe(false);

    const data = new SaveSystem(storage).snapshot();
    expect(data.records.endless).toEqual({ bestScore: 1200, bestWave: 6 });
    expect(data.records.daily['2026-11-11']).toEqual({
      bestScore: 5000,
      wavesCleared: 3,
      attempts: 2
    });
    expect(data.bestScore).toBe(0);
  });

  it('persists language, reduced motion and tutorial flags', () => {
    const storage = createMemoryStorage();
    const save = new SaveSystem(storage);
    save.setLanguage('en');
    save.setReducedMotion(true);
    save.setTutorialSeen();

    const data = new SaveSystem(storage).snapshot();
    expect(data.preferences.language).toBe('en');
    expect(data.preferences.reducedMotion).toBe(true);
    expect(data.tutorialSeen).toBe(true);
  });

  it('notifies subscribers of every change', () => {
    const save = new SaveSystem(createMemoryStorage());
    const seen: number[] = [];
    const stop = save.subscribe((data) => seen.push(data.bestScore));
    save.updateBestScore(10);
    stop();
    save.updateBestScore(20);
    expect(seen).toEqual([10]);
  });
});
