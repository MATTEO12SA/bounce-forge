import type { Cell } from './editorModel';

/**
 * Ready-made shapes and a tiny pixel font for the editor. Shapes are drawn with `#`; each art
 * pixel becomes `scale × scale` bricks, like the campaign's 2 × 2 pixel art.
 */

export type StampId =
  | 'heart'
  | 'star'
  | 'diamond'
  | 'circle'
  | 'crown'
  | 'arrow'
  | 'bolt'
  | 'smile';

export const STAMPS: Record<StampId, readonly string[]> = {
  heart: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],
  star: ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'],
  diamond: ['...#...', '..###..', '.#####.', '#######', '.#####.', '..###..', '...#...'],
  circle: ['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..'],
  crown: ['#..#..#', '##.#.##', '#######', '#######', '.#####.'],
  arrow: ['...#...', '..###..', '.#####.', '#######', '..###..', '..###..', '..###..'],
  bolt: ['...##', '..##.', '.####', '..##.', '.##..', '##...'],
  smile: ['.#####.', '#######', '##.#.##', '#######', '#.###.#', '##...##', '.#####.']
};

export const STAMP_IDS = Object.keys(STAMPS) as StampId[];

/** 3 × 5 pixel font: uppercase letters, digits and a little punctuation. */
const FONT: Record<string, readonly string[]> = {
  A: ['###', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['###', '#..', '#..', '#..', '###'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['###', '#..', '#.#', '#.#', '###'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '###'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  P: ['###', '#.#', '###', '#..', '#..'],
  Q: ['###', '#.#', '#.#', '###', '..#'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['###', '#..', '###', '..#', '###'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  '?': ['###', '..#', '.##', '...', '.#.'],
  '-': ['...', '...', '###', '...', '...'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '.': ['...', '...', '...', '...', '.#.'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'],
  ' ': ['...', '...', '...', '...', '...']
};

/** Strips accents (É → E) and keeps only characters the pixel font knows. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/♥/g, '<')
    .split('')
    .filter((char) => FONT[char] !== undefined)
    .join('');
}

/** Pixel art for a line of text (characters 3 wide, 1 pixel apart). */
export function textArt(text: string): string[] {
  const chars = normalizeText(text).split('');
  if (chars.length === 0) return [];
  return Array.from({ length: 5 }, (_, row) =>
    chars.map((char) => FONT[char]?.[row] ?? '...').join('.')
  );
}

/**
 * Cells covered by pixel art scaled `scale` times, centred on (col, row) and snapped so that
 * scaled pixels line up with the brush grid.
 */
export function artCells(art: readonly string[], col: number, row: number, scale: number): Cell[] {
  const width = Math.max(0, ...art.map((line) => line.length));
  const left = snap(col - Math.floor((width * scale) / 2), scale);
  const top = snap(row - Math.floor((art.length * scale) / 2), scale);
  const cells: Cell[] = [];
  art.forEach((line, artRow) =>
    [...line].forEach((pixel, artCol) => {
      if (pixel === '.') return;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          cells.push({ col: left + artCol * scale + dx, row: top + artRow * scale + dy });
        }
      }
    })
  );
  return cells;
}

function snap(value: number, size: number): number {
  return size <= 1 ? value : Math.round(value / size) * size;
}
