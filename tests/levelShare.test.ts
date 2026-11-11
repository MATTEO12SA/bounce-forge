import { describe, expect, it } from 'vitest';
import { createEmptyEditorRows } from '../src/game/levels/editorGrid';
import { MAX_LEVEL_NAME_LENGTH } from '../src/game/levels/levelNames';
import { decodeCreativeLevelCode, encodeCreativeLevelCode } from '../src/game/levels/levelShare';

function oneBrickRows(): string[] {
  const rows = createEmptyEditorRows();
  rows[0] = `1${'.'.repeat((rows[0]?.length ?? 1) - 1)}`;
  return rows;
}

describe('level share codes', () => {
  it('round-trips a creative level as a compact BF2 code', () => {
    const rows = oneBrickRows();
    const code = encodeCreativeLevelCode(rows, 'Shared Level');
    const decoded = decodeCreativeLevelCode(code);

    expect(code.startsWith('BF2:')).toBe(true);
    expect(code).not.toMatch(/[+/=]/u);
    expect(decoded.name).toBe('Shared Level');
    expect(decoded.rows).toEqual(rows);
  });

  it('keeps accents and emoji in level names', () => {
    const name = 'Forgé à chaud 🔥 — niveau ñ';
    const decoded = decodeCreativeLevelCode(encodeCreativeLevelCode(oneBrickRows(), name));
    expect(decoded.name).toBe(name);
  });

  it('still imports legacy BF1 codes', () => {
    const rows = oneBrickRows();
    const legacy = `BF1:${Buffer.from(JSON.stringify({ v: 1, name: 'Old', rows })).toString('base64')}`;
    const decoded = decodeCreativeLevelCode(legacy);
    expect(decoded.name).toBe('Old');
    expect(decoded.rows).toEqual(rows);
  });

  it('tolerates whitespace and line breaks pasted into the code', () => {
    const code = encodeCreativeLevelCode(oneBrickRows(), 'Wrapped');
    const wrapped = `  ${code.slice(0, 20)}\n${code.slice(20)}  `;
    expect(decodeCreativeLevelCode(wrapped).name).toBe('Wrapped');
  });

  it('rejects invalid, corrupted or empty shared levels', () => {
    expect(() => decodeCreativeLevelCode('wrong')).toThrow(/Invalid Bounce Forge level code/);
    expect(() => decodeCreativeLevelCode('BF2:%%%')).toThrow(/Corrupted/);
    expect(() => encodeCreativeLevelCode(createEmptyEditorRows(), 'Empty')).toThrow(
      /Add at least one breakable block/
    );
  });

  it('normalizes shared level names', () => {
    const rows = oneBrickRows();
    const longName = 'B'.repeat(MAX_LEVEL_NAME_LENGTH + 4);

    const decoded = decodeCreativeLevelCode(encodeCreativeLevelCode(rows, `  ${longName}  `));
    const unnamed = decodeCreativeLevelCode(encodeCreativeLevelCode(rows, '   '));

    expect(decoded.name).toBe('B'.repeat(MAX_LEVEL_NAME_LENGTH));
    expect(unnamed.name).toBeUndefined();
  });
});
