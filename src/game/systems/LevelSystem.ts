import { campaignLevels } from '../levels/campaignLevels';
import {
  createPatternFromCreativeSlot,
  createPatternFromEditorRows,
  normalizeEditorRows
} from '../levels/editorGrid';
import { createLevelFromPattern } from '../levels/levelFactory';
import { LEVEL_PATTERNS } from '../levels/levelPatterns';
import type { CreativeLevelSlot, LevelDefinition, PatternDefinition } from '../levels/levelTypes';
import { clamp } from '../utils/math';
import { CampaignOverrideSystem } from './CampaignOverrideSystem';
import { SaveSystem } from './SaveSystem';

export type LevelSource = 'campaign' | 'creative';

export class LevelSystem {
  public constructor(private readonly saveSystem = new SaveSystem()) {}

  public get count(): number {
    return campaignLevels.length;
  }

  public getLevel(levelIndex: number, source: LevelSource = 'campaign'): LevelDefinition {
    const safeIndex = Math.floor(clamp(levelIndex, 0, campaignLevels.length - 1));

    if (source === 'creative') {
      return this.getCreativeLevel(safeIndex) ?? this.createEmptyCreativeLevel(safeIndex);
    }

    return this.getCampaignLevel(safeIndex);
  }

  public getCampaignLevel(levelIndex: number): LevelDefinition {
    const safeIndex = Math.floor(clamp(levelIndex, 0, campaignLevels.length - 1));
    const fallback = campaignLevels[safeIndex];

    if (!fallback) {
      throw new Error(`Campaign level ${safeIndex} is not defined.`);
    }

    const override = CampaignOverrideSystem.getOverride(safeIndex);

    if (!override) {
      return fallback;
    }

    try {
      return CampaignOverrideSystem.createLevelFromOverride(override, fallback);
    } catch {
      return fallback;
    }
  }

  public getCreativeLevel(levelIndex: number): LevelDefinition | null {
    const safeIndex = Math.floor(clamp(levelIndex, 0, campaignLevels.length - 1));
    const slot = this.saveSystem.getCreativeLevelSlot(safeIndex);

    if (slot) {
      try {
        return this.createLevelFromSlot(slot, safeIndex);
      } catch {
        return null;
      }
    }

    return null;
  }

  public getCustomLevel(levelIndex: number): LevelDefinition | null {
    return this.getCreativeLevel(levelIndex);
  }

  public getCreativePatternForEditing(levelIndex: number): PatternDefinition {
    const safeIndex = Math.floor(clamp(levelIndex, 0, LEVEL_PATTERNS.length - 1));
    const slot = this.saveSystem.getCreativeLevelSlot(safeIndex);

    if (slot) {
      try {
        return createPatternFromCreativeSlot(slot);
      } catch {
        return this.createEmptyCreativePattern(safeIndex);
      }
    }

    return this.createEmptyCreativePattern(safeIndex);
  }

  public getAdminPatternForEditing(levelIndex: number): PatternDefinition {
    const safeIndex = Math.floor(clamp(levelIndex, 0, campaignLevels.length - 1));
    const fallbackPattern = LEVEL_PATTERNS[safeIndex];

    if (!fallbackPattern) {
      throw new Error(`Pattern ${safeIndex} is not defined.`);
    }

    const override = CampaignOverrideSystem.getOverride(safeIndex);

    if (override) {
      try {
        return createPatternFromEditorRows(safeIndex, override.name, override.rows);
      } catch {
        return {
          ...fallbackPattern,
          rows: normalizeEditorRows(fallbackPattern.rows)
        };
      }
    }

    return {
      ...fallbackPattern,
      rows: normalizeEditorRows(fallbackPattern.rows)
    };
  }

  public getOfficialPatternForEditing(levelIndex: number): PatternDefinition {
    const safeIndex = Math.floor(clamp(levelIndex, 0, LEVEL_PATTERNS.length - 1));
    const pattern = LEVEL_PATTERNS[safeIndex];

    if (!pattern) {
      throw new Error(`Pattern ${safeIndex} is not defined.`);
    }

    return {
      ...pattern,
      rows: normalizeEditorRows(pattern.rows)
    };
  }

  public getPatternForEditing(levelIndex: number): PatternDefinition {
    return this.getCreativePatternForEditing(levelIndex);
  }

  public hasCreativeLevelSlot(levelIndex: number): boolean {
    const safeIndex = Math.floor(clamp(levelIndex, 0, campaignLevels.length - 1));
    return Boolean(this.saveSystem.getCreativeLevelSlot(safeIndex));
  }

  public hasCustomLevelOverride(levelIndex: number): boolean {
    return this.hasCreativeLevelSlot(levelIndex);
  }

  public hasAdminCampaignOverride(levelIndex: number): boolean {
    return Boolean(CampaignOverrideSystem.getOverride(levelIndex));
  }

  public hasNext(levelIndex: number): boolean {
    return levelIndex + 1 < campaignLevels.length;
  }

  private createLevelFromSlot(override: CreativeLevelSlot, levelIndex: number): LevelDefinition {
    const pattern = createPatternFromCreativeSlot(override);
    return createLevelFromPattern(pattern, levelIndex);
  }

  private createEmptyCreativePattern(slotIndex: number): PatternDefinition {
    return {
      id: `creative-slot-${slotIndex}`,
      name: `Creative ${slotIndex + 1}`,
      rows: normalizeEditorRows([])
    };
  }

  private createEmptyCreativeLevel(slotIndex: number): LevelDefinition {
    const rows = normalizeEditorRows([]);
    const firstRow = rows[0] ?? '';
    rows[0] = `1${'.'.repeat(Math.max(0, firstRow.length - 1))}`;
    return createLevelFromPattern(
      {
        id: `creative-slot-${slotIndex}`,
        name: `Creative ${slotIndex + 1}`,
        rows
      },
      slotIndex
    );
  }
}
