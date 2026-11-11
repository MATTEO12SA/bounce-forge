import { describe, expect, it } from 'vitest';
import { campaignLevels } from '../src/game/levels/campaignLevels';
import { EDITOR_GRID_COLS, createEmptyEditorRows } from '../src/game/levels/editorGrid';
import { LevelSystem } from '../src/game/systems/LevelSystem';
import { CampaignOverrideSystem } from '../src/game/systems/CampaignOverrideSystem';
import { SaveSystem } from '../src/game/systems/SaveSystem';
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

describe('level system creative and admin levels', () => {
  it('exposes the full 30-level campaign', () => {
    expect(campaignLevels).toHaveLength(30);
    expect(new LevelSystem(new SaveSystem(new MemoryStorage())).count).toBe(30);
  });

  it('keeps campaign levels fixed when a creative slot exists', () => {
    const save = new SaveSystem(new MemoryStorage());
    save.setCreativeLevelSlot(0, makeOneBrickRows(), 'Tiny Creative', 1000);

    const level = new LevelSystem(save).getLevel(0);

    expect(level.id).toBe(campaignLevels[0]?.id);
    expect(level.name).toBe(campaignLevels[0]?.name);
  });

  it('returns a creative level only when explicitly requested', () => {
    const save = new SaveSystem(new MemoryStorage());
    save.setCreativeLevelSlot(0, makeOneBrickRows(), 'Tiny Creative', 1000);

    const level = new LevelSystem(save).getLevel(0, 'creative');

    expect(level.id).toBe('creative-slot-0');
    expect(level.name).toBe('Tiny Creative');
    expect(level.bricks).toHaveLength(1);
  });

  it('returns to an empty creative slot after resetting the creative level', () => {
    const save = new SaveSystem(new MemoryStorage());
    save.setCreativeLevelSlot(0, makeOneBrickRows(), 'Tiny Creative', 1000);
    const levelSystem = new LevelSystem(save);

    save.removeCreativeLevelSlot(0);

    expect(levelSystem.getLevel(0).id).toBe(campaignLevels[0]?.id);
    expect(levelSystem.hasCreativeLevelSlot(0)).toBe(false);
    expect(
      levelSystem.getCreativePatternForEditing(0).rows.every((row) => row.startsWith('.'))
    ).toBe(true);
  });

  it('applies admin campaign overrides without reading creative slots', () => {
    CampaignOverrideSystem.clear();
    const save = new SaveSystem(new MemoryStorage());
    save.setCreativeLevelSlot(0, makeOneBrickRows(), 'Tiny Creative', 1000);
    CampaignOverrideSystem.setOverride({
      levelIndex: 0,
      name: 'Admin Level',
      rows: makeOneBrickRows(),
      updatedAt: 2000
    });

    const level = new LevelSystem(save).getCampaignLevel(0);

    expect(level.id).toBe(campaignLevels[0]?.id);
    expect(level.name).toBe('Admin Level');
    expect(level.bricks).toHaveLength(1);
    CampaignOverrideSystem.clear();
  });
});
