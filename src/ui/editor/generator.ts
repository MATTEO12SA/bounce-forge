import { sealedBricks } from '../../game/levels/levelChecks';
import { expandArt } from '../../game/levels/levelPatterns';

/**
 * "Surprise!" level generator: symmetric pixel art (18 × up to 13 pixels, expanded 2 × 2 like the
 * campaign) built from a seed, so the same seed always gives the same level.
 */

const ART_WIDTH = 18;
const HALF = ART_WIDTH / 2;

type Random = () => number;

function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Mask = boolean[][];

function emptyMask(height: number): Mask {
  return Array.from({ length: height }, () => Array.from({ length: HALF }, () => false));
}

/** Organic blob: random noise smoothed by a few cellular-automaton passes. */
function blobMask(random: Random, height: number): Mask {
  let mask = emptyMask(height).map((row) => row.map(() => random() < 0.56));
  for (let pass = 0; pass < 4; pass += 1) {
    mask = mask.map((row, r) =>
      row.map((_, c) => {
        let neighbours = 0;
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            if (dr === 0 && dc === 0) continue;
            // Columns past the centre mirror back, so the blob stays whole across the middle.
            const cc = c + dc >= HALF ? HALF - 1 - (c + dc - HALF) : c + dc;
            if (mask[r + dr]?.[cc]) neighbours += 1;
          }
        }
        return neighbours >= 5 || (mask[r]?.[c] === true && neighbours >= 4);
      })
    );
  }
  return mask;
}

/** Concentric diamond or circle rings. */
function ringMask(random: Random, height: number): Mask {
  const round = random() < 0.5;
  const gap = 2 + Math.floor(random() * 2);
  const centreRow = (height - 1) / 2;
  return emptyMask(height).map((row, r) =>
    row.map((_, c) => {
      const dx = HALF - 0.5 - c;
      const dy = (r - centreRow) * 1.15;
      const distance = round ? Math.hypot(dx, dy) : Math.abs(dx) + Math.abs(dy);
      return distance < HALF + 0.5 && Math.floor(distance) % gap !== gap - 1;
    })
  );
}

/** Wavy horizontal bands. */
function waveMask(random: Random, height: number): Mask {
  const amplitude = 1 + random() * 1.6;
  const frequency = 0.45 + random() * 0.5;
  const phase = random() * Math.PI * 2;
  return emptyMask(height).map((row, r) =>
    row.map((_, c) => {
      const offset = Math.sin(c * frequency + phase) * amplitude;
      return Math.floor(r + offset + 10) % 3 !== 2;
    })
  );
}

function isEdge(mask: Mask, r: number, c: number): boolean {
  const neighbours: Array<[number, number]> = [
    [r - 1, c],
    [r + 1, c],
    [r, c - 1],
    [r, c + 1]
  ];
  return neighbours.some(([nr, nc]) => {
    if (nc >= HALF) return false;
    return !mask[nr]?.[nc];
  });
}

/** Builds 58 editor rows from a seed. Always returns a playable level. */
export function generateLevel(seed: number): string[] {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const random = mulberry32(seed + attempt * 7919);
    const height = 8 + Math.floor(random() * 6);
    const style = random();
    const mask =
      style < 0.45
        ? blobMask(random, height)
        : style < 0.75
          ? ringMask(random, height)
          : waveMask(random, height);

    const shellSymbol = random() < 0.5 ? '2' : '3';
    // Half of the levels shade from tough (top) to soft (bottom) instead of using a hard shell.
    const gradient = random() < 0.5;
    const bands = ['3', '2', '1'];
    const useSteel = random() < 0.35;
    const half = mask.map((row, r) =>
      row.map((filled, c) => {
        if (!filled) {
          // A few steel studs in empty space make the level more interesting to bank shots off.
          return useSteel && r === height - 1 && c % 3 === 1 && random() < 0.6 ? 'X' : '.';
        }
        const roll = random();
        if (roll < 0.05) return 'B';
        if (roll < 0.09) return 'E';
        if (r === 0 && random() < 0.25) return 'S';
        if (gradient) return bands[Math.floor((r / height) * bands.length)] ?? '1';
        return isEdge(mask, r, c) ? shellSymbol : '1';
      })
    );
    const art = half.map((row) => {
      const left = row.join('');
      return left + [...left].reverse().join('');
    });
    const rows = expandArt(art);
    const breakable = rows.join('').replace(/[^123EBS]/g, '').length;
    if (breakable >= 120 && sealedBricks(rows).length === 0) {
      return rows;
    }
  }
  // Extremely unlikely fallback: a plain wall of bricks.
  return expandArt(['111111111111111111', '1B11111111111111B1', '111111111111111111']);
}

/** A fresh random seed for the next surprise. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}
