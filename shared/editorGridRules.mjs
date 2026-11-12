export const EDITOR_GRID_COLS = 36;
export const EDITOR_GRID_ROWS = 58;

/**
 * `breakable`: the ball can destroy it. `required`: it must be destroyed to win (phoenix bricks
 * respawn and gates open by themselves, so a level made only of them could never be played).
 */
export const EDITOR_CELL_RULES = Object.freeze({
  '.': Object.freeze({ breakable: false, required: false }),
  1: Object.freeze({ breakable: true, required: true }),
  2: Object.freeze({ breakable: true, required: true }),
  3: Object.freeze({ breakable: true, required: true }),
  E: Object.freeze({ breakable: true, required: true }),
  B: Object.freeze({ breakable: true, required: true }),
  S: Object.freeze({ breakable: true, required: true }),
  X: Object.freeze({ breakable: false, required: false }),
  C: Object.freeze({ breakable: true, required: true }),
  K: Object.freeze({ breakable: true, required: true }),
  G: Object.freeze({ breakable: true, required: false }),
  R: Object.freeze({ breakable: true, required: false }),
  I: Object.freeze({ breakable: true, required: true }),
  M: Object.freeze({ breakable: true, required: true }),
  O: Object.freeze({ breakable: false, required: false }),
  T: Object.freeze({ breakable: false, required: false }),
  F: Object.freeze({ breakable: true, required: true }),
  W: Object.freeze({ breakable: true, required: true })
});

export const EDITOR_PALETTE = Object.freeze(Object.keys(EDITOR_CELL_RULES));
export const EDITOR_BREAKABLE_CELLS = Object.freeze(
  EDITOR_PALETTE.filter((cell) => EDITOR_CELL_RULES[cell].breakable)
);

export const EDITOR_REQUIRED_CELLS = Object.freeze(
  EDITOR_PALETTE.filter((cell) => EDITOR_CELL_RULES[cell].required)
);

const EDITOR_ALLOWED_CELLS = new Set(EDITOR_PALETTE);
const EDITOR_REQUIRED_CELL_SET = new Set(EDITOR_REQUIRED_CELLS);

export function createEmptyRows() {
  return Array.from({ length: EDITOR_GRID_ROWS }, () => '.'.repeat(EDITOR_GRID_COLS));
}

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
      if (!EDITOR_ALLOWED_CELLS.has(cell)) {
        return { valid: false, message: `Unknown block "${cell}" in row ${row + 1}.` };
      }

      hasBreakable ||= EDITOR_REQUIRED_CELL_SET.has(cell);
    }
  }

  return hasBreakable
    ? { valid: true, message: 'OK' }
    : { valid: false, message: 'Add at least one breakable block.' };
}
