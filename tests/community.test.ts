import { describe, expect, it } from 'vitest';
import { createEmptyRows } from '../shared/editorGridRules.mjs';
import {
  checkPublication,
  errorCode,
  paceIndexFor,
  parseCreation,
  searchPattern,
  sortOrder,
  toCommunityLevel,
  validNickname
} from '../src/community/rules';
import { CommunityError } from '../src/community/types';

function oneBrick(): string[] {
  const rows = createEmptyRows();
  rows[4] = `1${'.'.repeat(35)}`;
  return rows;
}

describe('community rules', () => {
  it('accepts reasonable nicknames only', () => {
    expect(validNickname('Forgeron_42')).toBe(true);
    expect(validNickname('Élodie M.')).toBe(true);
    expect(validNickname('ab')).toBe(false);
    expect(validNickname('<script>')).toBe(false);
    expect(validNickname('x'.repeat(21))).toBe(false);
  });

  it('prepares a level and refuses an empty one', () => {
    const level = toCommunityLevel('  Mon niveau  ', oneBrick(), { storm: true, lives: 9 });
    expect(level.rows).toHaveLength(58);
    expect(level.options).toEqual({ storm: true, lives: 5 });
    expect(() => toCommunityLevel('Vide', createEmptyRows())).toThrow(CommunityError);
  });

  it('checks a publication before sending it', () => {
    const level = toCommunityLevel('A', oneBrick());
    expect(
      checkPublication({ kind: 'level', title: 'Mon niveau', description: '', levels: [level] })
    ).toBeNull();
    expect(checkPublication({ kind: 'level', title: 'ab', description: '', levels: [level] })).toBe(
      'invalid_title'
    );
    expect(
      checkPublication({ kind: 'campaign', title: 'Ma campagne', description: '', levels: [level] })
    ).toBe('invalid_level_count');
    expect(
      checkPublication({
        kind: 'level',
        title: 'Mon niveau',
        description: 'x'.repeat(301),
        levels: [level]
      })
    ).toBe('invalid_description');
  });

  it('sorts the library and escapes searches', () => {
    expect(sortOrder('new')[0]).toEqual({ column: 'created_at', ascending: false });
    expect(sortOrder('easy')[0]).toEqual({ column: 'difficulty', ascending: true });
    expect(sortOrder('popular')[0]?.column).toBe('likes');
    expect(searchPattern('a')).toBeNull();
    expect(searchPattern('100%_fun')).toBe('%100\\%\\_fun%');
  });

  it('turns server errors into explainable codes', () => {
    expect(errorCode({ message: 'rate_limited' })).toBe('rate_limited');
    expect(errorCode({ code: '23505', message: 'duplicate key' })).toBe('nickname_taken');
    expect(errorCode(new TypeError('Failed to fetch'))).toBe('offline');
    expect(errorCode(new CommunityError('not_found'))).toBe('not_found');
    expect(errorCode({ message: 'weird' })).toBe('unknown');
  });

  it('parses untrusted creation rows safely', () => {
    const creation = parseCreation({
      id: 'abc',
      kind: 'campaign',
      title: 'T'.repeat(80),
      description: null,
      level_count: 2,
      difficulty: 9,
      plays: -4,
      likes: 3,
      status: 'weird',
      created_at: '2026-11-12T00:00:00Z',
      updated_at: '2026-11-12T00:00:00Z',
      levels: [
        { name: 'One', rows: oneBrick() },
        { name: 'Broken', rows: ['xx'] }
      ],
      author: [{ nickname: 'Forgeron' }]
    });
    expect(creation.title).toHaveLength(60);
    expect(creation.difficulty).toBe(5);
    expect(creation.plays).toBe(0);
    expect(creation.status).toBe('published');
    expect(creation.levels).toHaveLength(1);
    expect(creation.author).toBe('Forgeron');
    expect(creation.preview?.name).toBe('One');
  });

  it('plays harder creations a little faster', () => {
    expect(paceIndexFor(1)).toBeLessThan(paceIndexFor(5));
  });
});
