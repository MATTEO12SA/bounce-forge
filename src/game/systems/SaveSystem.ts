import { getTheme } from '../config/themeConfig';
import { isValidEditorRows, normalizeEditorRows, validateEditorRows } from '../levels/editorGrid';
import { sanitizeLevelName } from '../levels/levelNames';
import type { CreativeLevelSlot } from '../levels/levelTypes';
import { SAVE_STORAGE_KEY } from '../utils/constants';
import {
  createMemoryStorage,
  getBrowserStorage,
  saveJson,
  type KeyValueStorage
} from '../utils/storage';

export type FxQuality = 'low' | 'med' | 'high';
export type Language = 'fr' | 'en';

export interface SavePreferences {
  soundEnabled: boolean;
  themeId: string;
  volumeSfx: number;
  volumeMusic: number;
  fxQuality: FxQuality;
  fullscreen: boolean;
  language: Language;
  reducedMotion: boolean;
}

export interface EndlessRecord {
  bestScore: number;
  bestWave: number;
}

export interface DailyRecord {
  bestScore: number;
  wavesCleared: number;
  attempts: number;
}

export interface ModeRecords {
  endless: EndlessRecord;
  daily: Record<string, DailyRecord>;
}

export type LevelMedal = 'bronze' | 'silver' | 'gold';

export interface SaveData {
  version: 6;
  bestScore: number;
  unlockedLevel: number;
  completedLevels: number[];
  levelMedals: Record<string, LevelMedal>;
  preferences: SavePreferences;
  creativeLevelSlots: Record<string, CreativeLevelSlot>;
  tutorialSeen: boolean;
  records: ModeRecords;
}

interface LegacySaveData {
  version: 1 | 2 | 3 | 4 | 5;
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
    language?: string;
    reducedMotion?: boolean;
  };
  levelMedals?: Record<string, LevelMedal>;
  customLevelOverrides?: Record<string, CreativeLevelSlot>;
  creativeLevelSlots?: Record<string, CreativeLevelSlot>;
  tutorialSeen?: boolean;
  records?: unknown;
}

const MAX_DAILY_RECORDS = 60;

function detectDefaultLanguage(): Language {
  if (typeof navigator === 'undefined') {
    return 'fr';
  }
  const lang = (navigator.language || '').toLowerCase();
  return lang.startsWith('en') ? 'en' : 'fr';
}

function detectReducedMotion(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

const DEFAULT_PREFERENCES: SavePreferences = {
  soundEnabled: true,
  themeId: 'forge',
  volumeSfx: 0.7,
  volumeMusic: 0.5,
  fxQuality: 'med',
  fullscreen: false,
  language: 'fr',
  reducedMotion: false
};

export const DEFAULT_SAVE_DATA: SaveData = {
  version: 6,
  bestScore: 0,
  unlockedLevel: 0,
  completedLevels: [],
  levelMedals: {},
  preferences: { ...DEFAULT_PREFERENCES },
  creativeLevelSlots: {},
  tutorialSeen: false,
  records: { endless: { bestScore: 0, bestWave: 0 }, daily: {} }
};

function createDefaultSaveData(): SaveData {
  return {
    ...DEFAULT_SAVE_DATA,
    completedLevels: [],
    levelMedals: {},
    preferences: {
      ...DEFAULT_PREFERENCES,
      language: detectDefaultLanguage(),
      reducedMotion: detectReducedMotion()
    },
    creativeLevelSlots: {},
    records: { endless: { bestScore: 0, bestWave: 0 }, daily: {} }
  };
}

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

  return (
    (value.version === 4 || value.version === 5 || value.version === 6) &&
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
  key: string
): PersistedSaveData | null {
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(key);

    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    return isPersistedSaveData(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sanitizeCreativeLevelSlots(overrides: unknown): Record<string, CreativeLevelSlot> {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return {};
  }

  const sanitized: Record<string, CreativeLevelSlot> = {};

  Object.values(overrides).forEach((value) => {
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

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeRecords(value: unknown): ModeRecords {
  const records: ModeRecords = { endless: { bestScore: 0, bestWave: 0 }, daily: {} };
  if (!value || typeof value !== 'object') {
    return records;
  }

  const candidate = value as { endless?: Partial<EndlessRecord>; daily?: unknown };
  if (candidate.endless && typeof candidate.endless === 'object') {
    records.endless = {
      bestScore: nonNegativeInt(candidate.endless.bestScore),
      bestWave: nonNegativeInt(candidate.endless.bestWave)
    };
  }

  if (candidate.daily && typeof candidate.daily === 'object' && !Array.isArray(candidate.daily)) {
    Object.entries(candidate.daily as Record<string, Partial<DailyRecord> | null>).forEach(
      ([key, entry]) => {
        if (DATE_KEY_PATTERN.test(key) && entry && typeof entry === 'object') {
          records.daily[key] = {
            bestScore: nonNegativeInt(entry.bestScore),
            wavesCleared: Math.min(3, nonNegativeInt(entry.wavesCleared)),
            attempts: nonNegativeInt(entry.attempts)
          };
        }
      }
    );
  }

  return records;
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
      typeof prefs.fullscreen === 'boolean' ? prefs.fullscreen : DEFAULT_PREFERENCES.fullscreen,
    language:
      prefs.language === 'en' || prefs.language === 'fr' ? prefs.language : detectDefaultLanguage(),
    reducedMotion:
      typeof prefs.reducedMotion === 'boolean' ? prefs.reducedMotion : detectReducedMotion()
  };
}

export function migrateSaveData(value: PersistedSaveData): SaveData {
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
    version: 6,
    bestScore: Math.max(0, Math.floor(value.bestScore)),
    unlockedLevel: Math.max(0, Math.floor(value.unlockedLevel)),
    completedLevels: value.completedLevels
      .filter((level): level is number => typeof level === 'number' && Number.isFinite(level))
      .map((level) => Math.max(0, Math.floor(level)))
      .sort((a, b) => a - b),
    levelMedals,
    preferences: migratePreferences(value.preferences),
    creativeLevelSlots,
    tutorialSeen: 'tutorialSeen' in value && value.tutorialSeen === true,
    records: sanitizeRecords('records' in value ? value.records : undefined)
  };
}

type SaveListener = (data: SaveData) => void;

export class SaveSystem {
  private data: SaveData;
  private readonly listeners = new Set<SaveListener>();

  public constructor(private readonly storage: KeyValueStorage | null = getBrowserStorage()) {
    const persisted = loadPersistedSaveData(this.storage, SAVE_STORAGE_KEY);
    this.data = persisted ? migrateSaveData(persisted) : createDefaultSaveData();

    if (persisted && persisted.version !== this.data.version) {
      this.persist();
    }
  }

  /** Subscribes to every persisted change. Returns an unsubscribe callback. */
  public subscribe(listener: SaveListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public snapshot(): SaveData {
    return {
      ...this.data,
      completedLevels: [...this.data.completedLevels],
      levelMedals: { ...this.data.levelMedals },
      preferences: { ...this.data.preferences },
      creativeLevelSlots: this.cloneCreativeLevelSlots(),
      records: {
        endless: { ...this.data.records.endless },
        daily: Object.fromEntries(
          Object.entries(this.data.records.daily).map(([key, value]) => [key, { ...value }])
        )
      }
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

  public setLanguage(language: Language): SaveData {
    this.data.preferences.language = language === 'en' ? 'en' : 'fr';
    this.persist();
    return this.snapshot();
  }

  public setReducedMotion(enabled: boolean): SaveData {
    this.data.preferences.reducedMotion = enabled;
    this.persist();
    return this.snapshot();
  }

  public setTutorialSeen(seen = true): SaveData {
    this.data.tutorialSeen = seen;
    this.persist();
    return this.snapshot();
  }

  /** Records an endless run. Returns true when the score is a new personal best. */
  public recordEndlessRun(score: number, wave: number): boolean {
    const record = this.data.records.endless;
    const safeScore = Math.max(0, Math.floor(score));
    const isNewBest = safeScore > record.bestScore;
    record.bestScore = Math.max(record.bestScore, safeScore);
    record.bestWave = Math.max(record.bestWave, Math.max(0, Math.floor(wave)));
    this.persist();
    return isNewBest;
  }

  /** Records a daily challenge attempt. Returns true when it beats the stored best. */
  public recordDailyRun(dateKey: string, score: number, wavesCleared: number): boolean {
    if (!DATE_KEY_PATTERN.test(dateKey)) {
      return false;
    }

    const current = this.data.records.daily[dateKey] ?? {
      bestScore: 0,
      wavesCleared: 0,
      attempts: 0
    };
    const safeScore = Math.max(0, Math.floor(score));
    const isNewBest = safeScore > current.bestScore;
    this.data.records.daily[dateKey] = {
      bestScore: Math.max(current.bestScore, safeScore),
      wavesCleared: Math.max(
        current.wavesCleared,
        Math.min(3, Math.max(0, Math.floor(wavesCleared)))
      ),
      attempts: current.attempts + 1
    };

    const keys = Object.keys(this.data.records.daily).sort();
    keys.slice(0, Math.max(0, keys.length - MAX_DAILY_RECORDS)).forEach((key) => {
      delete this.data.records.daily[key];
    });

    this.persist();
    return isNewBest;
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
    const language = this.data.preferences.language;
    this.data = createDefaultSaveData();
    this.data.preferences.language = language;
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
    if (this.listeners.size > 0) {
      const snapshot = this.snapshot();
      this.listeners.forEach((listener) => listener(snapshot));
    }
  }
}

let sharedSaveSystem: SaveSystem | null = null;

/**
 * Single save instance shared by the HTML interface, the game scenes and the editor so that
 * concurrent writers never overwrite each other's progress. Falls back to in-memory storage
 * when the browser blocks localStorage (private mode, blocked site data...).
 */
export function getSharedSaveSystem(): SaveSystem {
  sharedSaveSystem ??= new SaveSystem(getBrowserStorage() ?? createMemoryStorage());
  return sharedSaveSystem;
}

export function isPersistentStorageAvailable(): boolean {
  return getBrowserStorage() !== null;
}
