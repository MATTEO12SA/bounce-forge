import { EDITOR_GRID_COLS, EDITOR_GRID_ROWS } from '../../../shared/editorGridRules.mjs';
import type { LevelObjective, PatternDefinition } from './levelTypes';

/**
 * The 24 campaign levels, drawn as pixel art.
 *
 * Each art character becomes a 2×2 block of bricks, so a level is at most 18 characters wide
 * (36 editor columns). Legend: `.` empty · `1` standard · `2`/`3` reinforced · `E` explosive ·
 * `B` bonus (always drops a multiball) · `S` shield · `X` steel (indestructible).
 *
 * Design rules: every level leaves room above the bricks (getting the ball over the top is the
 * most satisfying moment of a breakout), steel never fully encloses breakable bricks, and each
 * chapter introduces one idea before mixing it with the others.
 */

const COLS = EDITOR_GRID_COLS;
const ROWS = EDITOR_GRID_ROWS;
const ART_SCALE = 2;
const TOP_MARGIN = 3;

/** Base score per brick symbol, mirrored from the level factory templates. */
const SYMBOL_SCORE: Record<string, number> = {
  '1': 100,
  '2': 170,
  '3': 240,
  E: 210,
  B: 130,
  S: 280
};

function objective(type: LevelObjective['type'], target: number, label: string): LevelObjective {
  return { type, target, label };
}

/** Expands pixel art (≤ 18 wide) into the 36 × 58 editor grid, centred horizontally. */
export function expandArt(art: readonly string[], topMargin = TOP_MARGIN): string[] {
  const width = Math.max(...art.map((row) => row.length));
  const startCol = Math.floor((COLS - width * ART_SCALE) / 2);
  const rows = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => '.'));
  art.forEach((artRow, artRowIndex) => {
    const padded = artRow.padEnd(width, '.');
    [...padded].forEach((symbol, artCol) => {
      for (let dy = 0; dy < ART_SCALE; dy += 1) {
        for (let dx = 0; dx < ART_SCALE; dx += 1) {
          const row = topMargin + artRowIndex * ART_SCALE + dy;
          const col = startCol + artCol * ART_SCALE + dx;
          const target = rows[row];
          if (target && col >= 0 && col < COLS) {
            target[col] = symbol;
          }
        }
      }
    });
  });
  return rows.map((row) => row.join(''));
}

interface ArtLevel {
  id: string;
  name: string;
  chapter: string;
  art: string[];
  objective: LevelObjective;
  /** Best combo that earns gold on its own. */
  goldCombo: number;
}

function makeLevel(level: ArtLevel, index: number): PatternDefinition {
  const rows = expandArt(level.art);
  const baseScore = rows
    .join('')
    .split('')
    .reduce((sum, symbol) => sum + (SYMBOL_SCORE[symbol] ?? 0), 0);
  const difficultyMultiplier = 1 + index * 0.08;
  // Gold needs a clean, combo-rich clear: about 1.6× the raw value of the level.
  const goldScore = Math.round((baseScore * difficultyMultiplier * 1.6) / 100) * 100;
  return {
    id: level.id,
    name: level.name,
    chapter: level.chapter,
    rows,
    objective: level.objective,
    medalTargets: { silverLives: 2, goldScore, goldBestCombo: level.goldCombo }
  };
}

const FORGE = 'Forge Basics';
const STEEL = 'Wall Mazes';
const CHAIN = 'Chain Reactor';
const STORM = 'Ball Storm';

const LEVELS: ArtLevel[] = [
  // ------------------------------------------------------------ Chapter 1: Forge Basics
  {
    id: 'spark',
    name: 'Spark',
    chapter: FORGE,
    objective: objective('reachBalls', 6, 'Reach 6 balls'),
    goldCombo: 16,
    art: [
      '........11........',
      '.......1111.......',
      '......11BB11......',
      '.....11111111.....',
      '....111B11B111....',
      '.....11111111.....',
      '......111111......',
      '.......1111.......',
      '........11........'
    ]
  },
  {
    id: 'anvil',
    name: 'Anvil',
    chapter: FORGE,
    objective: objective('clearWithLives', 2, 'Clear with 2 lives'),
    goldCombo: 18,
    art: [
      '.22222222222222...',
      '2222222222222222..',
      '..11111111111111..',
      '....1111111111....',
      '......11B111......',
      '......111111......',
      '....1111111111....',
      '...111111111111...'
    ]
  },
  {
    id: 'fuse',
    name: 'Fuse',
    chapter: FORGE,
    objective: objective('triggerExplosions', 4, 'Trigger 4 explosions'),
    goldCombo: 22,
    art: [
      '1................1',
      '11..............11',
      '1E1............1E1',
      '.111..........111.',
      '..1111......1111..',
      '...11E1.BB.1E11...',
      '....1111..1111....',
      '.....111EE111.....',
      '......11..11......'
    ]
  },
  {
    id: 'forge-heart',
    name: 'Forge Heart',
    chapter: FORGE,
    objective: objective('bestCombo', 20, 'Reach 20 combo'),
    goldCombo: 26,
    art: [
      '..222.....222..',
      '.21112...21112.',
      '2111112.2111112',
      '211111121111112',
      '2111111B1111112',
      '.2111111111112.',
      '..21111111112..',
      '...211111112...',
      '....2111112....',
      '.....21112.....',
      '......212......',
      '.......2.......'
    ]
  },
  {
    id: 'fountain',
    name: 'Fountain',
    chapter: FORGE,
    objective: objective('reachBalls', 10, 'Reach 10 balls'),
    goldCombo: 26,
    art: [
      'B.1.B.1.B.1.B.1.B.',
      '111111111111111111',
      '.1111111111111111.',
      '..11111111111111..',
      '...111111111111...',
      '....1111111111....',
      '.....11111111.....',
      '......111111......'
    ]
  },
  {
    id: 'hammer',
    name: 'Hammer',
    chapter: FORGE,
    objective: objective('bestCombo', 26, 'Reach 26 combo'),
    goldCombo: 30,
    art: [
      '..XXXXXXXXXXXXXX..',
      '..32222222222223..',
      '..32222BB2222223..',
      '..XXXXX....XXXXX..',
      '.......1111.......',
      '.......1E11.......',
      '.......1111.......',
      '.......11E1.......',
      '.......1111.......',
      '......111111......'
    ]
  },

  // ------------------------------------------------------------ Chapter 2: Steel Mazes
  {
    id: 'gates',
    name: 'Gates',
    chapter: STEEL,
    objective: objective('bestCombo', 30, 'Reach 30 combo'),
    goldCombo: 34,
    art: [
      '222222222222222222',
      '111B1111111111B111',
      '111111111111111111',
      'X..X..X..X..X..X.X',
      'X..X..X..X..X..X.X',
      '1..1..1..1..1..1.1'
    ]
  },
  {
    id: 'battlements',
    name: 'Battlements',
    chapter: STEEL,
    objective: objective('clearWithLives', 2, 'Clear with 2 lives'),
    goldCombo: 34,
    art: [
      '.X.X.X......X.X.X.',
      '.XXXXX......XXXXX.',
      '.X222X..11..X222X.',
      '.X2B2X.1111.X2B2X.',
      '.X222X.1111.X222X.',
      '.X111X.1111.X111X.',
      '.X...X.1111.X...X.',
      '.......1111.......'
    ]
  },
  {
    id: 'switchbacks',
    name: 'Switchbacks',
    chapter: STEEL,
    objective: objective('reachBalls', 14, 'Reach 14 balls'),
    goldCombo: 38,
    art: [
      '111111111111111111',
      'XXXXXXXXXXXXXX....',
      '1111B1111111111111',
      '....XXXXXXXXXXXXXX',
      '111111111111B11111',
      'XXXXXXXXXXXXXX....',
      '111111111111111111'
    ]
  },
  {
    id: 'pachinko',
    name: 'Pachinko',
    chapter: STEEL,
    objective: objective('bestCombo', 36, 'Reach 36 combo'),
    goldCombo: 42,
    art: [
      '2.2.2.2.2.2.2.2.2.',
      '.X...X...X...X...X',
      '1.1.1.B.1.1.1.B.1.',
      '...X...X...X...X..',
      '2.2.2.2.2.2.2.2.2.',
      '.X...X...X...X...X',
      '1.B.1.1.1.B.1.1.1.'
    ]
  },
  {
    id: 'corridors',
    name: 'Corridors',
    chapter: STEEL,
    objective: objective('triggerExplosions', 3, 'Trigger 3 explosions'),
    goldCombo: 44,
    art: [
      '1X1111X1111X1111X1',
      '1X1111X1111X1111X1',
      '1X11E1X1B11X11E1X1',
      '1X1111X1111X1111X1',
      '1X1111X1111X1111X1',
      '1X2222X2222X2222X1'
    ]
  },
  {
    id: 'vault',
    name: 'Vault',
    chapter: STEEL,
    objective: objective('reachBalls', 18, 'Reach 18 balls'),
    goldCombo: 48,
    art: [
      'XXXXXXXXXXXXXXXX',
      'XBBBBBBBBBBBBBBX',
      'X33333333333333X',
      'X22222222222222X',
      'X22222222222222X',
      'X11111111111111X',
      'X11111111111111X',
      'XXXXXXX..XXXXXXX'
    ]
  },

  // ------------------------------------------------------------ Chapter 3: Chain Reactor
  {
    id: 'powder-store',
    name: 'Powder Store',
    chapter: CHAIN,
    objective: objective('triggerExplosions', 8, 'Trigger 8 explosions'),
    goldCombo: 50,
    art: [
      '.111...111...111..',
      '.1E1...1E1...1E1..',
      '.111...111...111..',
      '...111...111...111',
      '...1E1...1B1...1E1',
      '...111...111...111',
      '.111...111...111..',
      '.1E1...1E1...1E1..',
      '.111...111...111..'
    ]
  },
  {
    id: 'fireworks',
    name: 'Fireworks',
    chapter: CHAIN,
    objective: objective('triggerExplosions', 10, 'Trigger 10 explosions'),
    goldCombo: 54,
    art: [
      '...EEE......EEE...',
      '..E111E....E111E..',
      '..E1B1E....E1B1E..',
      '..E111E....E111E..',
      '...EEE......EEE...',
      '.......EEEE.......',
      '......E2222E......',
      '......E22B2E......',
      '......E2222E......',
      '.......EEEE.......'
    ]
  },
  {
    id: 'dominoes',
    name: 'Dominoes',
    chapter: CHAIN,
    objective: objective('bestCombo', 50, 'Reach 50 combo'),
    goldCombo: 60,
    art: [
      'E1111111111111111E',
      '1E11111111111111E1',
      '11E111111111111E11',
      '111E1111BB1111E111',
      '1111E11111111E1111',
      '11111E111111E11111',
      '222222E2222E222222',
      '2222222E22E2222222'
    ]
  },
  {
    id: 'volcano',
    name: 'Volcano',
    chapter: CHAIN,
    objective: objective('triggerExplosions', 14, 'Trigger 14 explosions'),
    goldCombo: 62,
    art: [
      '........EE........',
      '.......1EE1.......',
      '......1EEEE1......',
      '.....12EEEE21.....',
      '....122EEEE221....',
      '...1222EBBE2221...',
      '..122222EE222221..',
      '.12222222222222221',
      '333333333333333333'
    ]
  },
  {
    id: 'chain-cross',
    name: 'Chain Cross',
    chapter: CHAIN,
    objective: objective('bestCombo', 58, 'Reach 58 combo'),
    goldCombo: 66,
    art: [
      '.......1EE1.......',
      '.......1EE1.......',
      '.......1EE1.......',
      '2222222SEES2222222',
      'EEEEEEEEBBEEEEEEEE',
      '2222222SEES2222222',
      '.......1EE1.......',
      '.......1EE1.......',
      '.......1EE1.......'
    ]
  },
  {
    id: 'atomic-core',
    name: 'Atomic Core',
    chapter: CHAIN,
    objective: objective('triggerExplosions', 18, 'Trigger 18 explosions'),
    goldCombo: 70,
    art: [
      '....SSSSSSSSSS....',
      '..SSEEEEEEEEEESS..',
      '.SEE2222222222EES.',
      '.SE222BBBBBB222ES.',
      '.SE222BBBBBB222ES.',
      '.SEE2222222222EES.',
      '..SSEEEEEEEEEESS..',
      '....SSSSSSSSSS....'
    ]
  },

  // ------------------------------------------------------------ Chapter 4: Ball Storm
  {
    id: 'rain',
    name: 'Rain',
    chapter: STORM,
    objective: objective('reachBalls', 20, 'Reach 20 balls'),
    goldCombo: 72,
    art: [
      'B.1.1.B.1.1.B.1.1.',
      '.1.1.1.1.1.1.1.1.1',
      '1.1.B.1.1.B.1.1.B.',
      '.1.1.1.1.1.1.1.1.1',
      '1.B.1.1.B.1.1.B.1.',
      '.1.1.1.1.1.1.1.1.1',
      '2.2.2.2.2.2.2.2.2.',
      '.2.2.2.2.2.2.2.2.2',
      '3.3.3.3.3.3.3.3.3.'
    ]
  },
  {
    id: 'target',
    name: 'Target',
    chapter: STORM,
    objective: objective('reachBalls', 24, 'Reach 24 balls'),
    goldCombo: 76,
    art: [
      '....1111111111....',
      '..111........111..',
      '.11...222222...11.',
      '11...2......2...11',
      '1...2..BBBB..2...1',
      '1...2..BEEB..2...1',
      '1...2..BBBB..2...1',
      '11...2......2...11',
      '.11...222222...11.',
      '..111........111..',
      '....1111111111....'
    ]
  },
  {
    id: 'hive',
    name: 'Hive',
    chapter: STORM,
    objective: objective('bestCombo', 70, 'Reach 70 combo'),
    goldCombo: 80,
    art: [
      '.222..222..222..22',
      '21B1221B1221B1221B',
      '211122111221112211',
      '.222..222..222..22',
      '...222..222..222..',
      '..21112211122111..',
      '..21B1221B1221B12.',
      '...222..222..222..',
      '.222..222..222..22',
      '211122111221112211'
    ]
  },
  {
    id: 'tempest',
    name: 'Tempest',
    chapter: STORM,
    objective: objective('reachBalls', 30, 'Reach 30 balls'),
    goldCombo: 84,
    art: [
      '11....111111....11',
      '.11..11B..B11..11.',
      '..1111......1111..',
      '...........,......',
      '22....222222....22',
      '.22..22E..E22..22.',
      '..2222......2222..',
      '..................',
      '33....333333....33',
      '.33..33B..B33..33.',
      '..3333......3333..'
    ]
  },
  {
    id: 'fortress',
    name: 'Fortress',
    chapter: STORM,
    objective: objective('reachBalls', 34, 'Reach 34 balls'),
    goldCombo: 88,
    art: [
      'X.X.X.X....X.X.X.X',
      'XXXXXXX....XXXXXXX',
      'XSSSSSX....XSSSSSX',
      'XS222SX.EE.XS222SX',
      'XS2B2SX.EE.XS2B2SX',
      'XS222SX....XS222SX',
      'X.....X1111X.....X',
      'X.....X1BB1X.....X',
      'XXX.XXX1111XXX.XXX',
      '......111111......'
    ]
  },
  {
    id: 'grand-finale',
    name: 'Grand Finale',
    chapter: STORM,
    objective: objective('reachBalls', 40, 'Reach 40 balls'),
    goldCombo: 96,
    art: [
      '333333333333333333',
      '3BBBBBBBBBBBBBBBB3',
      '3B22222222222222B3',
      '3B2EEEE2SS2EEEE2B3',
      '3B2E11E2SS2E11E2B3',
      '3B2EEEE2SS2EEEE2B3',
      '3B22222222222222B3',
      '3B11111111111111B3',
      '.X1111XXXXXX1111X.',
      '..111111BB111111..',
      '...111111111111...',
      '....1111111111....'
    ]
  }
];

export const LEVEL_PATTERNS: PatternDefinition[] = LEVELS.map((level, index) =>
  makeLevel({ ...level, art: level.art.map((row) => row.replace(/[^.123EBSX]/g, '.')) }, index)
);
