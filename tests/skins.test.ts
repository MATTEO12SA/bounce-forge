import { describe, expect, it } from 'vitest';
import {
  activeSkins,
  DEFAULT_SKINS,
  isSkinUnlocked,
  sanitizeSkins,
  SKIN_SLOTS,
  skinsFor,
  skinsUnlockedBy
} from '../src/game/config/skins';
import { ACHIEVEMENTS } from '../src/game/progress/achievements';
import { SAVE_STORAGE_KEY } from '../src/game/utils/constants';
import { SaveSystem } from '../src/game/systems/SaveSystem';
import { catalogsForTests } from '../src/ui/i18n';
import type { KeyValueStorage } from '../src/game/utils/storage';

class MemoryStorage implements KeyValueStorage {
  public readonly data = new Map<string, string>();

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

describe('skins', () => {
  it('are unlocked by real trophies and each trophy unlocks at most one skin', () => {
    const trophyIds = new Set(ACHIEVEMENTS.map((def) => def.id));
    const used: string[] = [];
    SKIN_SLOTS.forEach((slot) => {
      const ids = skinsFor(slot).map((skin) => skin.id);
      expect(new Set(ids).size, slot).toBe(ids.length);
      expect(ids, slot).toContain(DEFAULT_SKINS[slot]);
      skinsFor(slot).forEach((skin) => {
        if (skin.trophy) {
          expect(trophyIds.has(skin.trophy), skin.trophy).toBe(true);
          used.push(skin.trophy);
        }
      });
    });
    expect(new Set(used).size).toBe(used.length);
  });

  it('have a name in every language', () => {
    SKIN_SLOTS.forEach((slot) =>
      skinsFor(slot).forEach((skin) => {
        const key = `skins.${slot}.${skin.id}`;
        expect(catalogsForTests.fr[key as keyof typeof catalogsForTests.fr], key).toBeTruthy();
        expect(catalogsForTests.en[key as keyof typeof catalogsForTests.en], key).toBeTruthy();
      })
    );
  });

  it('only use unlocked skins, and clean unknown choices', () => {
    expect(isSkinUnlocked('paddle', 'forge', {})).toBe(true);
    expect(isSkinUnlocked('paddle', 'gold', {})).toBe(false);
    expect(isSkinUnlocked('paddle', 'gold', { 'first-gold': 1 })).toBe(true);
    expect(activeSkins({ paddle: 'gold', ball: 'ice', trail: 'none' }, {})).toEqual({
      paddle: 'forge',
      ball: 'ember',
      trail: 'none'
    });
    expect(sanitizeSkins({ paddle: 'nope', ball: 'ice', trail: 42 })).toEqual({
      paddle: 'forge',
      ball: 'ice',
      trail: 'ember'
    });
    expect(skinsUnlockedBy(['first-gold', 'chapter-2'])).toEqual([
      { slot: 'paddle', id: 'gold' },
      { slot: 'ball', id: 'ice' }
    ]);
  });

  it('are equipped through the save, once unlocked', () => {
    const storage = new MemoryStorage();
    const save = new SaveSystem(storage);
    expect(save.snapshot().preferences.skins).toEqual(DEFAULT_SKINS);
    expect(save.setSkin('paddle', 'gold')).toBe(false);
    save.unlockAchievements(['first-gold']);
    expect(save.setSkin('paddle', 'gold')).toBe(true);
    expect(new SaveSystem(storage).snapshot().preferences.skins.paddle).toBe('gold');
  });

  it('keep older saves working (no skins yet)', () => {
    const storage = new MemoryStorage();
    new SaveSystem(storage).setSoundEnabled(false);
    const raw = JSON.parse(storage.data.get(SAVE_STORAGE_KEY)!) as {
      preferences: Record<string, unknown>;
    };
    delete raw.preferences.skins;
    storage.data.set(SAVE_STORAGE_KEY, JSON.stringify(raw));
    const save = new SaveSystem(storage);
    expect(save.snapshot().preferences.skins).toEqual(DEFAULT_SKINS);
    expect(save.snapshot().preferences.soundEnabled).toBe(false);
  });
});
