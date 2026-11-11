import { describe, expect, it } from 'vitest';
import { createEmptyRows } from '../shared/editorGridRules.mjs';
import { COLS, EditorModel, lineCells, rectCells } from '../src/ui/editor/editorModel';

function emptyModel(): EditorModel {
  return new EditorModel(createEmptyRows());
}

describe('EditorModel', () => {
  it('paints, counts and reports dirty state', () => {
    const model = emptyModel();
    expect(model.isDirty).toBe(false);
    model.paint(3, 4, '2');
    model.paint(5, 4, 'X');
    expect(model.get(3, 4)).toBe('2');
    expect(model.stats()).toMatchObject({ total: 2, breakable: 1, steel: 1 });
    expect(model.isDirty).toBe(true);
    model.markSaved();
    expect(model.isDirty).toBe(false);
  });

  it('mirrors strokes left/right and in four quadrants', () => {
    const model = emptyModel();
    model.symmetry = 'vertical';
    model.paint(2, 5, '1');
    expect(model.get(COLS - 3, 5)).toBe('1');
    model.symmetry = 'quad';
    model.paint(4, 2, 'E');
    expect(model.get(COLS - 5, 2)).toBe('E');
    expect(model.get(4, 27)).toBe('E');
    expect(model.get(COLS - 5, 27)).toBe('E');
  });

  it('undoes and redoes a whole stroke in one step', () => {
    const model = emptyModel();
    model.checkpoint();
    model.paint(1, 1, '1');
    model.paint(2, 1, '1');
    model.paint(3, 1, '1');
    expect(model.stats().total).toBe(3);
    expect(model.undo()).toBe(true);
    expect(model.stats().total).toBe(0);
    expect(model.redo()).toBe(true);
    expect(model.stats().total).toBe(3);
  });

  it('does not record a step for a gesture that changed nothing', () => {
    const model = emptyModel();
    model.checkpoint();
    model.discardCheckpointIfUnchanged();
    expect(model.canUndo).toBe(false);
  });

  it('flood fills only the touching area', () => {
    const model = emptyModel();
    model.paintCells(rectCells({ col: 0, row: 0 }, { col: 9, row: 9 }, false), 'X');
    model.fill(4, 4, '1');
    expect(model.get(4, 4)).toBe('1');
    expect(model.get(8, 8)).toBe('1');
    expect(model.get(12, 4)).toBe('.');
    expect(model.stats().bySymbol['1']).toBe(64);
  });

  it('shifts the whole drawing', () => {
    const model = emptyModel();
    model.paint(0, 0, '1');
    model.shiftAll(2, 3);
    expect(model.get(2, 3)).toBe('1');
    expect(model.get(0, 0)).toBe('.');
    model.undo();
    expect(model.get(0, 0)).toBe('1');
  });
});

describe('shape helpers', () => {
  it('draws lines and rectangles', () => {
    expect(lineCells({ col: 0, row: 0 }, { col: 4, row: 2 })).toHaveLength(5);
    expect(lineCells({ col: 3, row: 3 }, { col: 3, row: 3 })).toHaveLength(1);
    expect(rectCells({ col: 0, row: 0 }, { col: 3, row: 2 })).toHaveLength(12);
    expect(rectCells({ col: 3, row: 2 }, { col: 0, row: 0 }, false)).toHaveLength(10);
  });
});

describe('brush, stamps, text and surprise levels', () => {
  it('paints snapped 2 × 2 blocks', async () => {
    const { brushCells } = await import('../src/ui/editor/editorModel');
    expect(brushCells(5, 7, 2)).toEqual([
      { col: 4, row: 6 },
      { col: 5, row: 6 },
      { col: 4, row: 7 },
      { col: 5, row: 7 }
    ]);
    expect(brushCells(5, 7, 1)).toEqual([{ col: 5, row: 7 }]);
  });

  it('stamps shapes and writes text', async () => {
    const { STAMPS, artCells, textArt, normalizeText } = await import('../src/ui/editor/stamps');
    expect(artCells(STAMPS.heart, 18, 10, 2).length).toBe(27 * 4);
    expect(normalizeText('Élan ♥')).toBe('ELAN <');
    const art = textArt('GO');
    expect(art).toHaveLength(5);
    expect(art[0]).toBe('###.###');
  });

  it('generates the same playable level from the same seed', async () => {
    const { generateLevel } = await import('../src/ui/editor/generator');
    const { sealedBricks } = await import('../src/game/levels/levelChecks');
    for (let seed = 1; seed < 40; seed += 1) {
      const rows = generateLevel(seed);
      expect(rows).toEqual(generateLevel(seed));
      expect(rows).toHaveLength(58);
      expect(rows.join('').replace(/[^123EBS]/g, '').length).toBeGreaterThanOrEqual(120);
      expect(sealedBricks(rows)).toEqual([]);
      rows.forEach((row) => expect(row).toBe([...row].reverse().join('')));
    }
  });
});
