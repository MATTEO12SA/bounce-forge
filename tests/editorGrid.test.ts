import { describe, expect, it } from 'vitest';
import {
  EDITOR_GRID_COLS,
  EDITOR_GRID_ROWS,
  createEmptyEditorRows,
  createPatternFromEditorRows,
  normalizeEditorRows,
  validateEditorRows
} from '../src/game/levels/editorGrid';

describe('editor grid helpers', () => {
  it('creates a fixed empty 36x58 grid', () => {
    const rows = createEmptyEditorRows();

    expect(rows).toHaveLength(EDITOR_GRID_ROWS);
    expect(rows.every((row) => row.length === EDITOR_GRID_COLS)).toBe(true);
    expect(rows.every((row) => row === '.'.repeat(EDITOR_GRID_COLS))).toBe(true);
  });

  it('normalizes short and oversized rows to the editor dimensions', () => {
    const rows = normalizeEditorRows(['1', 'X'.repeat(EDITOR_GRID_COLS + 4)]);

    expect(rows).toHaveLength(EDITOR_GRID_ROWS);
    expect(rows[0]).toBe(`1${'.'.repeat(EDITOR_GRID_COLS - 1)}`);
    expect(rows[1]).toBe('X'.repeat(EDITOR_GRID_COLS));
  });

  it('rejects unknown symbols', () => {
    const rows = createEmptyEditorRows();
    rows[0] = `Z${'.'.repeat(EDITOR_GRID_COLS - 1)}`;

    expect(validateEditorRows(rows).valid).toBe(false);
  });

  it('rejects maps without a breakable block', () => {
    const rows = createEmptyEditorRows();
    rows[0] = 'X'.repeat(EDITOR_GRID_COLS);

    expect(validateEditorRows(rows).valid).toBe(false);
  });

  it('creates a pattern from a valid editor grid', () => {
    const rows = createEmptyEditorRows();
    rows[0] = `1${'.'.repeat(EDITOR_GRID_COLS - 1)}`;

    const pattern = createPatternFromEditorRows(2, 'Creative 3', rows);

    expect(pattern.id).toBe('creative-slot-2');
    expect(pattern.name).toBe('Creative 3');
    expect(pattern.rows).toHaveLength(EDITOR_GRID_ROWS);
  });

  it('accepts bonus and shield bricks', () => {
    const rows = createEmptyEditorRows();
    rows[0] = `BS${'.'.repeat(EDITOR_GRID_COLS - 2)}`;

    expect(validateEditorRows(rows).valid).toBe(true);
    expect(createPatternFromEditorRows(0, 'Bonus Shield', rows).rows[0]?.slice(0, 2)).toBe('BS');
  });
});
