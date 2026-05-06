import { createPatternFromEditorRows, normalizeEditorRows } from '../levels/editorGrid';
import { createLevelFromPattern } from '../levels/levelFactory';
import type { AdminCampaignOverride, LevelDefinition } from '../levels/levelTypes';
import { clamp } from '../utils/math';
import { AdminApiSystem } from './AdminApiSystem';

export class CampaignOverrideSystem {
  private static readonly overrides = new Map<number, AdminCampaignOverride>();
  private static loaded = false;

  public static async refresh(api = new AdminApiSystem()): Promise<void> {
    try {
      const overrides = await api.getCampaignOverrides();
      this.overrides.clear();
      overrides.forEach((override) => this.setOverride(override));
      this.loaded = true;
    } catch {
      this.loaded = false;
    }
  }

  public static isLoaded(): boolean {
    return this.loaded;
  }

  public static listOverrides(): AdminCampaignOverride[] {
    return [...this.overrides.values()].map((override) => ({
      ...override,
      rows: [...override.rows]
    }));
  }

  public static getOverride(levelIndex: number): AdminCampaignOverride | null {
    const override = this.overrides.get(Math.max(0, Math.floor(levelIndex)));

    if (!override) {
      return null;
    }

    return {
      ...override,
      rows: [...override.rows]
    };
  }

  public static setOverride(override: AdminCampaignOverride): void {
    const safeIndex = Math.max(0, Math.floor(override.levelIndex));
    this.overrides.set(safeIndex, {
      ...override,
      levelIndex: safeIndex,
      rows: normalizeEditorRows(override.rows)
    });
  }

  public static removeOverride(levelIndex: number): void {
    this.overrides.delete(Math.max(0, Math.floor(levelIndex)));
  }

  public static clear(): void {
    this.overrides.clear();
    this.loaded = false;
  }

  public static createLevelFromOverride(
    override: AdminCampaignOverride,
    fallback: LevelDefinition
  ): LevelDefinition {
    const safeIndex = Math.floor(clamp(override.levelIndex, 0, Number.MAX_SAFE_INTEGER));
    const pattern = createPatternFromEditorRows(safeIndex, override.name, override.rows);
    const level = createLevelFromPattern(
      {
        ...pattern,
        id: fallback.id,
        chapter: fallback.chapter,
        objective: fallback.objective,
        medalTargets: fallback.medalTargets
      },
      fallback.index
    );

    return {
      ...level,
      id: fallback.id,
      chapter: fallback.chapter,
      objective: fallback.objective,
      medalTargets: fallback.medalTargets
    };
  }
}
