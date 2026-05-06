import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const EDITOR_GRID_COLS = 36;
export const EDITOR_GRID_ROWS = 58;
const ALLOWED_CELLS = new Set(['.', '1', '2', '3', 'E', 'B', 'S', 'X']);
const BREAKABLE_CELLS = new Set(['1', '2', '3', 'E', 'B', 'S']);

export function normalizeRows(rows) {
  return Array.from({ length: EDITOR_GRID_ROWS }, (_, row) => {
    const source = typeof rows?.[row] === 'string' ? rows[row] : '';
    return source.padEnd(EDITOR_GRID_COLS, '.').slice(0, EDITOR_GRID_COLS);
  });
}

export function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length !== EDITOR_GRID_ROWS) {
    return { valid: false, message: `Grid must have ${EDITOR_GRID_ROWS} rows.` };
  }

  let hasBreakable = false;

  for (let row = 0; row < rows.length; row += 1) {
    const value = rows[row];

    if (typeof value !== 'string' || value.length !== EDITOR_GRID_COLS) {
      return { valid: false, message: `Row ${row + 1} must have ${EDITOR_GRID_COLS} columns.` };
    }

    for (const cell of value) {
      if (!ALLOWED_CELLS.has(cell)) {
        return { valid: false, message: `Unknown block "${cell}" in row ${row + 1}.` };
      }

      hasBreakable ||= BREAKABLE_CELLS.has(cell);
    }
  }

  return hasBreakable
    ? { valid: true, message: 'OK' }
    : { valid: false, message: 'Add at least one breakable block.' };
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
    name: typeof value.name === 'string' && value.name ? value.name : `Level ${levelIndex + 1}`,
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
    const normalizedRows = normalizeRows(rows);
    const validation = validateRows(normalizedRows);

    if (!Number.isFinite(safeIndex) || safeIndex < 0 || safeIndex >= 24) {
      throw new Error('Unknown campaign level.');
    }

    if (!validation.valid) {
      throw new Error(validation.message);
    }

    const overrides = await this.list();
    const next = {
      levelIndex: safeIndex,
      name: typeof name === 'string' && name ? name : `Level ${safeIndex + 1}`,
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
      throw new Error('Unknown campaign level.');
    }

    const overrides = await this.list();
    const merged = overrides.filter((override) => override.levelIndex !== safeIndex);
    await this.writeFile({ overrides: merged });
    return { removed: overrides.length !== merged.length };
  }

  async readFile() {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { overrides: [] };
      }

      throw error;
    }
  }

  async writeFile(data) {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }
}
