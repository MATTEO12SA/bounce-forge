import { EDITOR_GRID_COLS, EDITOR_GRID_ROWS } from '../../../shared/editorGridRules.mjs';
import type { LevelOptions } from './levelOptions';
import type { LevelObjective, PatternDefinition } from './levelTypes';

/**
 * The 36 campaign levels, drawn as pixel art.
 *
 * Each art character becomes a 2×2 block of bricks, so a level is at most 18 characters wide
 * (36 editor columns). Legend: `.` empty · `1` standard · `2`/`3` reinforced · `E` explosive ·
 * `B` bonus · `S` shield · `X` steel · `C` crystal · `K` key · `G` gate · `R` phoenix ·
 * `I` ghost · `M` moving · `O` bumper · `T` teleporter · `F` fuse · `W` boss armour.
 *
 * How the campaign is built:
 * - five chapters with a theme each: basics, steel and angles, chain reactions, ball storms,
 *   mastery of every mechanism, then the wardens: bosses that move, shoot and enrage;
 * - inside a chapter, each level introduces ONE new idea on its own, in a forgiving layout,
 *   before later levels combine it with the others; the last level of a chapter is a finale;
 * - power-ups unlock with the chapters (see config/powerUps.ts) and level events (power-up rain,
 *   storm, descending wall) appear only in chapters 4 and 5;
 * - every level leaves room above the bricks and never seals a required brick (tested).
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
  S: 280,
  C: 160,
  K: 150,
  G: 120,
  R: 60,
  I: 150,
  M: 180,
  F: 140,
  W: 40
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

export interface ArtLevel {
  id: string;
  name: string;
  chapter: string;
  art: string[];
  objective: LevelObjective;
  /** Best combo that earns gold on its own. */
  goldCombo: number;
  options?: LevelOptions;
}

function makeLevel(level: ArtLevel, index: number): PatternDefinition {
  const rows = expandArt(level.art);
  const baseScore = rows
    .join('')
    .split('')
    .reduce((sum, symbol) => sum + (SYMBOL_SCORE[symbol] ?? 0), 0);
  const difficultyMultiplier = 1 + index * 0.08;
  // Score challenge: sustained combos plus end bonuses, about 2× the raw value of the level.
  const goldScore = Math.round((baseScore * difficultyMultiplier * 2) / 100) * 100;
  return {
    id: level.id,
    name: level.name,
    chapter: level.chapter,
    rows,
    objective: level.objective,
    medalTargets: { silverLives: 2, goldScore, goldBestCombo: level.goldCombo },
    ...(level.options ? { options: level.options } : {})
  };
}

const FORGE = 'Forge Basics';
const STEEL = 'Wall Mazes';
const CHAIN = 'Chain Reactor';
const STORM = 'Ball Storm';
const MECH = 'Mechanisms';
const BOSS = 'Wardens';

/** Chapter keys in campaign order (also used by the interface). */
export const CAMPAIGN_CHAPTERS = [FORGE, STEEL, CHAIN, STORM, MECH, BOSS] as const;

export const CAMPAIGN_ART: ArtLevel[] = [
  {
    id: 'spark',
    name: 'Spark',
    chapter: FORGE,
    // Bonus bricks: catch the multiball and enjoy the first storm of balls.
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
    // Reinforced bricks: pink ones take two hits.
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
    id: 'powder-keg',
    name: 'Powder Keg',
    chapter: FORGE,
    // Explosive bricks: one hit clears a whole area.
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
    // Combo: keep breaking bricks without a pause.
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
    // Crystals: each one splits the ball that breaks it.
    objective: objective('reachBalls', 10, 'Reach 10 balls'),
    goldCombo: 26,
    art: [
      'C.1.C.1.C.1.C.1.C.',
      '111111111111111111',
      '.1111111111111111.',
      '..11111CC1111111..',
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
    // Finale: steel cannot be broken, aim around it.
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
  {
    id: 'lock',
    name: 'Lock',
    chapter: STEEL,
    // Keys: break both keys and the gates guarding the bonus vault open.
    objective: objective('reachBalls', 12, 'Reach 12 balls'),
    goldCombo: 30,
    art: [
      '..GGGGGGGGGGGGGG..',
      '..GBBB222222BBBG..',
      '..G222222222222G..',
      '..GGGGGGGGGGGGGG..',
      '..................',
      'K1..............1K',
      '111....1111....111',
      '1111..111111..1111'
    ]
  },
  {
    id: 'battlements',
    name: 'Battlements',
    chapter: STEEL,
    // Towers open at the bottom: get the ball inside and let it rattle.
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
    // Zigzag corridors: the ball climbs from one shelf to the next.
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
    // Bumpers: unbreakable, they kick the ball back faster and pay points.
    objective: objective('bestCombo', 36, 'Reach 36 combo'),
    goldCombo: 42,
    art: [
      '2.2.2.2.2.2.2.2.2.',
      '.O...O...O...O...O',
      '1.1.1.B.1.1.1.B.1.',
      '...O...O...O...O..',
      '2.2.2.2.2.2.2.2.2.',
      '.O...O...O...O...O',
      '1.B.1.1.1.B.1.1.1.'
    ]
  },
  {
    id: 'passages',
    name: 'Passages',
    chapter: STEEL,
    // Teleporters: the lower portal sends the ball above the steel shelf.
    objective: objective('clearWithLives', 2, 'Clear with 2 lives'),
    goldCombo: 40,
    art: [
      '111111111111111111',
      '11B1111BB1111B1111',
      '111111111111111111',
      '........T.........',
      '.XXXXXXXXXXXXXXXX.',
      '..................',
      '........T.........',
      '..1111......1111..'
    ]
  },
  {
    id: 'vault',
    name: 'Vault',
    chapter: STEEL,
    // Finale: steel vault with a gate door; the keys hide in side pockets.
    objective: objective('reachBalls', 18, 'Reach 18 balls'),
    goldCombo: 48,
    art: [
      '..XXXXXXXXXXXXXX..',
      '..XBBBBBBBBBBBBX..',
      '..X333333333333X..',
      '..X222222222222X..',
      '..X111111111111X..',
      '..XXXXXGGGGXXXXX..',
      '..................',
      'XK..............KX',
      'X11............11X',
      '..11....11....11..'
    ]
  },
  {
    id: 'powder-store',
    name: 'Powder Store',
    chapter: CHAIN,
    // Clusters of explosives: one blast sets off the next.
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
    // Fuses: light one and it burns along the line, then blows up the rocket.
    objective: objective('triggerExplosions', 10, 'Trigger 10 explosions'),
    goldCombo: 54,
    art: [
      '..EEE........EEE..',
      '.E1B1E......E1B1E.',
      '..EEE........EEE..',
      '...F..........F...',
      '...F...EEEE...F...',
      '...F..E2B2E...F...',
      '..FF...EEEE...FF..',
      '.FF......F.....FF.'
    ]
  },
  {
    id: 'dominoes',
    name: 'Dominoes',
    chapter: CHAIN,
    // Diagonal chains: trigger the top and watch them fall.
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
    // Phoenix bricks: the lava keeps coming back, but you never need to clear it.
    objective: objective('triggerExplosions', 14, 'Trigger 14 explosions'),
    goldCombo: 62,
    art: [
      '.......RRRR.......',
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
    // Shielded crossroads: break in, then let the cross ignite.
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
    // Finale: a fuse ring around the core; one spark lights the whole reactor.
    objective: objective('triggerExplosions', 18, 'Trigger 18 explosions'),
    goldCombo: 70,
    art: [
      '....SSSSSSSSSS....',
      '..SSFFFFFFFFFFSS..',
      '.SFE2222222222EFS.',
      '.SF222BBBBBB222FS.',
      '.SF222BBBBBB222FS.',
      '.SFE2222222222EFS.',
      '..SSFFFFFFFFFFSS..',
      '....SSSSSSSSSS....'
    ]
  },
  {
    id: 'rain',
    name: 'Rain',
    chapter: STORM,
    // Crystal drops and power-up rain at every 25 combo.
    objective: objective('reachBalls', 20, 'Reach 20 balls'),
    goldCombo: 72,
    options: { bonusRain: true },
    art: [
      'C.1.1.C.1.1.C.1.1.',
      '.1.1.1.1.1.1.1.1.1',
      '1.1.C.1.1.C.1.1.C.',
      '.1.1.1.1.1.1.1.1.1',
      '1.C.1.1.C.1.1.C.1.',
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
    // Moving bricks: the bar slides inside the rings, time your shots.
    objective: objective('reachBalls', 24, 'Reach 24 balls'),
    goldCombo: 76,
    art: [
      '....1111111111....',
      '..111........111..',
      '.11...222222...11.',
      '11...2......2...11',
      '1....MMMMMMMM....1',
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
    // Ghost bricks hide in the honeycomb: they appear when touched.
    objective: objective('bestCombo', 70, 'Reach 70 combo'),
    goldCombo: 80,
    art: [
      '.222..222..222..22',
      '21B1221B1221B1221B',
      '21I122111221I12211',
      '.222..222..222..22',
      '...222..222..222..',
      '..21I122111221I1..',
      '..21B1221B1221B12.',
      '...222..222..222..',
      '.222..222..222..22',
      '2111221I12211I2211'
    ]
  },
  {
    id: 'tempest',
    name: 'Tempest',
    chapter: STORM,
    // Storm: lightning strikes a brick every few seconds.
    objective: objective('reachBalls', 30, 'Reach 30 balls'),
    goldCombo: 84,
    options: { storm: true },
    art: [
      '11....111111....11',
      '.11..11B..B11..11.',
      '..1111......1111..',
      '..................',
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
    // Shielded towers open at the bottom; the keep holds explosives.
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
    id: 'eye-of-the-storm',
    name: 'Eye of the Storm',
    chapter: STORM,
    // Finale: a crystal ring, a sliding bar and a core of explosives.
    objective: objective('reachBalls', 40, 'Reach 40 balls'),
    goldCombo: 96,
    options: { bonusRain: true },
    art: [
      '333333333333333333',
      '3CCCCCCCCCCCCCCCC3',
      '3C22222222222222C3',
      '3C2..MMMMMMMM..2C3',
      '3C2EEEE2SS2EEEE2C3',
      '3C2E11E2SS2E11E2C3',
      '3C2EEEE2SS2EEEE2C3',
      '3C22222222222222C3',
      '3C11111111111111C3',
      '.X1111XXXXXX1111X.',
      '..111111BB111111..',
      '...111111111111...',
      '....1111111111....'
    ]
  },
  {
    id: 'clockwork',
    name: 'Clockwork',
    chapter: MECH,
    // Gears of moving bricks turn between bumper pins.
    objective: objective('bestCombo', 60, 'Reach 60 combo'),
    goldCombo: 90,
    art: [
      '.2222222222222222.',
      '.2MMM........MMM2.',
      '.2..O..O..O..O..2.',
      '.2....MMMMMM....2.',
      '.2.O..O....O..O.2.',
      '.2MMM........MMM2.',
      '.2222222222222222.',
      '..1B1..1B1..1B1...',
      '..111..111..111...'
    ]
  },
  {
    id: 'portals',
    name: 'Portals',
    chapter: MECH,
    // Two teleporter pairs cut through a steel switchback.
    objective: objective('clearWithLives', 2, 'Clear with 2 lives'),
    goldCombo: 90,
    art: [
      '1111B1111111B11111',
      '11111111T111111111',
      'XXXXXXXXXXXXXXX...',
      '..T...............',
      '222222222222222222',
      '...XXXXXXXXXXXXXXX',
      '.T................',
      '..33333333333333..',
      '..3BB3333333BB33..',
      '..................',
      '........T.........'
    ]
  },
  {
    id: 'phoenix',
    name: 'Phoenix',
    chapter: MECH,
    // The wings keep reviving: perfect for huge combos. The fuse tail ends with a bang.
    objective: objective('bestCombo', 60, 'Reach 60 combo'),
    goldCombo: 96,
    art: [
      'RR..............RR',
      'RRR............RRR',
      '.RRR....33....RRR.',
      '..RRR..3EE3..RRR..',
      '...RRRR3333RRRR...',
      '....RR333333RR....',
      '......3BBBB3......',
      '.......3333.......',
      '........FF........',
      '.......FFFF.......',
      '......FF..FF......'
    ]
  },
  {
    id: 'descent',
    name: 'The Descent',
    chapter: MECH,
    // Every 25 seconds the whole wall comes one row closer.
    objective: objective('clearWithLives', 2, 'Clear with 2 lives'),
    goldCombo: 90,
    options: { descendEverySec: 25 },
    art: [
      '333333333333333333',
      '3B22222222222222B3',
      '322222222222222223',
      '311111111111111113',
      '31111CC1111CC11113',
      '311111111111111113',
      '.X..X..X..X..X..X.'
    ]
  },
  {
    id: 'ghost-ship',
    name: 'Ghost Ship',
    chapter: MECH,
    // A ship of ghost bricks sails through the storm.
    objective: objective('bestCombo', 50, 'Reach 50 combo'),
    goldCombo: 90,
    options: { storm: true },
    art: [
      '........I.........',
      '........II........',
      '........III.......',
      '........IIII......',
      '........IIIII.....',
      '........1.........',
      '.2222222222222222.',
      '..22B22222222B22..',
      '...222222222222...',
      '....3333333333....'
    ]
  },
  {
    id: 'grand-forge',
    name: 'The Grand Forge',
    chapter: MECH,
    // Finale: keys to the explosive vault, portals, fuses, a sliding bar, ghosts and phoenixes.
    objective: objective('triggerExplosions', 24, 'Trigger 24 explosions'),
    goldCombo: 110,
    options: { storm: true, bonusRain: true },
    art: [
      'O.......KK.......O',
      '..XXXXXXGGXXXXXX..',
      '..XBBBBBBBBBBBBX..',
      '..XEEE222222EEEX..',
      '..XXXXXXXXXXXXXX..',
      '.T..............T.',
      '..FFFF333333FFFF..',
      '.C....MMMMMM....C.',
      '..R3333333333333R.',
      '...2B22I22I22B2...',
      '....222222222.....'
    ]
  },
  {
    id: 'sentinel',
    name: 'Sentinel',
    chapter: BOSS,
    // First boss: one armoured warden. Hit it anywhere; dodge its bolts.
    objective: objective('clearWithLives', 2, 'Clear with 2 lives'),
    goldCombo: 40,
    art: [
      '..................',
      '.....WWWWWWWW.....',
      '.....WWWWWWWW.....',
      '.....WWWWWWWW.....',
      '..................',
      '..................',
      '..1111B1111B1111..',
      '..11111111111111..',
      '...111111111111...',
      '....1111111111....'
    ]
  },
  {
    id: 'shield-wall',
    name: 'Shield Wall',
    chapter: BOSS,
    // The warden hides behind reinforced walls: open a breach first.
    objective: objective('bestCombo', 30, 'Reach 30 combo'),
    goldCombo: 50,
    art: [
      '..................',
      '....WWWWWWWWWW....',
      '....WWWWWWWWWW....',
      '....WWWWWWWWWW....',
      '..................',
      'O................O',
      '.33333..22..33333.',
      '.2B222..22..222B2.',
      '.22222..22..22222.',
      '..1111..11..1111..',
      '..1111111111111...'
    ]
  },
  {
    id: 'twin-wardens',
    name: 'Twin Wardens',
    chapter: BOSS,
    // Two wardens share one health bar and fire in turn.
    objective: objective('reachBalls', 12, 'Reach 12 balls'),
    goldCombo: 55,
    art: [
      '..................',
      '.WWWWWW....WWWWWW.',
      '.WWWWWW....WWWWWW.',
      '..................',
      '..................',
      '..1B1...CC...1B1..',
      '..111..1111..111..',
      '.22222222222222222',
      '.2222B222222B2222.',
      '..11111111111111..'
    ]
  },
  {
    id: 'furnace-golem',
    name: 'Furnace Golem',
    chapter: BOSS,
    // Explosives and fuses around the golem: chain reactions hurt it twice as much.
    objective: objective('triggerExplosions', 18, 'Trigger 18 explosions'),
    goldCombo: 60,
    art: [
      '..................',
      '...EE.WWWWWW.EE...',
      '...EE.WWWWWW.EE...',
      '......WWWWWW......',
      '..F...WWWWWW...F..',
      '..F............F..',
      '..FFFF..BB..FFFF..',
      '.2222222222222222.',
      '.2E22222EE22222E2.',
      '..33333333333333..'
    ]
  },
  {
    id: 'storm-titan',
    name: 'Storm Titan',
    chapter: BOSS,
    // A huge titan under a lightning storm: the storm strikes it too.
    objective: objective('bestCombo', 45, 'Reach 45 combo'),
    goldCombo: 70,
    options: { storm: true },
    art: [
      '..................',
      '...WWWWWWWWWWWW...',
      '...WWWWWWWWWWWW...',
      '...WWWWWWWWWWWW...',
      '...WWWWWWWWWWWW...',
      '..................',
      '..................',
      '.I22222IIII22222I.',
      '.2222B222222B2222.',
      '..MMMM......MMMM..',
      '..33333333333333..'
    ]
  },
  {
    id: 'forge-lord',
    name: 'The Forge Lord',
    chapter: BOSS,
    // Finale: the Forge Lord behind a locked gate, with portals, phoenixes and a rain of power-ups.
    objective: objective('triggerExplosions', 20, 'Trigger 20 explosions'),
    goldCombo: 90,
    options: { bonusRain: true },
    art: [
      '..................',
      '..WWWWWWWWWWWWWW..',
      '..WWWWWWWWWWWWWW..',
      '..WWWWWWWWWWWWWW..',
      '..WWWWWWWWWWWWWW..',
      '..................',
      'T.XXXXXGGGGXXXXX.T',
      '..................',
      '.R..EE..KK..EE..R.',
      '.22222222222222222',
      '.2B2222CCCC2222B2.',
      '..33333333333333..'
    ]
  }
];

export const LEVEL_PATTERNS: PatternDefinition[] = CAMPAIGN_ART.map((level, index) =>
  makeLevel(level, index)
);
