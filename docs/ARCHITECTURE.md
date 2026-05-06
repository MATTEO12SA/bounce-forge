# Architecture

Bounce Forge separates Phaser runtime code, pure gameplay logic, local save state, and the small Node admin API used to publish official campaign overrides.

## Runtime Layer

- `src/main.ts` starts `GameApp`.
- `game/config/gameConfig.ts` owns Phaser scale, physics, renderer settings, multi-touch input, and scene registration. The renderer type is `Phaser.AUTO` so the engine can fall back to Canvas if WebGL is unavailable.
- `game/scenes/*` owns scene lifecycle and routing for boot, preload, menu, level select, gameplay, pause, victory, game over, options, creative editor, and admin screens.
- `game/entities/*` wraps Phaser game objects for paddle, ball, bricks, and falling power-ups. Balls and power-ups expose `reset(...)` and `disable()` so they can be recycled by Phaser Groups instead of being destroyed.
- `game/managers/*` holds focused managers extracted from the main scene. `PlayfieldRenderer` owns the procedural background, side rails, and playfield border.
- `game/ui/*` contains reusable Phaser UI primitives.
- Phaser runs on the stable Phaser 4.1.0 release. Bounce Forge does not register custom render nodes, pipelines, shaders, or mandatory external assets in the migration baseline.

## Gameplay Systems

- `CollisionSystem` registers Arcade Physics collision and overlap callbacks.
- `InputSystem` maps pointer, touch, and keyboard input into paddle movement.
- `LevelSystem` resolves campaign levels, creative slots, and server-backed admin overrides.
- `CampaignOverrideSystem` keeps the fetched admin campaign overrides in memory and falls back to the committed campaign pattern if an override is invalid or unavailable.
- `AdminApiSystem` wraps `/api/admin/*` requests for login, session checks, override listing, and override saves.
- `PowerUpSystem` selects drops through injected RNG. Current power-ups are `multiBall`, `splitBall`, `widePaddle`, `stickyPaddle`, and `extraLife`.
- `ScoreSystem` and `ComboSystem` are pure and unit-tested.
- `SaveSystem` isolates localStorage access, migrates older saves (v1 through v4 are upgraded to v5 in place), and stores progress, medals, preferences, and local creative slots.
- `SettingsSystem` is a thin facade over `SaveSystem.preferences` that exposes effective volumes, FX quality, fullscreen state, and applies fullscreen requests to the Phaser ScaleManager.
- `FxManager` centralizes camera shake, flash, fade, combo zoom, and FPS auto-degrade. It also offers an `applyEntityFx` hook for future per-object postFX, currently a no-op so shape primitives stay cheap.
- `AudioSystem` generates short procedural Web Audio effects after user input. It respects the per-session volume from `SettingsSystem` and detunes rapid consecutive hits to avoid forge fatigue.
- `ParticleSystem` exposes three reusable Phaser native ParticleEmitters (hit, break, explosion) over procedural textures generated in `BootScene`. Burst counts are scaled by `FxManager` quality.

## Managers

- `PlayfieldRenderer` builds the static background, gradients, side rails, and playfield border in a single Phaser Graphics pass at scene create.
- Future ball, brick, and power-up managers can extract the remaining state-heavy code from `GameScene` without changing existing tests.

## Server Layer

- `server/index.mjs` serves the built app and the admin API. In dev it can run API-only next to Vite.
- `server/adminAuth.mjs` validates the configured `ADMIN_PASSWORD` and manages the admin session cookie.
- `server/campaignOverrideStore.mjs` validates and persists campaign overrides to `data/campaign-level-overrides.json` by default.
- `scripts/start-dev.mjs` starts both the API server on `API_PORT` or `8787` and Vite on `PORT` or `5173`.

## Pure Logic

The following modules are intentionally independent from Phaser:

- `levels/levelFactory.ts`
- `levels/levelPatterns.ts`
- `levels/editorGrid.ts`
- `config/difficultyConfig.ts`
- `systems/ScoreSystem.ts`
- `systems/ComboSystem.ts`
- `systems/PowerUpSystem.ts`
- `systems/SaveSystem.ts`
- `systems/SettingsSystem.ts`
- `utils/math.ts`
- `utils/random.ts`
- `utils/storage.ts`

This keeps score, combo, level generation, difficulty, storage, settings, and RNG behavior testable in Vitest without a browser canvas.

## State Boundaries

- Campaign source of truth is the committed 24-level campaign in `levelPatterns.ts`, optionally overlaid by server admin data.
- Creative mode is local-only and stored under `creativeLevelSlots` in `bounce-forge.save.v1`.
- Admin saves are global for the running deployment and never rely on browser localStorage.
- If the admin API is unavailable, the game still runs with the committed campaign and local creative slots.

## Performance Strategy

- Balls and power-ups are pooled through `Phaser.Physics.Arcade.Group` with `classType` and `maxSize` (96 for balls, 32 for power-ups). Out-of-play instances call `disable()` and are returned to the pool instead of being destroyed and reallocated.
- Particles use Phaser's native `add.particles` with three reusable emitters tinted per burst, so 96 simultaneous balls breaking bricks do not allocate new game objects.
- `FxManager.tickPerformance` samples frame deltas and degrades `fxQuality` when frames stay above 22 ms for 3 s, then restores the original quality after 5 s of frames under 17 ms.
- The gameplay hot path (ball update, collision callbacks, brick damage) is free of `console.warn` / `console.error` / `console.info` calls. Source-mapped stack traces in dev otherwise inflate frame time when warnings repeat across many balls.
- The committed `applyEntityFx` is a no-op because stacking Bloom or Glow postFX on dozens of shape primitives reliably saturated the GPU. Visual identity instead comes from theme colors, tinted particles, and camera shake/flash/fade.
