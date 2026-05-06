import { describe, expect, it } from 'vitest';
import { createEmptyEditorRows } from '../src/game/levels/editorGrid';
import { decodeCreativeLevelCode, encodeCreativeLevelCode } from '../src/game/levels/levelShare';

describe('level share codes', () => {
  it('round-trips a creative level as a compact code', () => {
    const rows = createEmptyEditorRows();
    rows[0] = `1${'.'.repeat((rows[0]?.length ?? 1) - 1)}`;

    const code = encodeCreativeLevelCode(rows, 'Shared Level');
    const decoded = decodeCreativeLevelCode(code);

    expect(code.startsWith('BF1:')).toBe(true);
    expect(decoded.name).toBe('Shared Level');
    expect(decoded.rows).toEqual(rows);
  });

  it('rejects invalid or empty shared levels', () => {
    expect(() => decodeCreativeLevelCode('wrong')).toThrow(/Invalid Bounce Forge level code/);
    expect(() => encodeCreativeLevelCode(createEmptyEditorRows(), 'Empty')).toThrow(
      /Add at least one breakable block/
    );
  });
});
