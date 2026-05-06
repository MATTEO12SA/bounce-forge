import type { LevelObjective, PatternDefinition } from './levelTypes';

const ROWS = 58;
const COLS = 36;

type Grid = string[][];

function createGrid(): Grid {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => '.'));
}

function rowsOf(grid: Grid): string[] {
  return grid.map((row) => row.join(''));
}

function setCell(grid: Grid, row: number, col: number, value: string): void {
  if (grid[row]?.[col] !== undefined) {
    grid[row][col] = value;
  }
}

function rect(
  grid: Grid,
  rowStart: number,
  rowEnd: number,
  colStart: number,
  colEnd: number,
  value: string
): void {
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = colStart; col <= colEnd; col += 1) {
      setCell(grid, row, col, value);
    }
  }
}

function line(grid: Grid, row: number, colStart: number, colEnd: number, value: string): void {
  rect(grid, row, row, colStart, colEnd, value);
}

function border(grid: Grid, top: number, bottom: number, left: number, right: number): void {
  line(grid, top, left, right, 'X');
  line(grid, bottom, left, right, 'X');
  rect(grid, top, bottom, left, left, 'X');
  rect(grid, top, bottom, right, right, 'X');
}

function sprinkle(grid: Grid, value: string, positions: Array<[row: number, col: number]>): void {
  positions.forEach(([row, col]) => setCell(grid, row, col, value));
}

function objective(type: LevelObjective['type'], target: number, label: string): LevelObjective {
  return { type, target, label };
}

function makePattern(
  id: string,
  name: string,
  chapter: string,
  build: (grid: Grid) => void,
  objectiveValue: LevelObjective,
  goldScore: number,
  goldBestCombo: number
): PatternDefinition {
  const grid = createGrid();
  build(grid);

  return {
    id,
    name,
    chapter,
    rows: rowsOf(grid),
    objective: objectiveValue,
    medalTargets: {
      silverLives: 2,
      goldScore,
      goldBestCombo
    }
  };
}

export const LEVEL_PATTERNS: PatternDefinition[] = [
  makePattern(
    'warm-ignition',
    'Warm Ignition',
    'Forge Basics',
    (grid) => {
      for (let row = 3; row <= 12; row += 2) line(grid, row, 5, 30, '1');
      sprinkle(grid, 'B', [
        [5, 9],
        [5, 26],
        [9, 13],
        [9, 22]
      ]);
    },
    objective('reachBalls', 6, 'Reach 6 balls'),
    4200,
    14
  ),
  makePattern(
    'first-armor',
    'First Armor',
    'Forge Basics',
    (grid) => {
      for (let row = 3; row <= 15; row += 3) {
        line(grid, row, 4, 31, row % 2 === 0 ? '1' : '2');
      }
      rect(grid, 8, 10, 15, 20, 'S');
      sprinkle(grid, 'B', [
        [6, 7],
        [6, 28],
        [13, 17]
      ]);
    },
    objective('clearWithLives', 2, 'Clear with 2 lives'),
    6200,
    18
  ),
  makePattern(
    'spark-chain',
    'Spark Chain',
    'Forge Basics',
    (grid) => {
      for (let row = 4; row <= 18; row += 2) line(grid, row, 6, 29, '1');
      sprinkle(grid, 'E', [
        [7, 10],
        [7, 25],
        [11, 15],
        [11, 20],
        [15, 17],
        [15, 18]
      ]);
      sprinkle(grid, 'B', [
        [5, 17],
        [17, 17]
      ]);
    },
    objective('triggerExplosions', 4, 'Trigger 4 explosions'),
    8000,
    22
  ),
  makePattern(
    'gate-practice',
    'Gate Practice',
    'Forge Basics',
    (grid) => {
      border(grid, 3, 20, 4, 31);
      rect(grid, 4, 19, 5, 30, '1');
      rect(grid, 10, 19, 16, 19, '.');
      rect(grid, 3, 20, 17, 18, 'X');
      rect(grid, 15, 20, 17, 18, '.');
      sprinkle(grid, 'B', [
        [7, 11],
        [7, 24],
        [17, 15],
        [17, 20]
      ]);
    },
    objective('bestCombo', 20, 'Reach 20 combo'),
    9400,
    24
  ),
  makePattern(
    'ball-fountain',
    'Ball Fountain',
    'Forge Basics',
    (grid) => {
      for (let row = 4; row <= 22; row += 3) line(grid, row, 3, 32, '1');
      rect(grid, 8, 9, 8, 12, 'B');
      rect(grid, 8, 9, 23, 27, 'B');
      rect(grid, 16, 17, 14, 21, 'B');
      sprinkle(grid, 'S', [
        [12, 5],
        [12, 30]
      ]);
    },
    objective('reachBalls', 10, 'Reach 10 balls'),
    11200,
    28
  ),
  makePattern(
    'central-lane',
    'Central Lane',
    'Forge Basics',
    (grid) => {
      rect(grid, 4, 26, 5, 30, '1');
      rect(grid, 4, 26, 16, 19, '.');
      rect(grid, 4, 26, 15, 15, 'X');
      rect(grid, 4, 26, 20, 20, 'X');
      rect(grid, 4, 7, 16, 19, 'B');
      sprinkle(grid, 'E', [
        [12, 10],
        [12, 25],
        [20, 10],
        [20, 25]
      ]);
    },
    objective('bestCombo', 26, 'Reach 26 combo'),
    12800,
    30
  ),
  makePattern(
    'left-channel',
    'Left Channel',
    'Wall Mazes',
    (grid) => {
      rect(grid, 3, 30, 4, 31, '1');
      rect(grid, 3, 30, 8, 10, 'X');
      rect(grid, 12, 30, 11, 13, '.');
      rect(grid, 3, 18, 23, 25, 'X');
      rect(grid, 3, 9, 8, 10, '.');
      sprinkle(grid, 'B', [
        [6, 16],
        [20, 28]
      ]);
    },
    objective('bestCombo', 30, 'Reach 30 combo'),
    14600,
    34
  ),
  makePattern(
    'right-channel',
    'Right Channel',
    'Wall Mazes',
    (grid) => {
      rect(grid, 3, 32, 4, 31, '1');
      rect(grid, 3, 28, 25, 27, 'X');
      rect(grid, 12, 32, 22, 24, '.');
      rect(grid, 10, 26, 10, 12, 'X');
      rect(grid, 3, 9, 25, 27, '.');
      sprinkle(grid, 'E', [
        [16, 17],
        [24, 17]
      ]);
      sprinkle(grid, 'B', [
        [7, 20],
        [28, 7]
      ]);
    },
    objective('clearWithLives', 2, 'Clear with 2 lives'),
    16400,
    36
  ),
  makePattern(
    'needle-pass',
    'Needle Pass',
    'Wall Mazes',
    (grid) => {
      rect(grid, 4, 36, 4, 31, '1');
      rect(grid, 12, 34, 14, 15, 'X');
      rect(grid, 12, 34, 20, 21, 'X');
      rect(grid, 18, 30, 16, 19, '.');
      rect(grid, 4, 10, 16, 19, 'B');
      sprinkle(grid, 'S', [
        [22, 10],
        [22, 25]
      ]);
    },
    objective('reachBalls', 14, 'Reach 14 balls'),
    18200,
    38
  ),
  makePattern(
    'switchbacks',
    'Switchbacks',
    'Wall Mazes',
    (grid) => {
      rect(grid, 4, 38, 4, 31, '1');
      rect(grid, 8, 11, 4, 24, 'X');
      rect(grid, 17, 20, 11, 31, 'X');
      rect(grid, 26, 29, 4, 24, 'X');
      rect(grid, 8, 11, 8, 12, '.');
      rect(grid, 17, 20, 23, 27, '.');
      rect(grid, 26, 29, 8, 12, '.');
      sprinkle(grid, 'B', [
        [5, 28],
        [22, 7],
        [34, 28]
      ]);
    },
    objective('bestCombo', 36, 'Reach 36 combo'),
    20000,
    42
  ),
  makePattern(
    'twin-pillars',
    'Twin Pillars',
    'Wall Mazes',
    (grid) => {
      rect(grid, 3, 38, 4, 31, '1');
      rect(grid, 3, 38, 11, 13, 'X');
      rect(grid, 3, 38, 22, 24, 'X');
      rect(grid, 8, 12, 11, 24, '.');
      rect(grid, 22, 26, 11, 24, '.');
      rect(grid, 34, 38, 11, 24, '.');
      sprinkle(grid, 'B', [
        [16, 17],
        [30, 17]
      ]);
      sprinkle(grid, 'E', [
        [18, 8],
        [18, 27]
      ]);
    },
    objective('triggerExplosions', 3, 'Trigger 3 explosions'),
    21800,
    44
  ),
  makePattern(
    'maze-crown',
    'Maze Crown',
    'Wall Mazes',
    (grid) => {
      rect(grid, 3, 40, 4, 31, '1');
      border(grid, 8, 32, 8, 27);
      rect(grid, 9, 31, 9, 26, '.');
      rect(grid, 12, 28, 15, 20, '1');
      rect(grid, 8, 8, 16, 19, '.');
      rect(grid, 32, 32, 16, 19, '.');
      rect(grid, 18, 22, 8, 8, '.');
      rect(grid, 18, 22, 27, 27, '.');
      rect(grid, 18, 22, 16, 19, 'B');
    },
    objective('reachBalls', 18, 'Reach 18 balls'),
    23600,
    46
  ),
  makePattern(
    'fuse-line',
    'Fuse Line',
    'Chain Reactor',
    (grid) => {
      rect(grid, 4, 26, 5, 30, '1');
      for (let index = 0; index < 14; index += 1) {
        setCell(grid, 6 + index, 11 + (index % 14), 'E');
      }
      sprinkle(grid, 'B', [
        [5, 7],
        [22, 28]
      ]);
    },
    objective('triggerExplosions', 8, 'Trigger 8 explosions'),
    25400,
    48
  ),
  makePattern(
    'blast-boxes',
    'Blast Boxes',
    'Chain Reactor',
    (grid) => {
      rect(grid, 4, 34, 4, 31, '1');
      [
        [7, 8],
        [7, 23],
        [20, 8],
        [20, 23]
      ].forEach(([row, col]) => {
        border(grid, row, row + 5, col, col + 5);
        rect(grid, row + 2, row + 3, col + 2, col + 3, 'E');
      });
      rect(grid, 14, 16, 15, 20, 'B');
    },
    objective('triggerExplosions', 10, 'Trigger 10 explosions'),
    27200,
    50
  ),
  makePattern(
    'reactor-core',
    'Reactor Core',
    'Chain Reactor',
    (grid) => {
      rect(grid, 3, 36, 4, 31, '1');
      rect(grid, 12, 24, 13, 22, 'S');
      rect(grid, 15, 21, 16, 19, 'E');
      rect(grid, 4, 7, 6, 29, 'B');
      rect(grid, 28, 31, 6, 29, 'E');
    },
    objective('bestCombo', 50, 'Reach 50 combo'),
    29000,
    54
  ),
  makePattern(
    'double-detonator',
    'Double Detonator',
    'Chain Reactor',
    (grid) => {
      rect(grid, 4, 38, 5, 30, '1');
      rect(grid, 8, 30, 10, 13, 'X');
      rect(grid, 8, 30, 22, 25, 'X');
      rect(grid, 15, 23, 14, 21, 'E');
      rect(grid, 33, 36, 8, 27, 'B');
    },
    objective('triggerExplosions', 14, 'Trigger 14 explosions'),
    30800,
    56
  ),
  makePattern(
    'chain-cross',
    'Chain Cross',
    'Chain Reactor',
    (grid) => {
      rect(grid, 5, 40, 4, 31, '1');
      rect(grid, 10, 34, 17, 18, 'E');
      rect(grid, 21, 22, 7, 28, 'E');
      rect(grid, 14, 18, 10, 14, 'S');
      rect(grid, 25, 29, 21, 25, 'S');
      sprinkle(grid, 'B', [
        [7, 17],
        [38, 17]
      ]);
    },
    objective('bestCombo', 58, 'Reach 58 combo'),
    32600,
    60
  ),
  makePattern(
    'total-ignition',
    'Total Ignition',
    'Chain Reactor',
    (grid) => {
      rect(grid, 4, 42, 3, 32, '1');
      for (let row = 8; row <= 36; row += 4) {
        line(grid, row, 6, 29, 'E');
      }
      rect(grid, 16, 18, 13, 22, 'B');
      rect(grid, 28, 30, 13, 22, 'B');
      rect(grid, 38, 42, 9, 26, 'S');
    },
    objective('triggerExplosions', 18, 'Trigger 18 explosions'),
    34400,
    64
  ),
  makePattern(
    'ball-rain',
    'Ball Rain',
    'Ball Storm',
    (grid) => {
      rect(grid, 4, 30, 4, 31, '1');
      for (let row = 5; row <= 25; row += 4) line(grid, row, 7, 28, 'B');
      rect(grid, 32, 38, 9, 26, 'S');
    },
    objective('reachBalls', 20, 'Reach 20 balls'),
    36200,
    66
  ),
  makePattern(
    'storm-basin',
    'Storm Basin',
    'Ball Storm',
    (grid) => {
      rect(grid, 4, 40, 4, 31, '1');
      border(grid, 12, 34, 7, 28);
      rect(grid, 13, 33, 8, 27, 'B');
      rect(grid, 24, 34, 14, 21, '.');
      rect(grid, 12, 12, 16, 19, '.');
      rect(grid, 35, 40, 7, 28, 'S');
    },
    objective('reachBalls', 24, 'Reach 24 balls'),
    38000,
    68
  ),
  makePattern(
    'pinball-forge',
    'Pinball Forge',
    'Ball Storm',
    (grid) => {
      rect(grid, 4, 42, 4, 31, '1');
      rect(grid, 9, 36, 8, 9, 'X');
      rect(grid, 9, 36, 26, 27, 'X');
      rect(grid, 16, 18, 10, 25, 'B');
      rect(grid, 28, 30, 10, 25, 'B');
      sprinkle(grid, 'E', [
        [12, 17],
        [24, 17],
        [36, 17]
      ]);
    },
    objective('bestCombo', 70, 'Reach 70 combo'),
    39800,
    72
  ),
  makePattern(
    'overflow',
    'Overflow',
    'Ball Storm',
    (grid) => {
      rect(grid, 4, 44, 3, 32, '1');
      rect(grid, 5, 16, 6, 29, 'B');
      rect(grid, 22, 28, 8, 27, 'E');
      rect(grid, 34, 40, 6, 29, 'S');
      rect(grid, 18, 42, 17, 18, 'X');
      rect(grid, 28, 34, 17, 18, '.');
    },
    objective('reachBalls', 30, 'Reach 30 balls'),
    41600,
    74
  ),
  makePattern(
    'gold-storm',
    'Gold Storm',
    'Ball Storm',
    (grid) => {
      rect(grid, 4, 46, 3, 32, '1');
      for (let row = 6; row <= 42; row += 6) line(grid, row, 5, 30, 'B');
      for (let row = 10; row <= 38; row += 7) line(grid, row, 8, 27, 'E');
      rect(grid, 20, 28, 13, 22, 'S');
    },
    objective('reachBalls', 34, 'Reach 34 balls'),
    43400,
    78
  ),
  makePattern(
    'forty-ball-finale',
    'Forty Ball Finale',
    'Ball Storm',
    (grid) => {
      rect(grid, 3, 48, 3, 32, '1');
      border(grid, 8, 42, 6, 29);
      rect(grid, 9, 41, 7, 28, 'B');
      rect(grid, 18, 34, 12, 23, 'E');
      rect(grid, 25, 42, 16, 19, '.');
      rect(grid, 8, 8, 16, 19, '.');
      rect(grid, 43, 48, 6, 29, 'S');
    },
    objective('reachBalls', 40, 'Reach 40 balls'),
    46000,
    82
  )
];
