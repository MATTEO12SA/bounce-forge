import { describe, expect, it } from 'vitest';
import { SAVE_BACKUP_KEY, SaveSystem } from '../src/game/systems/SaveSystem';
import { SAVE_STORAGE_KEY } from '../src/game/utils/constants';
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

describe('save robustness', () => {
  it('keeps a copy of an unreadable save before starting a new one', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_STORAGE_KEY, '{"version": 8, "bestScore": "broken"');
    const save = new SaveSystem(storage);
    expect(save.snapshot().bestScore).toBe(0);
    save.setSoundEnabled(false);
    expect(storage.getItem(SAVE_BACKUP_KEY)).toBe('{"version": 8, "bestScore": "broken"');
    // A second unreadable save never overwrites the first backup.
    storage.setItem(SAVE_STORAGE_KEY, 'garbage');
    new SaveSystem(storage);
    expect(storage.getItem(SAVE_BACKUP_KEY)).toBe('{"version": 8, "bestScore": "broken"');
  });

  it('does not back up a missing save', () => {
    const storage = new MemoryStorage();
    new SaveSystem(storage).setSoundEnabled(false);
    expect(storage.getItem(SAVE_BACKUP_KEY)).toBeNull();
  });

  it('takes the progress saved by another tab instead of overwriting it', () => {
    const storage = new MemoryStorage();
    const tabA = new SaveSystem(storage);
    const tabB = new SaveSystem(storage);
    tabA.updateBestScore(5000);
    const seen: number[] = [];
    tabB.subscribe((data) => seen.push(data.bestScore));
    expect(tabB.reloadFromStorage()).toBe(true);
    expect(seen).toEqual([5000]);
    tabB.setSoundEnabled(false);
    const stored = JSON.parse(storage.getItem(SAVE_STORAGE_KEY)!) as { bestScore: number };
    expect(stored.bestScore).toBe(5000);
  });
});
