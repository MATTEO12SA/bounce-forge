// Automatic moderation of player text (nicknames, titles, descriptions), shared by the client
// (instant feedback) and the database migration generator (the server is the authority).
//
// Text is normalised before matching: lower case, accents removed, common "leet" digits mapped
// to letters, everything that is not a letter turned into a space, repeated letters collapsed.
// Each word is matched as a whole word; long, distinctive words are also caught when the letters
// are spaced out or glued to other words ("f u c k", "xxconnardxx"). Short words are only matched
// whole, so "Computer", "Violet", "Cocktail" or "à retardement" are never flagged. Words that are
// also ordinary words in the other language ("bite", "retard", "chatte") are left out.
//
// The same list and normalisation live in supabase/migrations/*_moderation.sql;
// tests/moderation.test.ts checks that both stay identical.

/** [word, alsoMatchInsideWords] — written in plain form, normalised at load time. */
const WORDS = [
  // French
  ['connard', true],
  ['connasse', true],
  ['salope', true],
  ['salopard', true],
  ['salaud', false],
  ['pute', false],
  ['putain', true],
  ['encule', true],
  ['enculer', true],
  ['niquer', true],
  ['nique', false],
  ['ntm', false],
  ['fdp', false],
  ['pd', false],
  ['pede', false],
  ['batard', false],
  ['enfoire', true],
  ['negre', true],
  ['bougnoule', true],
  ['youpin', true],
  ['pedophile', true],
  ['violer', false],
  ['viol', false],
  // English
  ['fuck', true],
  ['fucker', true],
  ['motherfucker', true],
  ['shit', false],
  ['bitch', true],
  ['cunt', true],
  ['dick', false],
  ['cock', false],
  ['pussy', false],
  ['asshole', true],
  ['bastard', false],
  ['whore', true],
  ['slut', false],
  ['nigger', false],
  ['nigga', false],
  ['faggot', false],
  ['fag', false],
  ['rape', false],
  ['rapist', true],
  ['pedo', false],
  ['porn', false],
  ['twat', false],
  ['wanker', true],
  ['chink', false],
  ['spic', false],
  ['kike', false],
  ['kys', false],
  // Both
  ['nazi', false],
  ['hitler', true]
];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's' };

/** Lower case, no accents, leet mapped, letters only (other characters become spaces), no repeats. */
export function normalizeForModeration(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\u0153/g, 'oe')
    .replace(/\u00e6/g, 'ae')
    .replace(/[0-9@$]/g, (char) => LEET[char] ?? char)
    .replace(/[^a-z]+/g, ' ')
    .replace(/([a-z])\1+/g, '$1')
    .trim();
}

/** The word list in normalised form: [word, alsoMatchInsideWords]. */
export const BANNED_WORDS = Object.freeze(
  WORDS.map(([word, inside]) => Object.freeze([normalizeForModeration(word), inside]))
);

/** True when the text contains an offensive word. */
export function isOffensive(text) {
  const normalized = normalizeForModeration(text);
  if (!normalized) return false;
  const spaced = ` ${normalized} `;
  const squashed = normalized.replace(/ /g, '');
  return BANNED_WORDS.some(
    ([word, inside]) => spaced.includes(` ${word} `) || (inside && squashed.includes(word))
  );
}

/** Links and e-mail addresses are not allowed in public text (spam). */
export function hasLink(text) {
  return /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|fr|io|gg|xyz|ru|ly|me)\b|@[a-z0-9-]+\.)/i.test(
    String(text ?? '')
  );
}
