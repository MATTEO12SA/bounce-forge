import { describe, expect, it } from 'vitest';
import { EDITOR_GRID_COLS, createEmptyEditorRows } from '../src/game/levels/editorGrid';
import { DEFAULT_SAVE_DATA, SaveSystem, type SaveData } from '../src/game/systems/SaveSystem';
import { SAVE_STORAGE_KEY } from '../src/game/utils/constants';
import { loadJson, saveJson, type KeyValueStorage } from '../src/game/utils/storage';

class MemoryStorage implements KeyValueStorage {
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

function isSaveData(value: unknown): value is SaveData {
  return Boolean(value && typeof value === 'object' && (value as Partial<SaveData>).version === 3);
}

function makeOneBrickRows(): string[] {
  const rows = createEmptyEditorRows();
  rows[0] = `1${'.'.repeat(EDITOR_GRID_COLS - 1)}`;
  return rows;
}

describe('storage helpers and save system', () => {
  it('loads fallback when stored json is invalid', () => {
    const storage = new MemoryStorage();
    storage.setItem('broken', '{');

    expect(loadJson(storage, 'broken', DEFAULT_SAVE_DATA, isSaveData)).toEqual(DEFAULT_SAVE_DATA);
  });

  it('saves and reloads progress', () => {
    const storage = new MemoryStorage();
    const save = new SaveSystem(storage);

    save.updateBestScore(2400);
    save.completeLevel(2);

    const reloaded = new SaveSystem(storage).snapshot();
    expect(reloaded.bestScore).toBe(2400);
    expect(reloaded.unlockedLevel).toBe(3);
    expect(reloaded.completedLevels).toContain(2);
    expect(reloaded.version).toBe(3);
    expect(reloaded.levelMedals['2']).toBe('bronze');
  });

  it('writes json through the storage adapter', () => {
    const storage = new MemoryStorage();
    saveJson(storage, 'value', { ok: true });

    expect(storage.getItem('value')).toBe('{"ok":true}');
  });

  it('migrates v1 saves without losing progress', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SAVE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        bestScore: 4200,
        unlockedLevel: 4,
        completedLevels: [0, 1, 3],
        preferences: {
          soundEnabled: false,
          themeId: 'neon'
        }
      })
    );

    const migrated = new SaveSystem(storage).snapshot();

    expect(migrated.version).toBe(3);
    expect(migrated.bestScore).toBe(4200);
    expect(migrated.unlockedLevel).toBe(4);
    expect(migrated.completedLevels).toEqual([0, 1, 3]);
    expect(migrated.levelMedals).toEqual({ '0': 'bronze', '1': 'bronze', '3': 'bronze' });
    expect(migrated.preferences.soundEnabled).toBe(false);
    expect(migrated.preferences.themeId).toBe('neon');
    expect(migrated.customLevelOverrides).toEqual({});
  });

  it('saves reloads and removes custom level overrides', () => {
    const storage = new MemoryStorage();
    const save = new SaveSystem(storage);

    save.setCustomLevelOverride(1, makeOneBrickRows(), 'Tiny Custom', 1234);

    const reloaded = new SaveSystem(storage);
    expect(reloaded.getCustomLevelOverride(1)?.name).toBe('Tiny Custom');
    expect(reloaded.getCustomLevelOverride(1)?.rows[0][0]).toBe('1');

    reloaded.removeCustomLevelOverride(1);

    expect(new SaveSystem(storage).getCustomLevelOverride(1)).toBeNull();
  });

  it('keeps the best medal earned for each level', () => {
    const storage = new MemoryStorage();
    const save = new SaveSystem(storage);

    save.completeLevel(0, 'silver');
    save.completeLevel(0, 'bronze');
    save.completeLevel(0, 'gold');

    const reloaded = new SaveSystem(storage);
    expect(reloaded.getLevelMedal(0)).toBe('gold');
    expect(reloaded.snapshot().levelMedals['0']).toBe('gold');
  });
});
