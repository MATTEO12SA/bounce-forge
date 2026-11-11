import type { Box } from './geometry';

export interface GridItem {
  col: number;
  row: number;
  box: Box;
  /** Indestructible steel: bounces balls and blocks explosions. */
  solid: boolean;
}

/**
 * Spatial index of the brick layout. Levels are built on a fixed editor grid, so every brick
 * maps to exactly one cell and neighbourhood queries are O(1).
 */
export class BrickGrid<T extends GridItem> {
  private readonly cells: Array<T | null>;
  private count = 0;

  public constructor(
    public readonly cols: number,
    public readonly rows: number,
    public readonly originX: number,
    public readonly originY: number,
    public readonly pitchX: number,
    public readonly pitchY: number
  ) {
    this.cells = new Array<T | null>(cols * rows).fill(null);
  }

  public get size(): number {
    return this.count;
  }

  public set(item: T): void {
    if (!this.inBounds(item.col, item.row)) {
      return;
    }
    const index = item.row * this.cols + item.col;
    if (!this.cells[index]) {
      this.count += 1;
    }
    this.cells[index] = item;
  }

  public remove(item: T): void {
    if (!this.inBounds(item.col, item.row)) {
      return;
    }
    const index = item.row * this.cols + item.col;
    if (this.cells[index] === item) {
      this.cells[index] = null;
      this.count -= 1;
    }
  }

  public get(col: number, row: number): T | null {
    return this.inBounds(col, row) ? (this.cells[row * this.cols + col] ?? null) : null;
  }

  public colAt(x: number): number {
    return Math.floor((x - this.originX) / this.pitchX);
  }

  public rowAt(y: number): number {
    return Math.floor((y - this.originY) / this.pitchY);
  }

  /** Items whose cell intersects the given box (inclusive). */
  public query(box: Box, out: T[] = []): T[] {
    out.length = 0;
    const c0 = Math.max(0, this.colAt(box.left));
    const c1 = Math.min(this.cols - 1, this.colAt(box.right));
    const r0 = Math.max(0, this.rowAt(box.top));
    const r1 = Math.min(this.rows - 1, this.rowAt(box.bottom));
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        const item = this.cells[row * this.cols + col];
        if (item) {
          out.push(item);
        }
      }
    }
    return out;
  }

  /** Items within `radiusCols` / `radiusRows` cells of a point. */
  public around(x: number, y: number, radiusCols: number, radiusRows: number): T[] {
    const col = this.colAt(x);
    const row = this.rowAt(y);
    const result: T[] = [];
    for (let r = row - radiusRows; r <= row + radiusRows; r += 1) {
      for (let c = col - radiusCols; c <= col + radiusCols; c += 1) {
        const item = this.get(c, r);
        if (item) {
          result.push(item);
        }
      }
    }
    return result;
  }

  /**
   * True when a solid (steel) cell lies on the segment between two points, excluding the
   * end cells. Used so explosions do not go through walls.
   */
  public isBlocked(x0: number, y0: number, x1: number, y1: number): boolean {
    const startCol = this.colAt(x0);
    const startRow = this.rowAt(y0);
    const endCol = this.colAt(x1);
    const endRow = this.rowAt(y1);
    const steps = Math.max(Math.abs(endCol - startCol), Math.abs(endRow - startRow)) * 2;
    for (let index = 1; index < steps; index += 1) {
      const t = index / steps;
      const col = this.colAt(x0 + (x1 - x0) * t);
      const row = this.rowAt(y0 + (y1 - y0) * t);
      if ((col === startCol && row === startRow) || (col === endCol && row === endRow)) {
        continue;
      }
      if (this.get(col, row)?.solid) {
        return true;
      }
    }
    return false;
  }

  private inBounds(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.cols && row < this.rows;
  }
}
