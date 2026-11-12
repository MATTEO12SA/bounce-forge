import { sanitizeLevelOptions, type LevelOptions } from './levelOptions';
import type { CreativeLevelSlot, PatternDefinition } from './levelTypes';
import {
  EDITOR_CELL_RULES,
  EDITOR_GRID_COLS,
  EDITOR_GRID_ROWS,
  EDITOR_PALETTE,
  createEmptyRows,
  normalizeRows,
  validateRows,
  type EditorCell,
  type EditorGridValidation
} from '../../../shared/editorGridRules.mjs';

export {
  EDITOR_GRID_COLS,
  EDITOR_GRID_ROWS,
  EDITOR_PALETTE,
  type EditorCell,
  type EditorGridValidation
};

export interface EditorCellDefinition {
  symbol: EditorCell;
  label: string;
  color: number;
  breakable: boolean;
}

export const EDITOR_CELL_DEFINITIONS: Record<EditorCell, EditorCellDefinition> = {
  '.': {
    symbol: '.',
    label: 'Erase',
    color: 0x111111,
    breakable: EDITOR_CELL_RULES['.'].breakable
  },
  '1': {
    symbol: '1',
    label: '1',
    color: 0xffd31a,
    breakable: EDITOR_CELL_RULES['1'].breakable
  },
  '2': {
    symbol: '2',
    label: '2',
    color: 0xffdc35,
    breakable: EDITOR_CELL_RULES['2'].breakable
  },
  '3': {
    symbol: '3',
    label: '3',
    color: 0xffe76a,
    breakable: EDITOR_CELL_RULES['3'].breakable
  },
  E: {
    symbol: 'E',
    label: 'Bomb',
    color: 0xff8a3d,
    breakable: EDITOR_CELL_RULES.E.breakable
  },
  B: {
    symbol: 'B',
    label: 'Bonus',
    color: 0x61d394,
    breakable: EDITOR_CELL_RULES.B.breakable
  },
  S: {
    symbol: 'S',
    label: 'Shield',
    color: 0x67b7e8,
    breakable: EDITOR_CELL_RULES.S.breakable
  },
  X: {
    symbol: 'X',
    label: 'Wall',
    color: 0x5f5f5f,
    breakable: EDITOR_CELL_RULES.X.breakable
  },
  C: { symbol: 'C', label: 'Crystal', color: 0x7fe8ff, breakable: true },
  K: { symbol: 'K', label: 'Key', color: 0xf4efe0, breakable: true },
  G: { symbol: 'G', label: 'Gate', color: 0x9a7444, breakable: true },
  R: { symbol: 'R', label: 'Phoenix', color: 0xff7a3a, breakable: true },
  I: { symbol: 'I', label: 'Ghost', color: 0xd6e6ff, breakable: true },
  M: { symbol: 'M', label: 'Mover', color: 0x5fb3ff, breakable: true },
  O: { symbol: 'O', label: 'Bumper', color: 0xff5ab4, breakable: false },
  T: { symbol: 'T', label: 'Portal', color: 0x9b6bff, breakable: false },
  F: { symbol: 'F', label: 'Fuse', color: 0xffa94d, breakable: true },
  W: { symbol: 'W', label: 'Boss', color: 0x9b2335, breakable: true }
};

export function createEmptyEditorRows(): string[] {
  return createEmptyRows();
}

export function normalizeEditorRows(rows: readonly string[]): string[] {
  return normalizeRows(rows);
}

export function validateEditorRows(rows: readonly string[]): EditorGridValidation {
  return validateRows(rows);
}

export function isValidEditorRows(rows: readonly string[]): boolean {
  return validateEditorRows(rows).valid;
}

export function createPatternFromEditorRows(
  slotIndex: number,
  name: string,
  rows: readonly string[],
  options?: LevelOptions
): PatternDefinition {
  const normalizedRows = normalizeEditorRows(rows);
  const validation = validateEditorRows(normalizedRows);

  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const cleanOptions = sanitizeLevelOptions(options);
  return {
    id: `creative-slot-${slotIndex}`,
    name,
    rows: normalizedRows,
    ...(cleanOptions ? { options: cleanOptions } : {})
  };
}

export function createPatternFromCreativeSlot(slot: CreativeLevelSlot): PatternDefinition {
  return createPatternFromEditorRows(slot.slotIndex, slot.name, slot.rows, slot.options);
}

export function createPatternFromCustomOverride(override: CreativeLevelSlot): PatternDefinition {
  return createPatternFromEditorRows(override.slotIndex, override.name, override.rows);
}
