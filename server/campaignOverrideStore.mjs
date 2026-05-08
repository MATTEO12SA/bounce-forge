import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  EDITOR_GRID_COLS,
  EDITOR_GRID_ROWS,
  normalizeRows,
  validateRows
} from '../shared/editorGridRules.mjs';

export { EDITOR_GRID_COLS, EDITOR_GRID_ROWS, normalizeRows, validateRows };

const MAX_LEVEL_NAME_LENGTH = 120;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

function sanitizeName(name, fallback) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  const safeName = trimmed.length > 0 ? trimmed : fallback;
  return safeName.slice(0, MAX_LEVEL_NAME_LENGTH);
}

function sanitizeOverride(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const levelIndex = Math.floor(Number(value.levelIndex));
  const rows = normalizeRows(value.rows);
  const validation = validateRows(rows);

  if (!Number.isFinite(levelIndex) || levelIndex < 0 || !validation.valid) {
    return null;
  }

  return {
    levelIndex,
    name: sanitizeName(value.name, `Level ${levelIndex + 1}`),
    rows,
    updatedAt: Math.max(0, Math.floor(Number(value.updatedAt) || Date.now()))
  };
}

export class CampaignOverrideStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async list() {
    const parsed = await this.readFile();
    const entries = Array.isArray(parsed?.overrides) ? parsed.overrides : [];
    return entries
      .map(sanitizeOverride)
      .filter(Boolean)
      .sort((a, b) => a.levelIndex - b.levelIndex);
  }

  async save(levelIndex, rows, name) {
    const safeIndex = Math.floor(Number(levelIndex));

    if (!Number.isFinite(safeIndex) || safeIndex < 0 || safeIndex >= 24) {
      throw new ValidationError('Unknown campaign level.');
    }

    if (!Array.isArray(rows)) {
      throw new ValidationError(`Grid must have ${EDITOR_GRID_ROWS} rows.`);
    }

    if (name !== undefined && name !== null && typeof name !== 'string') {
      throw new ValidationError('Invalid level name.');
    }

    const normalizedRows = normalizeRows(rows);
    const validation = validateRows(normalizedRows);

    if (!validation.valid) {
      throw new ValidationError(validation.message);
    }

    const overrides = await this.list();
    const next = {
      levelIndex: safeIndex,
      name: sanitizeName(name, `Level ${safeIndex + 1}`),
      rows: normalizedRows,
      updatedAt: Date.now()
    };
    const merged = overrides.filter((override) => override.levelIndex !== safeIndex);
    merged.push(next);
    merged.sort((a, b) => a.levelIndex - b.levelIndex);
    await this.writeFile({ overrides: merged });
    return next;
  }

  async remove(levelIndex) {
    const safeIndex = Math.floor(Number(levelIndex));

    if (!Number.isFinite(safeIndex) || safeIndex < 0 || safeIndex >= 24) {
      throw new ValidationError('Unknown campaign level.');
    }

    const overrides = await this.list();
    const merged = overrides.filter((override) => override.levelIndex !== safeIndex);
    await this.writeFile({ overrides: merged });
    return { removed: overrides.length !== merged.length };
  }

  async readFile() {
    let raw;

    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { overrides: [] };
      }

      throw error;
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn(`Corrupt overrides file at ${this.filePath}, resetting in-memory view:`, error);
      return { overrides: [] };
    }
  }

  async writeFile(data) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(tmpPath, this.filePath);
  }
}
