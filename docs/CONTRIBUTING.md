# Contributing

## Workflow

Use short-lived feature branches from `develop`:

- `feat/project-setup`
- `feat/core-game-loop`
- `feat/level-system`
- `feat/powerups`
- `feat/ui-menus`
- `feat/polish-effects`
- `feat/tests-ci`
- `feat/github-pages-deploy`

Keep commits atomic and use conventional messages, for example:

- `feat: add level pattern system`
- `test: cover power up selection`
- `ci: add github pages deployment`

## Quality Bar

Before opening a pull request:

```bash
npm run lint
npm run test
npm run build
npm run format:check
```

Keep Phaser lifecycle code in scenes/entities/systems and pure logic in modules that can be tested without Phaser.
