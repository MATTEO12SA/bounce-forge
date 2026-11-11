import { EDITOR_GRID_COLS, EDITOR_GRID_ROWS } from '../../../shared/editorGridRules.mjs';

/**
 * Pure model of the level editor: a 36 × 58 grid of symbols with drawing tools, mirror symmetry
 * and undo/redo. No DOM here, so every tool is unit-tested.
 */

export const COLS = EDITOR_GRID_COLS;
export const ROWS = EDITOR_GRID_ROWS;
export const EMPTY = '.';
export const BREAKABLE_SYMBOLS = new Set([
  '1',
  '2',
  '3',
  'E',
  'B',
  'S',
  'C',
  'K',
  'G',
  'R',
  'I',
  'M',
  'F'
]);
const HISTORY_LIMIT = 120;

export type Tool = 'brush' | 'eraser' | 'rect' | 'line' | 'fill' | 'picker';
export type Symmetry = 'none' | 'vertical' | 'quad';

export interface Cell {
  col: number;
  row: number;
}

export interface GridStats {
  total: number;
  breakable: number;
  steel: number;
  bySymbol: Record<string, number>;
}

export class EditorModel {
  private grid: string[][];
  private undoStack: string[][] = [];
  private redoStack: string[][] = [];
  private savedSnapshot: string;
  private readonly listeners = new Set<() => void>();
  public symmetry: Symmetry = 'none';

  public constructor(rows: readonly string[]) {
    this.grid = toGrid(rows);
    this.savedSnapshot = this.serialize();
  }

  // ------------------------------------------------------------------ reading

  public get(col: number, row: number): string {
    return this.grid[row]?.[col] ?? EMPTY;
  }

  public rows(): string[] {
    return this.grid.map((row) => row.join(''));
  }

  public serialize(): string {
    return this.rows().join('\n');
  }

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public get isDirty(): boolean {
    return this.serialize() !== this.savedSnapshot;
  }

  public stats(): GridStats {
    const bySymbol: Record<string, number> = {};
    let total = 0;
    let breakable = 0;
    let steel = 0;
    this.grid.forEach((row) =>
      row.forEach((symbol) => {
        if (symbol === EMPTY) return;
        total += 1;
        bySymbol[symbol] = (bySymbol[symbol] ?? 0) + 1;
        if (BREAKABLE_SYMBOLS.has(symbol)) breakable += 1;
        if (symbol === 'X') steel += 1;
      })
    );
    return { total, breakable, steel, bySymbol };
  }

  public onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ------------------------------------------------------------------ history

  /** Call once before a stroke or a one-shot tool so the whole gesture undoes in one step. */
  public checkpoint(): void {
    this.undoStack.push(this.rows());
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Drops the last checkpoint when the gesture ended up changing nothing. */
  public discardCheckpointIfUnchanged(): void {
    const last = this.undoStack[this.undoStack.length - 1];
    if (last && last.join('\n') === this.serialize()) {
      this.undoStack.pop();
    }
  }

  /** Cancels the gesture in progress (e.g. a second finger turned it into a pinch). */
  public revertToCheckpoint(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.grid = toGrid(previous);
    this.emit();
  }

  public undo(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push(this.rows());
    this.grid = toGrid(previous);
    this.emit();
    return true;
  }

  public redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.rows());
    this.grid = toGrid(next);
    this.emit();
    return true;
  }

  public markSaved(): void {
    this.savedSnapshot = this.serialize();
    this.emit();
  }

  /** Replaces the whole grid (template, import, clear) as one undoable step. */
  public replace(rows: readonly string[]): void {
    this.checkpoint();
    this.grid = toGrid(rows);
    this.discardCheckpointIfUnchanged();
    this.emit();
  }

  // ------------------------------------------------------------------ tools

  /** Paints one cell and its mirrored copies. Returns true when something changed. */
  public paint(col: number, row: number, symbol: string): boolean {
    let changed = false;
    for (const cell of this.mirrored(col, row)) {
      const current = this.grid[cell.row];
      if (current && current[cell.col] !== undefined && current[cell.col] !== symbol) {
        current[cell.col] = symbol;
        changed = true;
      }
    }
    if (changed) this.emit();
    return changed;
  }

  public paintCells(cells: readonly Cell[], symbol: string): boolean {
    let changed = false;
    this.withoutEmit(() => {
      cells.forEach((cell) => {
        changed = this.paint(cell.col, cell.row, symbol) || changed;
      });
    });
    if (changed) this.emit();
    return changed;
  }

  /** Flood fill of the contiguous area sharing the clicked symbol (4-neighbour). */
  public fill(col: number, row: number, symbol: string): boolean {
    const cells = floodCells(this.grid, col, row);
    if (cells.length === 0 || this.get(col, row) === symbol) return false;
    return this.paintCells(cells, symbol);
  }

  public shiftAll(dx: number, dy: number): void {
    this.checkpoint();
    const next = toGrid([]);
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const symbol = this.get(col, row);
        const target = next[row + dy];
        if (symbol !== EMPTY && target && target[col + dx] !== undefined) {
          target[col + dx] = symbol;
        }
      }
    }
    this.grid = next;
    this.discardCheckpointIfUnchanged();
    this.emit();
  }

  public mirrored(col: number, row: number): Cell[] {
    const cells: Cell[] = [{ col, row }];
    if (this.symmetry === 'vertical' || this.symmetry === 'quad') {
      cells.push({ col: COLS - 1 - col, row });
    }
    if (this.symmetry === 'quad') {
      // The quad mirror only reflects within the brick area (top 30 rows), never near the paddle.
      const mirrorRow = BRICK_AREA_ROWS - 1 - row;
      if (mirrorRow >= 0) {
        cells.push({ col, row: mirrorRow }, { col: COLS - 1 - col, row: mirrorRow });
      }
    }
    return dedupe(cells);
  }

  private silent = false;

  private withoutEmit(task: () => void): void {
    const previous = this.silent;
    this.silent = true;
    try {
      task();
    } finally {
      this.silent = previous;
    }
  }

  private emit(): void {
    if (this.silent) return;
    this.listeners.forEach((listener) => listener());
  }
}

/** Rows of the grid where the quad symmetry reflects (the usual brick area). */
export const BRICK_AREA_ROWS = 30;

function toGrid(rows: readonly string[]): string[][] {
  return Array.from({ length: ROWS }, (_, row) => {
    const source = typeof rows[row] === 'string' ? rows[row] : '';
    return Array.from({ length: COLS }, (_, col) => source[col] ?? EMPTY);
  });
}

function dedupe(cells: Cell[]): Cell[] {
  const seen = new Set<string>();
  return cells.filter((cell) => {
    const key = `${cell.col},${cell.row}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Square block of `size × size` cells under the cursor, snapped to the brush grid. */
export function brushCells(col: number, row: number, size: number): Cell[] {
  if (size <= 1) return [{ col, row }];
  const left = col - (col % size);
  const top = row - (row % size);
  const cells: Cell[] = [];
  for (let dy = 0; dy < size; dy += 1) {
    for (let dx = 0; dx < size; dx += 1) {
      cells.push({ col: left + dx, row: top + dy });
    }
  }
  return cells;
}

/** Expands each cell of a path into a brush block, without duplicates. */
export function brushPath(cells: readonly Cell[], size: number): Cell[] {
  return dedupe(cells.flatMap((cell) => brushCells(cell.col, cell.row, size)));
}

/** Cells of a filled or outlined rectangle between two corners. */
export function rectCells(a: Cell, b: Cell, filled = true): Cell[] {
  const left = Math.min(a.col, b.col);
  const right = Math.max(a.col, b.col);
  const top = Math.min(a.row, b.row);
  const bottom = Math.max(a.row, b.row);
  const cells: Cell[] = [];
  for (let row = top; row <= bottom; row += 1) {
    for (let col = left; col <= right; col += 1) {
      if (filled || row === top || row === bottom || col === left || col === right) {
        cells.push({ col, row });
      }
    }
  }
  return cells;
}

/** Bresenham line between two cells. */
export function lineCells(a: Cell, b: Cell): Cell[] {
  const cells: Cell[] = [];
  let col = a.col;
  let row = a.row;
  const dx = Math.abs(b.col - a.col);
  const dy = -Math.abs(b.row - a.row);
  const sx = a.col < b.col ? 1 : -1;
  const sy = a.row < b.row ? 1 : -1;
  let error = dx + dy;
  for (let guard = 0; guard < COLS + ROWS + 2; guard += 1) {
    cells.push({ col, row });
    if (col === b.col && row === b.row) break;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      col += sx;
    }
    if (twice <= dx) {
      error += dx;
      row += sy;
    }
  }
  return cells;
}

function floodCells(grid: string[][], col: number, row: number): Cell[] {
  const target = grid[row]?.[col];
  if (target === undefined) return [];
  const seen = new Set<number>();
  const cells: Cell[] = [];
  const stack: Cell[] = [{ col, row }];
  while (stack.length > 0) {
    const cell = stack.pop()!;
    if (cell.col < 0 || cell.col >= COLS || cell.row < 0 || cell.row >= ROWS) continue;
    const key = cell.row * COLS + cell.col;
    if (seen.has(key) || grid[cell.row]?.[cell.col] !== target) continue;
    seen.add(key);
    cells.push(cell);
    stack.push(
      { col: cell.col + 1, row: cell.row },
      { col: cell.col - 1, row: cell.row },
      { col: cell.col, row: cell.row + 1 },
      { col: cell.col, row: cell.row - 1 }
    );
  }
  return cells;
}
