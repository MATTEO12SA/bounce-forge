# Contributing

## Workflow

Use short-lived feature branches from `main`:

- `feat/admin-editor`
- `fix/wall-corridor-bounce`
- `docs/game-reference`
- `test/campaign-diagnostic`

Keep commits atomic and use conventional messages, for example:

- `feat: add campaign override editor`
- `fix: preserve source ball when cloning pickups`
- `docs: update game reference`
- `test: cover campaign override storage`

## Quality Bar

Before opening a pull request:

```bash
npm run lint
npm run test
npm run build
npm run format:check
```

Keep Phaser lifecycle code in scenes/entities/systems and pure logic in modules that can be tested without Phaser.

For browser-facing or editor changes, also run the relevant diagnostic script:

```bash
npm run test:browser:campaign
npm run test:browser:admin
npm run test:browser:ui
```

Use the focused diagnostic that matches the change instead of running every browser script by default.

## Admin And Campaign Data

- Do not commit local `.env` files.
- Use `.env.example` as the template for `ADMIN_PASSWORD`.
- Creative editor slots are local browser state and should not be treated as campaign content.
- Official campaign changes should go through admin overrides or committed changes to `src/game/levels/levelPatterns.ts`.
- `data/campaign-level-overrides.json` is the default server persistence file for admin saves.

## CI And Deploy

CI runs lint, tests, and build for pushes and pull requests targeting `main` or `develop`.

The GitHub Pages workflow only deploys public repositories. Private repositories skip the deploy jobs by design.
