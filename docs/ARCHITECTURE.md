# Architecture

Bounce Forge separates Phaser runtime code from pure gameplay logic.

## Runtime Layer

- `src/main.ts` starts `GameApp`.
- `game/config/gameConfig.ts` owns Phaser scale, physics, and scene registration.
- `game/scenes/*` owns scene lifecycle and routing.
- `game/entities/*` wraps Phaser game objects for paddle, ball, bricks, power-ups, projectiles, and the shield.
- `game/ui/*` contains reusable Phaser UI primitives.

## Gameplay Systems

- `CollisionSystem` registers Arcade Physics collision and overlap callbacks.
- `InputSystem` maps pointer, touch, and keyboard input into paddle movement.
- `LevelSystem` provides campaign level lookup.
- `PowerUpSystem` selects power-up drops through injected RNG.
- `ScoreSystem` and `ComboSystem` are pure and unit-tested.
- `SaveSystem` isolates localStorage access and uses a storage adapter for tests.
- `AudioSystem` generates short procedural Web Audio effects after user input.
- `ParticleSystem` creates lightweight generated particles and camera shake.

## Pure Logic

The following modules are intentionally independent from Phaser:

- `levels/levelFactory.ts`
- `levels/levelPatterns.ts`
- `config/difficultyConfig.ts`
- `systems/ScoreSystem.ts`
- `systems/ComboSystem.ts`
- `systems/PowerUpSystem.ts`
- `systems/SaveSystem.ts`
- `utils/math.ts`
- `utils/random.ts`
- `utils/storage.ts`

This keeps score, combo, level generation, difficulty, storage, and RNG behavior testable in Vitest without a browser canvas.
