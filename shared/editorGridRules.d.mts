export const EDITOR_GRID_COLS: 36;
export const EDITOR_GRID_ROWS: 58;

export type EditorCell =
  | '.'
  | '1'
  | '2'
  | '3'
  | 'E'
  | 'B'
  | 'S'
  | 'X'
  | 'C'
  | 'K'
  | 'G'
  | 'R'
  | 'I'
  | 'M'
  | 'O'
  | 'T'
  | 'F'
  | 'W';

export interface EditorCellRule {
  breakable: boolean;
  required: boolean;
}

export interface EditorGridValidation {
  valid: boolean;
  message: string;
}

export const EDITOR_CELL_RULES: Readonly<Record<EditorCell, Readonly<EditorCellRule>>>;
export const EDITOR_PALETTE: readonly EditorCell[];
export const EDITOR_BREAKABLE_CELLS: readonly EditorCell[];
export const EDITOR_REQUIRED_CELLS: readonly EditorCell[];

export function createEmptyRows(): string[];
export function normalizeRows(rows: unknown): string[];
export function validateRows(rows: unknown): EditorGridValidation;
