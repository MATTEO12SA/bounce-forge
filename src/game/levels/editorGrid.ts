import type { CustomLevelOverride, PatternDefinition } from './levelTypes';

export const EDITOR_GRID_COLS = 36;
export const EDITOR_GRID_ROWS = 58;

export type EditorCell = '.' | '1' | '2' | '3' | 'E' | 'B' | 'S' | 'X';

export interface EditorCellDefinition {
  symbol: EditorCell;
  label: string;
  color: number;
  breakable: boolean;
}

export interface EditorGridValidation {
  valid: boolean;
  message: string;
}

export const EDITOR_CELL_DEFINITIONS: Record<EditorCell, EditorCellDefinition> = {
  '.': {
    symbol: '.',
    label: 'Erase',
    color: 0x111111,
    breakable: false
  },
  '1': {
    symbol: '1',
    label: '1',
    color: 0xffd31a,
    breakable: true
  },
  '2': {
    symbol: '2',
    label: '2',
    color: 0xffdc35,
    breakable: true
  },
  '3': {
    symbol: '3',
    label: '3',
    color: 0xffe76a,
    breakable: true
  },
  E: {
    symbol: 'E',
    label: 'Bomb',
    color: 0xff8a3d,
    breakable: true
  },
  B: {
    symbol: 'B',
    label: 'Bonus',
    color: 0x61d394,
    breakable: true
  },
  S: {
    symbol: 'S',
    label: 'Shield',
    color: 0x67b7e8,
    breakable: true
  },
  X: {
    symbol: 'X',
    label: 'Wall',
    color: 0x5f5f5f,
    breakable: false
  }
};

export const EDITOR_PALETTE: EditorCell[] = ['.', '1', '2', '3', 'E', 'B', 'S', 'X'];

const EDITOR_ALLOWED_CELLS = new Set<string>(EDITOR_PALETTE);
const EDITOR_BREAKABLE_CELLS = new Set<string>(
  EDITOR_PALETTE.filter((cell) => EDITOR_CELL_DEFINITIONS[cell].breakable)
);

export function createEmptyEditorRows(): string[] {
  return Array.from({ length: EDITOR_GRID_ROWS }, () => '.'.repeat(EDITOR_GRID_COLS));
}

export function normalizeEditorRows(rows: readonly string[]): string[] {
  return Array.from({ length: EDITOR_GRID_ROWS }, (_, row) => {
    const source = rows[row] ?? '';
    return source.padEnd(EDITOR_GRID_COLS, '.').slice(0, EDITOR_GRID_COLS);
  });
}

export function validateEditorRows(rows: readonly string[]): EditorGridValidation {
  if (rows.length !== EDITOR_GRID_ROWS) {
    return {
      valid: false,
      message: `Grid must have ${EDITOR_GRID_ROWS} rows.`
    };
  }

  let hasBreakableBrick = false;

  for (let row = 0; row < rows.length; row += 1) {
    const rowValue = rows[row];

    if (rowValue.length !== EDITOR_GRID_COLS) {
      return {
        valid: false,
        message: `Row ${row + 1} must have ${EDITOR_GRID_COLS} columns.`
      };
    }

    for (const cell of rowValue) {
      if (!EDITOR_ALLOWED_CELLS.has(cell)) {
        return {
          valid: false,
          message: `Unknown block "${cell}" in row ${row + 1}.`
        };
      }

      hasBreakableBrick ||= EDITOR_BREAKABLE_CELLS.has(cell);
    }
  }

  if (!hasBreakableBrick) {
    return {
      valid: false,
      message: 'Add at least one breakable block.'
    };
  }

  return {
    valid: true,
    message: 'OK'
  };
}

export function isValidEditorRows(rows: readonly string[]): boolean {
  return validateEditorRows(rows).valid;
}

export function createPatternFromEditorRows(
  slotIndex: number,
  name: string,
  rows: readonly string[]
): PatternDefinition {
  const normalizedRows = normalizeEditorRows(rows);
  const validation = validateEditorRows(normalizedRows);

  if (!validation.valid) {
    throw new Error(validation.message);
  }

  return {
    id: `custom-slot-${slotIndex}`,
    name,
    rows: normalizedRows
  };
}

export function createPatternFromCustomOverride(override: CustomLevelOverride): PatternDefinition {
  return createPatternFromEditorRows(override.slotIndex, override.name, override.rows);
}
