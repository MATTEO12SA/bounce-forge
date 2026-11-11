# Architecture

Bounce Forge separates the HTML interface, the Phaser runtime, pure gameplay logic, local save state, and the small Node admin API used to publish official campaign overrides.

## Interface Layer (`src/ui`)

- `src/main.ts` mounts `App` (`src/ui/app.ts`) into `#app`. The interface is plain TypeScript + DOM (no framework) and owns navigation, menus, the HUD, pause and result dialogs.
- Navigation uses URL fragments so it works on GitHub Pages without server rewrites: `#/`, `#/campaign[/chapter]`, `#/modes`, `#/create`, `#/create/edit/<slot>`, `#/help`, `#/settings`, `#/play/campaign/<n>`, `#/play/creative/<n>`, `#/play/endless`, `#/play/daily` (and `#/admin` in dev builds).
- `ui/engine.ts` lazy-loads `game/GameApp` (and Phaser) with `import()`, reports coarse progress, and lets the player retry after a network error. The interface starts warming the engine on idle so the home preview comes alive.
- `ui/i18n.ts` holds the French and English catalogs; `ui/preview.ts` draws level thumbnails on a 2D canvas without Phaser.
- The single `<div class="stage">` that hosts the Phaser canvas is moved between slots (home preview card, play area, full-screen tools). A `ResizeObserver` calls `GameController.refreshLayout()` so Phaser re-fits.

## Interface ↔ Engine Contract (`src/game/bridge.ts`)

- `GameSession` describes what to play: `mode` (`campaign`, `creative`, `endless`, `daily`, `demo`), level index, wave, run seed, frozen UTC `dateKey`, carried score and lives.
- `GameController` (implemented by `GameApp`) exposes `start`, `pause`, `resume`, `restart`, `quit`, `openEditor`, `openAdmin`, `setSound`, `refreshLayout`.
- The engine emits typed events on `bridge`: `ready`, `hud` (10 Hz), `result`, `pauseRequested`, `waveCleared`, `exitToShell`, `toolOpened`.
- `bridge.ts` never imports Phaser, so the interface can depend on it before the engine is downloaded.

## Runtime Layer

- `game/GameApp.ts` creates the Phaser game and implements `GameController`. It auto-requests a pause when the tab is hidden.
- `game/config/gameConfig.ts` owns Phaser scale, physics, renderer settings, multi-touch input, and scene registration. The renderer type is `Phaser.AUTO` so the engine can fall back to Canvas if WebGL is unavailable. Admin scenes are registered only when `ADMIN_ENABLED` (dev build or `VITE_ENABLE_ADMIN=1`).
- `game/scenes/*`: `BootScene` and `PreloadScene` (procedural textures, then `ready`), `GameScene` (every mode, including the attract-mode `demo` with its autopilot), `LevelEditorScene`, and the local admin screens.
- `game/modes/waveGenerator.ts` builds endless and daily waves from the validated campaign layouts (seeded pick + mirroring), with the difficulty tier capped at the last campaign level.
- `game/entities/*` wraps Phaser game objects for paddle, ball, bricks, and falling power-ups. Balls and power-ups expose `reset(...)` and `disable()` so they can be recycled by Phaser Groups instead of being destroyed.
- `game/managers/*` holds focused managers extracted from the main scene. `PlayfieldRenderer` owns the procedural background, side rails, and playfield border.
- `game/ui/*` contains reusable Phaser UI primitives (Button, Dialog, Slider, ToggleSwitch, SegmentedControl, ScrollPanel, TabBar, Tooltip, IconButton) plus a shared `roundedShapes.RoundedRect` helper. Visual scale is centralized in `game/config/designTokens.ts` (spacing, radius, shadow, typography). `Button` accepts an optional `theme` so its variant colors can derive from `themeConfig`.
- Phaser runs on the stable Phaser 4.1.0 release. Bounce Forge does not register custom render nodes, pipelines, shaders, or mandatory external assets in the migration baseline.

## Gameplay Systems

- `CollisionSystem` registers Arcade Physics collision and overlap callbacks.
- `InputSystem` maps pointer, touch, and keyboard input into paddle movement.
- `LevelSystem` resolves campaign levels, creative slots, and server-backed admin overrides.
- `CampaignOverrideSystem` keeps the fetched admin campaign overrides in memory and falls back to the committed campaign pattern if an override is invalid or unavailable.
- `AdminApiSystem` wraps `/api/admin/*` requests for login, session checks, override listing, and override saves.
- `PowerUpSystem` selects drops through injected RNG. Current power-ups are `multiBall`, `splitBall`, `widePaddle`, `stickyPaddle`, and `extraLife`.
- `ScoreSystem` and `ComboSystem` are pure and unit-tested.
- `SaveSystem` isolates localStorage access, migrates older saves (v1 through v5 are upgraded to v6 in place), and stores progress, medals, preferences (language, reduced motion…), the tutorial flag, per-mode records and local creative slots. `getSharedSaveSystem()` returns the single instance shared by the interface, the scenes and the editor; it falls back to in-memory storage when the browser blocks localStorage.
- `SettingsSystem` is a thin facade over `SaveSystem.preferences` that exposes effective volumes, FX quality, fullscreen state, and applies fullscreen requests to the Phaser ScaleManager.
- `FxManager` centralizes camera shake, flash, fade, combo zoom, and FPS auto-degrade. It also offers an `applyEntityFx` hook for future per-object postFX, currently a no-op so shape primitives stay cheap.
- `AudioSystem` generates short procedural Web Audio effects after user input. It respects the per-session volume from `SettingsSystem` and detunes rapid consecutive hits to avoid forge fatigue.
- `audioRegistry` is a tiny pub/sub helper kept for in-canvas tools; the interface changes sound live through `GameController.setSound`.
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

- Campaign source of truth is the committed 24-level campaign in `levelPatterns.ts`, overlaid at build time by the committed `data/campaign-level-overrides.json`, and at runtime (dev only) by the admin server.
- Creative mode is local-only and stored under `creativeLevelSlots` in `bounce-forge.save.v1`.
- Admin saves are global for the running deployment and never rely on browser localStorage.
- The public build never calls `/api`; the smoke test asserts it.

## Performance Strategy

- Balls and power-ups are pooled through `Phaser.Physics.Arcade.Group` with `classType` and `maxSize` (96 for balls, 32 for power-ups). Out-of-play instances call `disable()` and are returned to the pool instead of being destroyed and reallocated.
- Particles use Phaser's native `add.particles` with three reusable emitters tinted per burst, so 96 simultaneous balls breaking bricks do not allocate new game objects.
- `FxManager.tickPerformance` samples frame deltas and degrades `fxQuality` when frames stay above 22 ms for 3 s, then restores the original quality after 5 s of frames under 17 ms.
- The gameplay hot path (ball update, collision callbacks, brick damage) is free of `console.warn` / `console.error` / `console.info` calls. Source-mapped stack traces in dev otherwise inflate frame time when warnings repeat across many balls.
- The committed `applyEntityFx` is a no-op because stacking Bloom or Glow postFX on dozens of shape primitives reliably saturated the GPU. Visual identity instead comes from theme colors, tinted particles, and camera shake/flash/fade.
