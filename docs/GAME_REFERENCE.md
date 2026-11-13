# Game Reference

Single-file reference for **Bounce Forge**: rules, controls, campaign structure, persistence, admin overrides, and code layout.

## Pitch

Bounce Forge is a browser brick breaker built with Phaser 4.1.0, TypeScript, and Vite. It uses procedural visuals and sound, a forge-yellow visual direction, campaign levels built for multi-ball escalation, and a local creative editor that is separate from the official campaign.

## Core Gameplay Loop

1. Launch the attached ball from the paddle.
2. Break all destructible bricks while keeping at least one ball in play.
3. Catch falling power-ups to multiply balls, widen the paddle, or gain lives.
4. Losing every active ball costs one life.
5. Clearing a campaign level awards a medal and unlocks the next level.

## Controls

- **Mouse / touch**: move the paddle.
- **Arrow keys** or **A / D**: move the paddle.
- **Space / Enter / left click / tap**: launch an attached ball.
- **P** or **Esc**: pause.
- **R**: restart the current level.

## Bricks

Campaign patterns and editor rows use a 36x58 grid with these symbols:

| Symbol | Kind           | Behavior                                                     |
| ------ | -------------- | ------------------------------------------------------------ |
| `.`    | Empty          | No brick.                                                    |
| `1`    | Standard       | One-hit score brick.                                         |
| `2`    | Resistant      | Two-hit score brick before difficulty health bonuses.        |
| `3`    | Resistant      | Three-hit score brick before difficulty health bonuses.      |
| `E`    | Explosive      | Breaks nearby destructible bricks with limited chain depth.  |
| `B`    | Bonus          | Always drops a ball bonus, either `x2` or `x3`.              |
| `S`    | Shield brick   | Durable score brick used as a stronger obstacle.             |
| `X`    | Indestructible | Wall brick; blocks balls and never counts toward completion. |

Placed wall bricks use custom collision recovery so corridor and wall-junction bounces behave close to native playfield walls.

## Power-Ups

Definitions live in [src/game/systems/PowerUpSystem.ts](../src/game/systems/PowerUpSystem.ts). Every destructible brick has a `powerUpChance`; `B` bricks force a ball bonus.

| Type           | Label | Effect                                             | Duration | Weight |
| -------------- | ----- | -------------------------------------------------- | -------- | ------ |
| `multiBall`    | `x3`  | Adds two clones from the source ball.              | Instant  | 6.5    |
| `splitBall`    | `x2`  | Adds one clone from the source ball.               | Instant  | 4      |
| `widePaddle`   | `W`   | Paddle width scale x1.38.                          | 11000 ms | 0.45   |
| `stickyPaddle` | `AIM` | Catches the next paddle hit for an aimed relaunch. | 9000 ms  | 0.55   |
| `extraLife`    | `+1`  | Adds one life, capped at `MAX_LIVES = 5`.          | Instant  | 0.8    |

Power-ups fall at `POWER_UP_DROP_SPEED = 320`. Active balls start with a soft limit of `INITIAL_ACTIVE_BALL_LIMIT = 40`, grow by stable performance steps, and stop at `MAX_ACTIVE_BALLS = 96`. Ball bonus clones that cannot spawn at the current limit are queued and resume once active balls drop. Both balls and power-ups are pooled through `Phaser.Physics.Arcade.Group` with `classType` and `maxSize` so cloning a powered-up source ball never allocates a new GameObject in the hot path.

## Scoring, Combo, And Medals

Scoring lives in [src/game/systems/ScoreSystem.ts](../src/game/systems/ScoreSystem.ts):

```text
awarded = round(baseScore * difficultyMultiplier * comboMultiplier)
```

Combo lives in [src/game/systems/ComboSystem.ts](../src/game/systems/ComboSystem.ts):

- Each brick break increments the streak and resets the timer to `COMBO_TIMEOUT_MS = 2200`.
- The multiplier is capped after 13 streak steps.
- Victory adds a life bonus through `ScoreSystem.addLifeBonus`.

Medals are saved per campaign level:

- **Bronze**: clear the level.
- **Silver**: clear with at least the level's `silverLives` target.
- **Gold**: hit the level's target score or target best combo.

## Campaign

The campaign is generated from [src/game/levels/levelPatterns.ts](../src/game/levels/levelPatterns.ts) and compiled through [src/game/levels/campaignLevels.ts](../src/game/levels/campaignLevels.ts).

- 30 fixed campaign levels drawn as pixel art (one character = 2×2 cells).
- 5 chapters: Forge Basics, Wall Mazes, Chain Reactor, Ball Storm, Mechanisms.
- Each level defines a name, objective, medal targets, and a 36x58 grid.
- Objectives track reaching a ball count, triggering explosions, clearing with enough lives, or hitting a best-combo target.
- Admin campaign overrides can replace a level's rows and display name, but keep the original level id, chapter, objective, and medal targets.

Difficulty is derived from the zero-based level index in [src/game/config/difficultyConfig.ts](../src/game/config/difficultyConfig.ts):

- `ballSpeed`: starts at 540 and increases by 34 per level.
- `maxBallSpeed`: starts at 960 and increases by 18 per level.
- `brickHealthBonus`: `floor(levelIndex / 4)` for resistant, explosive, and shield bricks.
- `powerUpDropChance`: rises from 0.35 toward 0.48.
- `scoreMultiplier`: `1 + levelIndex * 0.08`.
- `initialLives`: starts at 3 and bottoms out at 2.

## Pause And Settings

Pause opens with Esc, P, the pause button of the HUD, or automatically when the tab is hidden. The pause dialog offers `Reprendre/Resume`, `Recommencer/Restart`, a sound switch and `Quitter/Quit`; Esc resumes.

The Settings screen (`#/settings`) exposes language (FR/EN), sound on/off, SFX volume, FX quality (`low`, `med`, `high`), reduced motion, fullscreen when the browser supports it, and a confirmed progress reset. Values live in the v6 save schema and apply live through `GameController.setSound` or on the next scene start.

## Visual Effects And Performance

`FxManager` centralizes camera and quality control:

- Camera shake on paddle bounces, brick breaks, and life loss with a 50 ms dedup window so chained explosions do not stack.
- Camera flash on explosive brick chains and on victory.
- Camera fade on victory and game over.
- A combo zoom helper that always tweens from a fixed base zoom to avoid runaway accumulation when many bonuses arrive in quick succession.
- A `tickPerformance(deltaMs)` loop that downgrades `fxQuality` when frames stay above 22 ms for 3 s and restores it after 5 s under 17 ms.

`AudioSystem` plays short procedural Web Audio tones, throttled and detuned on rapid hits to keep the forge feel without saturating the speakers, and respects `volumeSfx` and the master sound toggle.

`ParticleSystem` runs three reusable Phaser native ParticleEmitters (hit, break, explosion) on procedurally generated textures (`forge-spark`, `forge-ember`, `forge-shard`) created in `BootScene`. Tinting is applied per burst.

PostFX (Bloom, Glow, Shine, Blur trail) are wired into `FxManager.applyEntityFx` but the call site is currently a no-op: stacking postFX across 40 to 96 ball-shape primitives saturated the GPU on every tested machine. The forge identity is delivered via theme color, particle tints, and camera effects instead.

## Creative And Admin Modes

Creative mode is local-only:

- Accessible from `MODE CREATIF`.
- Saves 36x58 editor rows to browser localStorage under `creativeLevelSlots`.
- Has 30 slots aligned with campaign slot numbers.
- `PLAY` runs the selected creative slot with source `creative`.
- Creative saves never replace campaign levels.

Admin mode is server-backed:

- Accessible from the `ADMIN` button on the main menu.
- Login posts to `/api/admin/login` and requires `ADMIN_PASSWORD` on the server.
- Admin editor saves campaign overrides with `PUT /api/admin/campaign-levels/:levelIndex`.
- Overrides persist in `data/campaign-level-overrides.json` by default.
- Level select and campaign play use committed campaign data plus any loaded admin overrides.

## Persistence

Local browser save data is centralized in [src/game/systems/SaveSystem.ts](../src/game/systems/SaveSystem.ts).

- Storage key: `bounce-forge.save.v1`.
- Current save version: **5**.
- Persisted fields:
  - `bestScore`
  - `unlockedLevel`
  - `completedLevels`
  - `levelMedals`
  - `preferences.soundEnabled`
  - `preferences.themeId`
  - `preferences.volumeSfx` (0 to 1, default 0.7)
  - `preferences.volumeMusic` (0 to 1, default 0.5)
  - `preferences.fxQuality` (`'low' | 'med' | 'high'`, default `'med'`)
  - `preferences.fullscreen` (default false)
  - `creativeLevelSlots`

Older save shapes are migrated automatically. v1, v2, v3, and v4 saves are upgraded to v5 in place: medals, unlocked level, creative slots, theme, and sound choice are preserved; new preference fields fall back to their defaults. Legacy `customLevelOverrides` are still folded into `creativeLevelSlots`.

Server campaign override data is separate from localStorage and is managed by [server/campaignOverrideStore.mjs](../server/campaignOverrideStore.mjs).

## Development

```bash
npm install
npm start
npm run lint
npm run test
npm run build
npm run format:check
```

`npm start` runs Vite on `http://localhost:5173` and the admin API on `http://localhost:8787`. Vite proxies `/api` to the admin API.

The Phaser runtime targets Phaser 4.1.0. The renderer is `Phaser.AUTO` so WebGL is preferred and Canvas is the fallback. The project does not register custom render nodes, custom shaders, or mandatory external art assets; visual effects remain procedural and gameplay readability takes priority over post-processing.

For admin login in dev:

```powershell
Copy-Item .env.example .env
# edit .env with ADMIN_PASSWORD=your-password
npm start
```

Browser journey (headless Edge or Chrome, the same one CI runs in five parallel parts):

```bash
npm run test:smoke
SMOKE_SHARD=gameplay npm run test:smoke   # layout, ui, levels-a, levels-b or gameplay
npm run test:smoke -- --url=https://matteo12sa.github.io/bounce-forge/
```

## Code Layout

```text
src/game/config        Phaser config, difficulty, themes
src/game/entities      Paddle, ball, brick, power-up objects with pool reset/disable
src/game/levels        Campaign patterns, editor grid, level factory, shared types
src/game/managers      PlayfieldRenderer and other extracted GameScene managers
src/game/scenes        Boot, preload, GameScene (all modes), level editor, local admin screens
src/game/modes         Endless and daily wave generator
src/ui                 HTML interface: routing, menus, HUD, dialogs, i18n, thumbnails
src/game/systems       Save, settings, FX, levels, admin API, overrides, collisions, score, combo, input, audio, particles
src/game/ui            HUD, buttons, progress bar, screen chrome
src/game/utils         Constants, math, RNG, storage adapter
server                 Admin API, auth, override persistence
scripts                Dev launcher and browser diagnostics
tests                  Vitest coverage for pure logic, settings, FX manager, and server helpers
```

CI runs lint, format check, unit tests, build and the browser smoke test on every branch and pull request. Pushing to `main` runs the same chain and deploys that exact build to GitHub Pages (public repositories only).
