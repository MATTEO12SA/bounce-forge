# Architecture

Bounce Forge separates Phaser runtime code, pure gameplay logic, local save state, and the small Node admin API used to publish official campaign overrides.

## Runtime Layer

- `src/main.ts` starts `GameApp`.
- `game/config/gameConfig.ts` owns Phaser scale, physics, and scene registration.
- `game/scenes/*` owns scene lifecycle and routing for boot, preload, menu, level select, gameplay, pause, victory, game over, creative editor, and admin screens.
- `game/entities/*` wraps Phaser game objects for paddle, ball, bricks, and falling power-ups.
- `game/ui/*` contains reusable Phaser UI primitives.

## Gameplay Systems

- `CollisionSystem` registers Arcade Physics collision and overlap callbacks.
- `InputSystem` maps pointer, touch, and keyboard input into paddle movement.
- `LevelSystem` resolves campaign levels, creative slots, and server-backed admin overrides.
- `CampaignOverrideSystem` keeps the fetched admin campaign overrides in memory and falls back to the committed campaign pattern if an override is invalid or unavailable.
- `AdminApiSystem` wraps `/api/admin/*` requests for login, session checks, override listing, and override saves.
- `PowerUpSystem` selects drops through injected RNG. Current power-ups are `multiBall`, `splitBall`, `widePaddle`, `stickyPaddle`, and `extraLife`.
- `ScoreSystem` and `ComboSystem` are pure and unit-tested.
- `SaveSystem` isolates localStorage access, migrates older saves, and stores progress, medals, preferences, and local creative slots.
- `AudioSystem` generates short procedural Web Audio effects after user input.
- `ParticleSystem` creates lightweight generated particles and camera shake.

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
- `utils/math.ts`
- `utils/random.ts`
- `utils/storage.ts`

This keeps score, combo, level generation, difficulty, storage, and RNG behavior testable in Vitest without a browser canvas.

## State Boundaries

- Campaign source of truth is the committed 24-level campaign in `levelPatterns.ts`, optionally overlaid by server admin data.
- Creative mode is local-only and stored under `creativeLevelSlots` in `bounce-forge.save.v1`.
- Admin saves are global for the running deployment and never rely on browser localStorage.
- If the admin API is unavailable, the game still runs with the committed campaign and local creative slots.
