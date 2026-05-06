# Game Reference

Single-file complete reference for **Bounce Forge**. Reading this should be enough to understand the entire game — rules, controls, mechanics, scoring, levels, persistence, and code layout.

## Pitch

Bounce Forge is an original browser brick-breaker built on Phaser 3, TypeScript, and Vite. All visuals are generated geometry; all sounds are procedurally synthesized. No proprietary assets. Designed to run on desktop and mobile from a static deploy.

## Core Gameplay Loop

1. The player launches a ball from a paddle into a grid of bricks.
2. The ball bounces off walls, the paddle, and breakable bricks until cleared.
3. Some breaks drop a falling round power-up; catching it with the paddle activates the effect.
4. Losing every active ball costs one life; ending with zero lives is game over.
5. Clearing all breakable bricks ends the level, awards a life bonus, and unlocks the next.

## Controls

- **Mouse / touch**: move the paddle.
- **Arrow keys** or **A / D**: move the paddle.
- **Space / Enter / left click / tap**: launch a ball that is attached to the paddle.
- **P** or **Esc**: pause.
- **R**: restart the current level.

## Entities

- **Paddle** ([src/game/entities/Paddle.ts](../src/game/entities/Paddle.ts)) — horizontal rectangle controlled by the player. Width is clamped between `PADDLE_MIN_WIDTH` and `PADDLE_MAX_WIDTH`. Bounce angle off the paddle depends on where the ball hits.
- **Ball** ([src/game/entities/Ball.ts](../src/game/entities/Ball.ts)) — circular projectile. Speed is clamped per-level. Axis-lock prevention nudges near-horizontal/near-vertical trajectories. A "fire" flag lets it deal more damage and pierce.
- **Brick** ([src/game/entities/Brick.ts](../src/game/entities/Brick.ts)) — four kinds:
  - `standard`: 1 hit, baseline score.
  - `resistant`: multiple hits, higher score.
  - `explosive`: 1 hit, damages neighboring bricks (chain depth ≤ 2, radius 78 units).
  - `indestructible`: blocks the ball, never counts toward level completion.
- **Projectile** ([src/game/entities/Projectile.ts](../src/game/entities/Projectile.ts)) — laser shot fired by the paddle while the laser power-up is active.
- **PowerUp** ([src/game/entities/PowerUp.ts](../src/game/entities/PowerUp.ts)) — round pickup that falls from a destroyed brick. Drop velocity is `POWER_UP_DROP_SPEED` (320 px/s).
- **Shield** ([src/game/entities/Shield.ts](../src/game/entities/Shield.ts)) — one-shot horizontal barrier under the paddle that bounces a single falling ball, then disappears.

## Power-Ups

All power-ups are defined in [src/game/systems/PowerUpSystem.ts](../src/game/systems/PowerUpSystem.ts). Selection is weighted by `weight`, rolled per brick break against `powerUpDropChance`.

| Type          | Label | Color                 | Effect                                                                      | Duration       | Weight | Polarity |
| ------------- | ----- | --------------------- | --------------------------------------------------------------------------- | -------------- | ------ | -------- |
| `multiBall`   | x3    | green `0x61d394`      | Splits each free ball into up to 3 (capped at `MAX_ACTIVE_BALLS = 7`)       | instant        | 1.15   | positive |
| `widePaddle`  | W     | cyan `0x3bb7d8`       | Paddle scale ×1.38                                                          | 11000 ms       | 1.00   | positive |
| `laser`       | L     | yellow `0xffdf6e`     | Paddle auto-fires twin projectiles every 310 ms                             | 9000 ms        | 0.78   | positive |
| `fireBall`    | F     | orange `0xff7a59`     | Balls deal +damage and the brick collision triggers stronger break behavior | 8000 ms        | 0.72   | positive |
| `slowMotion`  | S     | light blue `0xa7d8ff` | All ball speeds × 0.72                                                      | 7000 ms        | 0.82   | positive |
| `shield`      | O     | cyan-green `0x6effe0` | Spawns a one-shot barrier under the paddle                                  | until consumed | 0.70   | positive |
| `extraLife`   | +1    | pink `0xff7ac8`       | +1 life, capped at `MAX_LIVES = 5`                                          | instant        | 0.40   | positive |
| `smallPaddle` | −     | red `0xff5c5c`        | Paddle scale × 0.7                                                          | 8000 ms        | 0.50   | negative |
| `fastBall`    | !     | deep red `0xd83a3a`   | All ball speeds × 1.18                                                      | 7000 ms        | 0.48   | negative |

Trigger: every brick break rolls `chance(powerUpDropChance)` from [src/game/utils/random.ts](../src/game/utils/random.ts). On success, `pickWeighted` selects a type, and a round `PowerUp` falls at 320 px/s.

## Scoring And Combo

Scoring lives in [src/game/systems/ScoreSystem.ts](../src/game/systems/ScoreSystem.ts).

```
awarded = round(baseScore × difficultyMultiplier × comboMultiplier)
```

Combo lives in [src/game/systems/ComboSystem.ts](../src/game/systems/ComboSystem.ts).

- Each break increments `streak` and resets `timeRemainingMs` to `COMBO_TIMEOUT_MS = 2200 ms`.
- `multiplier = 1 + min(streak − 1, 12) × 0.12` (capped at 13× streak → 2.44× multiplier).
- If no break for `COMBO_TIMEOUT_MS`, the combo resets to 0.

Victory bonus: `+500 × livesRemaining` added to the score on level clear, via `ScoreSystem.addLifeBonus`.

## Difficulty

Computed per level index in [src/game/config/difficultyConfig.ts](../src/game/config/difficultyConfig.ts):

- `ballSpeed`: starts at `BALL_START_SPEED = 540`, +34 per level, clamped under `BALL_MAX_SPEED − 70`.
- `maxBallSpeed`: starts at `BALL_MAX_SPEED = 960`, +18 per level, clamped to `BALL_MAX_SPEED + 180`.
- `brickHealthBonus`: `floor(levelIndex / 4)` extra hit points for resistant bricks.
- `powerUpDropChance`: `clamp(0.25 + levelIndex × 0.005, 0.25, 0.32)` — baseline 25% on level 1 rising slightly to 32% at higher levels.
- `scoreMultiplier`: `1 + levelIndex × 0.08`.
- `initialLives`: starts at `STARTING_LIVES = 3`, drops by 1 every six levels, floored at 2.

## Levels

Defined in [src/game/levels/](../src/game/levels/).

- The campaign has 6 patterns ([src/game/levels/levelPatterns.ts](../src/game/levels/levelPatterns.ts)): `golden-maze`, `offset-maze`, `corner-lock`, `side-lock`, `double-lock`, `crest`.
- Each pattern is a 36×58 character grid (`.` empty, `1`/`2`/`3` standard with hp 1/2/3, `E` explosive, `X` indestructible) translated by [src/game/levels/levelFactory.ts](../src/game/levels/levelFactory.ts) into `BrickSpec[]`.
- **Slot 1 is hardcoded** to a custom design committed in `levelPatterns.ts` — survives any localStorage reset.
- The **level editor** ([src/game/scenes/LevelEditorScene.ts](../src/game/scenes/LevelEditorScene.ts)) lets the player paint custom maps over any of the 6 slots. A custom map saved through the editor takes priority over the hardcoded campaign pattern at runtime ([src/game/systems/LevelSystem.ts](../src/game/systems/LevelSystem.ts) line 18).

## Persistence

Persistence is centralized in [src/game/systems/SaveSystem.ts](../src/game/systems/SaveSystem.ts) and uses the storage adapter at [src/game/utils/storage.ts](../src/game/utils/storage.ts).

- **Storage key**: `bounce-forge.save.v1` (defined as `SAVE_STORAGE_KEY` in [src/game/utils/constants.ts](../src/game/utils/constants.ts)).
- **Persisted fields**:
  - `bestScore`
  - `unlockedLevel`
  - `completedLevels`
  - `preferences.soundEnabled`
  - `preferences.themeId`
  - `customLevelOverrides` (per-slot custom maps from the editor)
- The save data has a versioned migration path (`v1` → `v2`) so older saves are upgraded without loss.

## Code Structure

```
src/
├── main.ts                         entry point — boots GameApp
├── style.css                       canvas/page styling
└── game/
    ├── GameApp.ts                  Phaser game instance bootstrap
    ├── config/
    │   ├── gameConfig.ts           Phaser config and scene registration
    │   ├── difficultyConfig.ts     per-level scaling formulas
    │   └── themeConfig.ts          color palettes
    ├── scenes/
    │   ├── BootScene.ts            initial loader
    │   ├── PreloadScene.ts         asset/loading bar
    │   ├── MainMenuScene.ts        landing menu
    │   ├── LevelSelectScene.ts     campaign slot picker
    │   ├── LevelEditorScene.ts     paint and save custom slots
    │   ├── GameScene.ts            main gameplay scene
    │   ├── PauseScene.ts           pause overlay
    │   ├── VictoryScene.ts         level-clear screen
    │   └── GameOverScene.ts        end-of-run screen
    ├── entities/
    │   ├── Paddle.ts               player paddle
    │   ├── Ball.ts                 ball with fire/axis-lock logic
    │   ├── Brick.ts                4 brick kinds
    │   ├── Projectile.ts           laser shot
    │   ├── PowerUp.ts              round pickup
    │   └── Shield.ts               one-shot barrier under the paddle
    ├── systems/
    │   ├── CollisionSystem.ts      arcade physics overlap/collide wiring
    │   ├── InputSystem.ts          pointer/touch/keyboard → paddle
    │   ├── LevelSystem.ts          campaign + custom override lookup
    │   ├── PowerUpSystem.ts        power-up registry + weighted RNG roll
    │   ├── ScoreSystem.ts          score + best score
    │   ├── ComboSystem.ts          streak + decay + multiplier
    │   ├── SaveSystem.ts           localStorage persistence + migrations
    │   ├── AudioSystem.ts          procedural Web Audio effects
    │   └── ParticleSystem.ts       lightweight particles + camera shake
    ├── ui/
    │   ├── Hud.ts                  in-game HUD (score, lives, combo, badges)
    │   ├── Button.ts               reusable Phaser button
    │   └── ProgressBar.ts          loading bar primitive
    ├── levels/
    │   ├── levelTypes.ts           shared types (BrickKind, BrickSpec, …)
    │   ├── levelFactory.ts         pattern → BrickSpec[]
    │   ├── levelPatterns.ts        6 campaign patterns + hardcoded slot 1
    │   ├── campaignLevels.ts       compiled campaign list
    │   └── editorGrid.ts           editor grid validation + overrides
    └── utils/
        ├── constants.ts            world dimensions, speeds, sizes, MAX_LIVES, …
        ├── math.ts                 clamp, paddle bounce vector, rect distance
        ├── random.ts               injectable RNG, weighted picker
        └── storage.ts              SSR-safe localStorage adapter
```

Tests sit under [tests/](../tests/) and target the pure modules (score, combo, difficulty, level factory, level system, editor grid, math, storage, power-up roll). They are wired to Vitest via [vite.config.ts](../vite.config.ts).

## Development

```
npm install         install dependencies
npm start           run the dev server (alias: npm run dev)
npm run build       type-check + production build
npm run preview     preview the production build
npm run lint        run ESLint
npm test            run Vitest unit tests
npm run format      apply Prettier formatting
```

Browser smoke tests (optional, require Chrome):

```
npm run test:browser           headless playthrough
npm run test:browser:visible   visible browser playthrough
npm run test:browser:editor    headless editor smoke test
npm run test:browser:corridor  normal paddle-launch corridor regression
npm run test:browser:powerups  per-power-up browser pickup regression
```

CI runs lint, tests, and build on every push to `main` / `develop` ([.github/workflows/ci.yml](../.github/workflows/ci.yml)). GitHub Pages deployment is automated ([.github/workflows/deploy-pages.yml](../.github/workflows/deploy-pages.yml)).
