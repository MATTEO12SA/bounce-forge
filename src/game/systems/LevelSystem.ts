import { campaignLevels } from '../levels/campaignLevels';
import { createPatternFromCustomOverride, normalizeEditorRows } from '../levels/editorGrid';
import { createLevelFromPattern } from '../levels/levelFactory';
import { LEVEL_PATTERNS } from '../levels/levelPatterns';
import type { CustomLevelOverride, LevelDefinition, PatternDefinition } from '../levels/levelTypes';
import { clamp } from '../utils/math';
import { SaveSystem } from './SaveSystem';

export type LevelSource = 'campaign' | 'custom';

export class LevelSystem {
  public constructor(private readonly saveSystem = new SaveSystem()) {}

  public get count(): number {
    return campaignLevels.length;
  }

  public getLevel(levelIndex: number, source: LevelSource = 'campaign'): LevelDefinition {
    const safeIndex = Math.floor(clamp(levelIndex, 0, campaignLevels.length - 1));

    if (source === 'custom') {
      return this.getCustomLevel(safeIndex) ?? campaignLevels[safeIndex];
    }

    return campaignLevels[safeIndex];
  }

  public getCampaignLevel(levelIndex: number): LevelDefinition {
    const safeIndex = Math.floor(clamp(levelIndex, 0, campaignLevels.length - 1));
    return campaignLevels[safeIndex];
  }

  public getCustomLevel(levelIndex: number): LevelDefinition | null {
    const safeIndex = Math.floor(clamp(levelIndex, 0, campaignLevels.length - 1));
    const override = this.saveSystem.getCustomLevelOverride(safeIndex);

    if (override) {
      try {
        return this.createLevelFromOverride(override, safeIndex);
      } catch {
        return null;
      }
    }

    return null;
  }

  public getPatternForEditing(levelIndex: number): PatternDefinition {
    const safeIndex = Math.floor(clamp(levelIndex, 0, LEVEL_PATTERNS.length - 1));
    const override = this.saveSystem.getCustomLevelOverride(safeIndex);

    if (override) {
      try {
        return createPatternFromCustomOverride(override);
      } catch {
        return {
          ...LEVEL_PATTERNS[safeIndex],
          rows: normalizeEditorRows(LEVEL_PATTERNS[safeIndex].rows)
        };
      }
    }

    return {
      ...LEVEL_PATTERNS[safeIndex],
      rows: normalizeEditorRows(LEVEL_PATTERNS[safeIndex].rows)
    };
  }

  public hasCustomLevelOverride(levelIndex: number): boolean {
    const safeIndex = Math.floor(clamp(levelIndex, 0, campaignLevels.length - 1));
    return Boolean(this.saveSystem.getCustomLevelOverride(safeIndex));
  }

  public hasNext(levelIndex: number): boolean {
    return levelIndex + 1 < campaignLevels.length;
  }

  private createLevelFromOverride(
    override: CustomLevelOverride,
    levelIndex: number
  ): LevelDefinition {
    const pattern = createPatternFromCustomOverride(override);
    return createLevelFromPattern(pattern, levelIndex);
  }
}
