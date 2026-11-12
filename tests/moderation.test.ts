import { describe, expect, it } from 'vitest';
import { hasLink, isOffensive, normalizeForModeration } from '../shared/moderation.mjs';

describe('automatic moderation', () => {
  it('normalises accents, leetspeak, symbols and repeated letters', () => {
    expect(normalizeForModeration('Énculé !!')).toBe('encule');
    expect(normalizeForModeration('C0NN4RD')).toBe('conard');
    expect(normalizeForModeration('fuuuuck')).toBe('fuck');
  });

  it('catches offensive words, disguised or not', () => {
    for (const text of [
      'Gros connard',
      'c0nn4rd',
      'F.U.C.K',
      'f u c k this',
      'xxSALOPExx',
      'Le niveau de Hitler',
      'pd',
      'kys noob',
      'motherfuuucker'
    ]) {
      expect(isOffensive(text), text).toBe(true);
    }
  });

  it('leaves ordinary names and titles alone', () => {
    for (const text of [
      'Mèche à retardement',
      'Computer',
      'Violet',
      'Le violon',
      'Cocktail',
      'Dickens',
      'Assassin',
      'Grape',
      'Sussex',
      'Spice',
      'Tempête de cristal',
      'Forgeron_42',
      'Shiitake',
      'Pédale douce',
      'Cassis',
      'Pute' + 'aux'
    ]) {
      expect(isOffensive(text), text).toBe(false);
    }
  });

  it('refuses links', () => {
    expect(hasLink('va sur www.example.com')).toBe(true);
    expect(hasLink('https://x.y')).toBe(true);
    expect(hasLink('mon-site.gg')).toBe(true);
    expect(hasLink('Niveau 2.5 de la forge')).toBe(false);
  });
});
