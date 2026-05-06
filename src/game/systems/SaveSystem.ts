import { getTheme } from '../config/themeConfig';
import { isValidEditorRows, normalizeEditorRows, validateEditorRows } from '../levels/editorGrid';
import type { CustomLevelOverride } from '../levels/levelTypes';
import { SAVE_STORAGE_KEY } from '../utils/constants';
import { getBrowserStorage, saveJson, type KeyValueStorage } from '../utils/storage';

export interface SavePreferences {
  soundEnabled: boolean;
  themeId: string;
}

export type LevelMedal = 'bronze' | 'silver' | 'gold';

export interface SaveData {
  version: 3;
  bestScore: number;
  unlockedLevel: number;
  completedLevels: number[];
  levelMedals: Record<string, LevelMedal>;
  preferences: SavePreferences;
  customLevelOverrides: Record<string, CustomLevelOverride>;
}

interface SaveDataV2 {
  version: 1 | 2;
  bestScore: number;
  unlockedLevel: number;
  completedLevels: number[];
  preferences: SavePreferences;
  customLevelOverrides?: Record<string, CustomLevelOverride>;
}

export const DEFAULT_SAVE_DATA: SaveData = {
  version: 3,
  bestScore: 0,
  unlockedLevel: 0,
  completedLevels: [],
  levelMedals: {},
  preferences: {
    soundEnabled: true,
    themeId: 'forge'
  },
  customLevelOverrides: {}
};

type PersistedSaveData = SaveData | SaveDataV2;

function hasBaseSaveFields(value: unknown): value is Partial<PersistedSaveData> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<PersistedSaveData>;
  return (
    typeof candidate.bestScore === 'number' &&
    typeof candidate.unlockedLevel === 'number' &&
    Array.isArray(candidate.completedLevels) &&
    typeof candidate.preferences?.soundEnabled === 'boolean' &&
    typeof candidate.preferences.themeId === 'string'
  );
}

function isPersistedSaveData(value: unknown): value is PersistedSaveData {
  if (!hasBaseSaveFields(value)) {
    return false;
  }

  if (value.version === 1) {
    return true;
  }

  if (value.version === 2) {
    return true;
  }

  return (
    value.version === 3 &&
    Boolean(value.levelMedals) &&
    typeof value.levelMedals === 'object' &&
    !Array.isArray(value.levelMedals) &&
    Boolean(value.customLevelOverrides) &&
    typeof value.customLevelOverrides === 'object' &&
    !Array.isArray(value.customLevelOverrides)
  );
}

function loadPersistedSaveData(
  storage: KeyValueStorage | null,
  key: string,
  fallback: SaveData
): PersistedSaveData {
  if (!storage) {
    return fallback;
  }

  try {
    const raw = storage.getItem(key);

    if (!raw) {
      return fallback;
    }

    const parsed: unknown = JSON.parse(raw);
    return isPersistedSaveData(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function sanitizeCustomLevelOverrides(overrides: unknown): Record<string, CustomLevelOverride> {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return {};
  }

  const sanitized: Record<string, CustomLevelOverride> = {};

  Object.entries(overrides).forEach(([key, value]) => {
    if (!value || typeof value !== 'object') {
      return;
    }

    const candidate = value as Partial<CustomLevelOverride>;

    if (
      typeof candidate.slotIndex !== 'number' ||
      typeof candidate.name !== 'string' ||
      typeof candidate.updatedAt !== 'number' ||
      !Array.isArray(candidate.rows)
    ) {
      return;
    }

    const rows = normalizeEditorRows(candidate.rows);

    if (!isValidEditorRows(rows)) {
      return;
    }

    const safeSlotIndex = Math.max(0, Math.floor(candidate.slotIndex));
    sanitized[String(safeSlotIndex)] = {
      slotIndex: safeSlotIndex,
      name: candidate.name,
      rows,
      updatedAt: candidate.updatedAt
    };

    if (key !== String(safeSlotIndex)) {
      delete sanitized[key];
    }
  });

  return sanitized;
}

const MEDAL_RANK: Record<LevelMedal, number> = {
  bronze: 1,
  silver: 2,
  gold: 3
};

function sanitizeLevelMedals(medals: unknown): Record<string, LevelMedal> {
  if (!medals || typeof medals !== 'object' || Array.isArray(medals)) {
    return {};
  }

  const sanitized: Record<string, LevelMedal> = {};

  Object.entries(medals).forEach(([key, value]) => {
    if (value === 'bronze' || value === 'silver' || value === 'gold') {
      sanitized[String(Math.max(0, Math.floor(Number(key) || 0)))] = value;
    }
  });

  return sanitized;
}

function migrateSaveData(value: PersistedSaveData): SaveData {
  const customLevelOverrides =
    value.version >= 2 ? sanitizeCustomLevelOverrides(value.customLevelOverrides) : {};
  const levelMedals = value.version === 3 ? sanitizeLevelMedals(value.levelMedals) : {};

  value.completedLevels.forEach((level) => {
    if (typeof level === 'number' && Number.isFinite(level)) {
      const key = String(Math.max(0, Math.floor(level)));
      levelMedals[key] ??= 'bronze';
    }
  });

  return {
    version: 3,
    bestScore: Math.max(0, Math.floor(value.bestScore)),
    unlockedLevel: Math.max(0, Math.floor(value.unlockedLevel)),
    completedLevels: value.completedLevels
      .filter((level): level is number => typeof level === 'number' && Number.isFinite(level))
      .map((level) => Math.max(0, Math.floor(level)))
      .sort((a, b) => a - b),
    levelMedals,
    preferences: {
      soundEnabled: value.preferences.soundEnabled,
      themeId: getTheme(value.preferences.themeId).id
    },
    customLevelOverrides
  };
}

export class SaveSystem {
  private data: SaveData;

  public constructor(private readonly storage: KeyValueStorage | null = getBrowserStorage()) {
    const persisted = loadPersistedSaveData(this.storage, SAVE_STORAGE_KEY, DEFAULT_SAVE_DATA);
    this.data = migrateSaveData(persisted);

    if (persisted.version !== this.data.version) {
      this.persist();
    }
  }

  public snapshot(): SaveData {
    return {
      ...this.data,
      completedLevels: [...this.data.completedLevels],
      levelMedals: { ...this.data.levelMedals },
      preferences: { ...this.data.preferences },
      customLevelOverrides: this.cloneCustomLevelOverrides()
    };
  }

  public updateBestScore(score: number): SaveData {
    this.data.bestScore = Math.max(this.data.bestScore, Math.floor(score));
    this.persist();
    return this.snapshot();
  }

  public completeLevel(levelIndex: number, medal: LevelMedal = 'bronze'): SaveData {
    if (!this.data.completedLevels.includes(levelIndex)) {
      this.data.completedLevels.push(levelIndex);
      this.data.completedLevels.sort((a, b) => a - b);
    }

    const key = String(Math.max(0, Math.floor(levelIndex)));
    const current = this.data.levelMedals[key];
    if (!current || MEDAL_RANK[medal] > MEDAL_RANK[current]) {
      this.data.levelMedals[key] = medal;
    }

    this.data.unlockedLevel = Math.max(this.data.unlockedLevel, levelIndex + 1);
    this.persist();
    return this.snapshot();
  }

  public getLevelMedal(levelIndex: number): LevelMedal | null {
    return this.data.levelMedals[String(Math.max(0, Math.floor(levelIndex)))] ?? null;
  }

  public setSoundEnabled(enabled: boolean): SaveData {
    this.data.preferences.soundEnabled = enabled;
    this.persist();
    return this.snapshot();
  }

  public setTheme(themeId: string): SaveData {
    this.data.preferences.themeId = getTheme(themeId).id;
    this.persist();
    return this.snapshot();
  }

  public getCustomLevelOverride(slotIndex: number): CustomLevelOverride | null {
    return this.cloneCustomLevelOverride(this.data.customLevelOverrides[String(slotIndex)]);
  }

  public setCustomLevelOverride(
    slotIndex: number,
    rows: readonly string[],
    name = `Custom ${slotIndex + 1}`,
    updatedAt = Date.now()
  ): SaveData {
    const normalizedRows = normalizeEditorRows(rows);
    const validation = validateEditorRows(normalizedRows);

    if (!validation.valid) {
      throw new Error(validation.message);
    }

    const safeSlotIndex = Math.max(0, Math.floor(slotIndex));
    this.data.customLevelOverrides[String(safeSlotIndex)] = {
      slotIndex: safeSlotIndex,
      name,
      rows: normalizedRows,
      updatedAt
    };
    this.persist();
    return this.snapshot();
  }

  public removeCustomLevelOverride(slotIndex: number): SaveData {
    delete this.data.customLevelOverrides[String(slotIndex)];
    this.persist();
    return this.snapshot();
  }

  public reset(): SaveData {
    this.data = {
      ...DEFAULT_SAVE_DATA,
      completedLevels: [],
      levelMedals: {},
      preferences: { ...DEFAULT_SAVE_DATA.preferences },
      customLevelOverrides: {}
    };
    this.persist();
    return this.snapshot();
  }

  private cloneCustomLevelOverrides(): Record<string, CustomLevelOverride> {
    return Object.fromEntries(
      Object.entries(this.data.customLevelOverrides).map(([slotIndex, override]) => [
        slotIndex,
        {
          ...override,
          rows: [...override.rows]
        }
      ])
    );
  }

  private cloneCustomLevelOverride(
    override: CustomLevelOverride | undefined
  ): CustomLevelOverride | null {
    if (!override) {
      return null;
    }

    return {
      ...override,
      rows: [...override.rows]
    };
  }

  private persist(): void {
    saveJson(this.storage, SAVE_STORAGE_KEY, this.data);
  }
}
