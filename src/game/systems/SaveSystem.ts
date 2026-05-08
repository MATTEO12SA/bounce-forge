import { getTheme } from '../config/themeConfig';
import { isValidEditorRows, normalizeEditorRows, validateEditorRows } from '../levels/editorGrid';
import { sanitizeLevelName } from '../levels/levelNames';
import type { CreativeLevelSlot } from '../levels/levelTypes';
import { SAVE_STORAGE_KEY } from '../utils/constants';
import { getBrowserStorage, saveJson, type KeyValueStorage } from '../utils/storage';

export type FxQuality = 'low' | 'med' | 'high';

export interface SavePreferences {
  soundEnabled: boolean;
  themeId: string;
  volumeSfx: number;
  volumeMusic: number;
  fxQuality: FxQuality;
  fullscreen: boolean;
}

export type LevelMedal = 'bronze' | 'silver' | 'gold';

export interface SaveData {
  version: 5;
  bestScore: number;
  unlockedLevel: number;
  completedLevels: number[];
  levelMedals: Record<string, LevelMedal>;
  preferences: SavePreferences;
  creativeLevelSlots: Record<string, CreativeLevelSlot>;
}

interface LegacySaveData {
  version: 1 | 2 | 3 | 4;
  bestScore: number;
  unlockedLevel: number;
  completedLevels: number[];
  preferences: {
    soundEnabled: boolean;
    themeId: string;
    volumeSfx?: number;
    volumeMusic?: number;
    fxQuality?: string;
    fullscreen?: boolean;
  };
  levelMedals?: Record<string, LevelMedal>;
  customLevelOverrides?: Record<string, CreativeLevelSlot>;
  creativeLevelSlots?: Record<string, CreativeLevelSlot>;
}

const DEFAULT_PREFERENCES: SavePreferences = {
  soundEnabled: true,
  themeId: 'forge',
  volumeSfx: 0.7,
  volumeMusic: 0.5,
  fxQuality: 'med',
  fullscreen: false
};

export const DEFAULT_SAVE_DATA: SaveData = {
  version: 5,
  bestScore: 0,
  unlockedLevel: 0,
  completedLevels: [],
  levelMedals: {},
  preferences: { ...DEFAULT_PREFERENCES },
  creativeLevelSlots: {}
};

type PersistedSaveData = SaveData | LegacySaveData;

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

  if (value.version === 1 || value.version === 2 || value.version === 3) {
    return true;
  }

  if (value.version === 4) {
    return (
      Boolean(value.levelMedals) &&
      typeof value.levelMedals === 'object' &&
      !Array.isArray(value.levelMedals) &&
      Boolean(value.creativeLevelSlots) &&
      typeof value.creativeLevelSlots === 'object' &&
      !Array.isArray(value.creativeLevelSlots)
    );
  }

  return (
    value.version === 5 &&
    Boolean(value.levelMedals) &&
    typeof value.levelMedals === 'object' &&
    !Array.isArray(value.levelMedals) &&
    Boolean(value.creativeLevelSlots) &&
    typeof value.creativeLevelSlots === 'object' &&
    !Array.isArray(value.creativeLevelSlots)
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

function sanitizeCreativeLevelSlots(overrides: unknown): Record<string, CreativeLevelSlot> {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return {};
  }

  const sanitized: Record<string, CreativeLevelSlot> = {};

  Object.entries(overrides).forEach(([key, value]) => {
    if (!value || typeof value !== 'object') {
      return;
    }

    const candidate = value as Partial<CreativeLevelSlot>;

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
      name: sanitizeLevelName(candidate.name, `Creative ${safeSlotIndex + 1}`),
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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function normalizeFxQuality(value: unknown): FxQuality {
  return value === 'low' || value === 'high' ? value : 'med';
}

function migratePreferences(prefs: LegacySaveData['preferences']): SavePreferences {
  return {
    soundEnabled: prefs.soundEnabled,
    themeId: getTheme(prefs.themeId).id,
    volumeSfx:
      typeof prefs.volumeSfx === 'number'
        ? clamp01(prefs.volumeSfx)
        : DEFAULT_PREFERENCES.volumeSfx,
    volumeMusic:
      typeof prefs.volumeMusic === 'number'
        ? clamp01(prefs.volumeMusic)
        : DEFAULT_PREFERENCES.volumeMusic,
    fxQuality: normalizeFxQuality(prefs.fxQuality),
    fullscreen:
      typeof prefs.fullscreen === 'boolean' ? prefs.fullscreen : DEFAULT_PREFERENCES.fullscreen
  };
}

function migrateSaveData(value: PersistedSaveData): SaveData {
  const legacyOverrides = 'customLevelOverrides' in value ? value.customLevelOverrides : undefined;
  const persistedCreativeSlots =
    'creativeLevelSlots' in value ? value.creativeLevelSlots : undefined;
  const legacyCreativeSlots = value.version >= 2 ? sanitizeCreativeLevelSlots(legacyOverrides) : {};
  const creativeLevelSlots =
    value.version >= 4 ? sanitizeCreativeLevelSlots(persistedCreativeSlots) : legacyCreativeSlots;
  const levelMedals = value.version >= 3 ? sanitizeLevelMedals(value.levelMedals) : {};

  value.completedLevels.forEach((level) => {
    if (typeof level === 'number' && Number.isFinite(level)) {
      const key = String(Math.max(0, Math.floor(level)));
      levelMedals[key] ??= 'bronze';
    }
  });

  return {
    version: 5,
    bestScore: Math.max(0, Math.floor(value.bestScore)),
    unlockedLevel: Math.max(0, Math.floor(value.unlockedLevel)),
    completedLevels: value.completedLevels
      .filter((level): level is number => typeof level === 'number' && Number.isFinite(level))
      .map((level) => Math.max(0, Math.floor(level)))
      .sort((a, b) => a - b),
    levelMedals,
    preferences: migratePreferences(value.preferences),
    creativeLevelSlots
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
      creativeLevelSlots: this.cloneCreativeLevelSlots()
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

  public setVolumeSfx(value: number): SaveData {
    this.data.preferences.volumeSfx = clamp01(value);
    this.persist();
    return this.snapshot();
  }

  public setVolumeMusic(value: number): SaveData {
    this.data.preferences.volumeMusic = clamp01(value);
    this.persist();
    return this.snapshot();
  }

  public setFxQuality(quality: FxQuality): SaveData {
    this.data.preferences.fxQuality = normalizeFxQuality(quality);
    this.persist();
    return this.snapshot();
  }

  public setFullscreen(enabled: boolean): SaveData {
    this.data.preferences.fullscreen = enabled;
    this.persist();
    return this.snapshot();
  }

  public getCreativeLevelSlot(slotIndex: number): CreativeLevelSlot | null {
    return this.cloneCreativeLevelSlot(this.data.creativeLevelSlots[String(slotIndex)]);
  }

  public setCreativeLevelSlot(
    slotIndex: number,
    rows: readonly string[],
    name = `Custom ${slotIndex + 1}`,
    updatedAt = Date.now()
  ): SaveData {
    const safeSlotIndex = Math.max(0, Math.floor(slotIndex));
    const normalizedRows = normalizeEditorRows(rows);
    const validation = validateEditorRows(normalizedRows);

    if (!validation.valid) {
      throw new Error(validation.message);
    }

    this.data.creativeLevelSlots[String(safeSlotIndex)] = {
      slotIndex: safeSlotIndex,
      name: sanitizeLevelName(name, `Creative ${safeSlotIndex + 1}`),
      rows: normalizedRows,
      updatedAt
    };
    this.persist();
    return this.snapshot();
  }

  public removeCreativeLevelSlot(slotIndex: number): SaveData {
    delete this.data.creativeLevelSlots[String(slotIndex)];
    this.persist();
    return this.snapshot();
  }

  public getCustomLevelOverride(slotIndex: number): CreativeLevelSlot | null {
    return this.getCreativeLevelSlot(slotIndex);
  }

  public setCustomLevelOverride(
    slotIndex: number,
    rows: readonly string[],
    name = `Creative ${slotIndex + 1}`,
    updatedAt = Date.now()
  ): SaveData {
    return this.setCreativeLevelSlot(slotIndex, rows, name, updatedAt);
  }

  public removeCustomLevelOverride(slotIndex: number): SaveData {
    return this.removeCreativeLevelSlot(slotIndex);
  }

  public reset(): SaveData {
    this.data = {
      ...DEFAULT_SAVE_DATA,
      completedLevels: [],
      levelMedals: {},
      preferences: { ...DEFAULT_SAVE_DATA.preferences },
      creativeLevelSlots: {}
    };
    this.persist();
    return this.snapshot();
  }

  private cloneCreativeLevelSlots(): Record<string, CreativeLevelSlot> {
    return Object.fromEntries(
      Object.entries(this.data.creativeLevelSlots).map(([slotIndex, override]) => [
        slotIndex,
        {
          ...override,
          rows: [...override.rows]
        }
      ])
    );
  }

  private cloneCreativeLevelSlot(
    override: CreativeLevelSlot | undefined
  ): CreativeLevelSlot | null {
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
