# Changelog

All notable changes to Bounce Forge. Format based on
[Keep a Changelog](https://keepachangelog.com/), versions follow [SemVer](https://semver.org/).

## [1.2.0] — 2026-11-11

### Added

- **15 power-ups** in one registry, unlocked chapter by chapter: fire ball (burns through
  bricks), explosive ball (charges), big ball, paddle lasers, magnet, shield (saves a ball),
  slow motion, fever (×2 points) and red **risk capsules** (turbo, shrink) that trade a drawback
  for more points. Stacking with caps, opposites cancel, and **combos**: Meteor (fire +
  explosive), Sun (fire + big ball), explosive lasers.
- **Nine mechanisms**: crystal (splits the ball), key + gate, phoenix (respawns, never blocks a
  win), ghost (hidden until touched), mover (slides in its row), bumper, teleporter pairs, fuse
  (burns along its line, then explodes).
- **Level events**: power-up rain, storm (lightning), descending wall.
- HUD chips for active effects (icon, colour, time gauge, charges), first-time hints for every
  power-up and mechanism, help screen with the real brick artwork, combos and mechanisms.
- **Workshop**: mechanism palette and per-level settings (allowed power-ups, frequency, lives,
  ball speed, events), saved with the level, applied by Test, shared with `BF3:` codes.
- Balance report test and a smoke run that plays all 30 campaign levels.

### Changed

- **30-level campaign in 5 chapters**, redesigned around the new mechanics: each level
  introduces one idea before later levels combine them; chapter 5 "Mechanisms" is the mastery
  chapter. "New: …" badges and chapter introductions on the campaign screen.
- Gentler pacing: slower speed ramp, three lives everywhere, reinforced bricks keep exactly 2 or
  3 hits; fewer capsules (16–22 % of bricks) so the screen never floods.
- Save format v7 (discoveries, level settings on creative slots); older saves migrate.

## [1.1.0] — 2026-11-11

### Added

- **The Workshop**, a rebuilt creative mode: start from a **Surprise!** level (seeded symmetric
  generator), a campaign level or a blank page; drafts and saved levels with previews and
  difficulty stars.
- Full-screen **HTML level editor** drawing the game's own bricks: brush 1×1 to 3×3, eraser,
  rectangle, line, fill, picker, stamps, pixel-font text, mirror and quarter symmetry, move,
  undo/redo, zoom and pinch, keyboard shortcuts. Live difficulty estimate and warnings (no
  breakable brick, bricks sealed in steel, bricks near the paddle). Drafts autosave and
  **Test** plays the draft without overwriting the saved level.
- **Sound effects** from a single Web Audio engine: pentatonic notes rising with the combo,
  metallic hits, explosions, power-up arpeggios, life lost, level clear; stereo by position.
- **Hold to aim**: hold the click (or finger), aim with a dotted path and arrow, release to
  launch — also for the first ball.
- Juice: hit-stop, trauma screen shake, shards and sparks, score popups, combo label, slow
  motion on the last brick, bricks dropping in at level start (all respect “Reduce motion”).

### Changed

- **24 redesigned campaign levels** drawn as pixel art (anvil, heart, castle, vault, volcano,
  target, fortress…), with French names; every brick is guaranteed reachable.
- Custom deterministic ball physics on the brick grid: swept collisions (no tunnelling, one
  brick per step, no seam kicks), curved paddle bounce with spin, gentle speed ramp.
- “Forge lumineuse” visuals: bevelled bricks with symbols and crack stages, glowing ball with a
  light trail, metal walls, embers, danger glow; reinforced bricks are now pink (×2) and purple (×3).
- Falling power-ups no longer overlap; the AIM (sticky) power-up is rare and only drops with
  three balls or fewer.

### Removed

- The canvas creative editor (kept only for the local admin tool).

## [1.0.0] — 2026-11-11

### Added

- New HTML interface on top of the game: home screen with a live attract-mode preview,
  **Play / Resume** button, campaign grid with level thumbnails and medals, modes, creations,
  help and settings screens, side HUD on desktop and compact HUD on mobile.
- **Endless** mode (endless waves, three lives, capped difficulty, local records).
- **Daily challenge** (three waves seeded from the UTC date, unlimited attempts, best result kept).
- French and English translations (French by default, follows the browser language).
- Pause on Esc/P, on the pause button, and automatically when the tab is hidden.
- “Reduce motion” setting, fullscreen toggle, visible keyboard focus, 44 px touch targets.
- Creations screen: thumbnails, duplicate, delete, share to clipboard, import with clear errors.
- `BF2:` share codes in UTF-8 (accents and emoji); `BF1:` codes still import.
- Portable browser smoke test (`npm run test:smoke`) and media capture script.
- MIT license, English README, credits, contribution guide, issue forms, PR template.

### Changed

- Phaser is now loaded on demand: the first page weighs ~30 kB gzipped instead of ~390 kB.
- Forge black-and-amber identity across the interface, playfield, bricks and paddle; each brick
  kind has its own outline.
- Save format v6 (adds language, reduced motion, tutorial flag and per-mode records). Saves v1 to
  v5 migrate automatically. A single shared save instance avoids concurrent overwrites, and an
  in-memory fallback keeps the game playable when storage is blocked.
- Official layouts edited with the local admin tool (levels 1, 4 and 24) are now embedded in the
  public build.
- Paddle smoothing is frame-rate independent.
- One CI pipeline on Node 24: install → lint → tests → build → browser tests → deploy the same
  validated artifact to GitHub Pages.

### Removed

- Canvas-drawn menus (main menu, level select, options, guide, pause, victory, game over),
  replaced by the HTML interface.
- Admin entry points and `/api` calls from the public build (still available with `npm run dev`).
- The nightly browser-diagnostics schedule (now manual).

### Fixed

- `BallManager.getActiveBalls()` no longer throws when a stale reference outlives a destroyed
  physics group (nightly wall diagnostic failure).
- Arrow keys and Space no longer get swallowed by the game while the interface has focus.
