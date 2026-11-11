# UI Inspiration References

The local `vendor/references/` folder is intentionally ignored by Git. It is a scratch/reference area for UI, graphics, and Phaser implementation ideas, not runtime code.

## Cloned References

- `phaser-pixui`: Phaser 4 TypeScript UI patterns, responsive components, buttons, progress bars, and text areas. Code license: MIT.
- `phaser-rex-notes`: Rex Phaser notes and plugins for mature UI ideas such as sliders, scroll panels, dialogs, tabs, and sizers. Check the specific package license before copying code.
- `phaser-examples`: Phaser 4 examples for particles, tweens, effects, input, and scene patterns. Source code is MIT; assets are not generally reusable in commercial/ad-supported games.
- `kenney-icon-font`: browser game icon font and icon references from Kenney. License: CC0-1.0.
- `tabler-icons`: clean SVG UI icons. License: MIT.

## Project Rules

- Do not import runtime code directly from `vendor/`.
- Copy only small, license-compatible assets or patterns into tracked project folders.
- Keep copied assets documented and prefer local wrappers over adopting a large UI dependency.
- Use `fxQuality` to gate heavier visual effects so low-end browsers remain stable.

## Web Presentation (v1.0)

- [Inspora](https://www.inspora.design/): visuals first, generous whitespace, pill-shaped filters, a grid of large rounded cards, one strong call to action. Applied to the home screen, the campaign grid (chapter pills + thumbnail cards) and the modes cards, in a dark forge palette (charcoal, amber, off-white).
- [Gameplay in Breakout](https://jakesgordon.com/writing/gameplay-in-breakout/): pacing and capped acceleration; endless waves stop ramping at the last campaign tier.
- [gabrielecirulli/2048](https://github.com/gabrielecirulli/2048): a README that leads with a play link and a short animation.
