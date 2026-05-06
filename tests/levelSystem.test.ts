import { describe, expect, it } from 'vitest';
import { campaignLevels } from '../src/game/levels/campaignLevels';
import { EDITOR_GRID_COLS, createEmptyEditorRows } from '../src/game/levels/editorGrid';
import { SaveSystem } from '../src/game/systems/SaveSystem';
import { LevelSystem } from '../src/game/systems/LevelSystem';
import type { KeyValueStorage } from '../src/game/utils/storage';

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

function makeOneBrickRows(): string[] {
  const rows = createEmptyEditorRows();
  rows[0] = `1${'.'.repeat(EDITOR_GRID_COLS - 1)}`;
  return rows;
}

describe('level system custom overrides', () => {
  it('exposes the full 24-level campaign', () => {
    expect(campaignLevels).toHaveLength(24);
    expect(new LevelSystem(new SaveSystem(new MemoryStorage())).count).toBe(24);
  });

  it('keeps campaign levels fixed when a saved override exists', () => {
    const save = new SaveSystem(new MemoryStorage());
    save.setCustomLevelOverride(0, makeOneBrickRows(), 'Tiny Custom', 1000);

    const level = new LevelSystem(save).getLevel(0);

    expect(level.id).toBe(campaignLevels[0].id);
    expect(level.name).toBe(campaignLevels[0].name);
  });

  it('returns a custom level only when explicitly requested', () => {
    const save = new SaveSystem(new MemoryStorage());
    save.setCustomLevelOverride(0, makeOneBrickRows(), 'Tiny Custom', 1000);

    const level = new LevelSystem(save).getLevel(0, 'custom');

    expect(level.id).toBe('custom-slot-0');
    expect(level.name).toBe('Tiny Custom');
    expect(level.bricks).toHaveLength(1);
  });

  it('returns to the campaign level after resetting the custom slot', () => {
    const save = new SaveSystem(new MemoryStorage());
    save.setCustomLevelOverride(0, makeOneBrickRows(), 'Tiny Custom', 1000);
    const levelSystem = new LevelSystem(save);

    save.removeCustomLevelOverride(0);

    expect(levelSystem.getLevel(0).id).toBe(campaignLevels[0].id);
    expect(levelSystem.hasCustomLevelOverride(0)).toBe(false);
  });
});
