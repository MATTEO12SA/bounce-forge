# Contributing to Bounce Forge

Merci de votre intérêt ! / Thanks for your interest! Issues and pull requests may be written in
French or English.

## Ways to help

- **Report a bug** with the [bug form](https://github.com/MATTEO12SA/bounce-forge/issues/new?template=bug_report.yml):
  browser, device, steps and, ideally, a screenshot.
- **Suggest an idea** with the [feature form](https://github.com/MATTEO12SA/bounce-forge/issues/new?template=feature_request.yml).
- **Share a level**: build it in the in-game editor, press _Share_ and paste the `BF2:` code in a
  [level submission](https://github.com/MATTEO12SA/bounce-forge/issues/new?template=level_submission.yml).

## Development

```bash
npm ci
npm run dev        # game + local admin server
npm run dev:vite   # game only
```

Use short-lived branches from `main` (`feat/…`, `fix/…`, `docs/…`, `test/…`) and conventional
commit messages, for example `feat: add endless mode records`.

### Before opening a pull request

```bash
npm run lint
npm test
npm run build
npm run test:smoke   # real browser journey on the production build
npm run format:check
```

`test:smoke` needs Chrome, Chromium or Edge. Set `BROWSER_PATH` if it is installed somewhere
unusual. Screenshots of every step land in `artifacts/smoke/`.

### Where things live

- `src/ui/` — HTML interface. Text goes through `src/ui/i18n.ts`: add every new string in **both**
  French and English.
- `src/game/bridge.ts` — the only contract between the interface and the engine. Keep it free of
  Phaser imports.
- `src/game/` — Phaser scenes, entities and systems. Keep pure logic (scoring, saves, level
  generation, sharing) in modules that can be tested without Phaser.
- `src/game/levels/levelPatterns.ts` and `data/campaign-level-overrides.json` — official campaign
  content. The JSON file is written by the local admin tool and embedded in the public build.

### Saves

The save format is versioned (`SaveSystem.ts`). Never break old saves: bump the version, write a
migration, and add a test in `tests/` that loads the previous format.

### Media

After a visible change, refresh the README media with:

```bash
npm run build
node scripts/capture-media.mjs
```

## Admin tools

The campaign editor (`npm run dev`, then Settings → Admin) needs `ADMIN_PASSWORD` in a local
`.env` file (template: `.env.example`). It is never shipped in the public build. Never commit
`.env`.

## Code of conduct

Be kind, assume good faith, keep feedback about the work.
