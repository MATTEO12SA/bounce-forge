# Game Design

## Core Loop

The player clears breakable bricks by keeping one or more balls in play. Each cleared campaign level unlocks the next one, awards a medal, and preserves the best score. Losing all active balls costs a life; losing all lives ends the run.

## Feel

- Paddle impact changes the outgoing ball angle based on where the ball hits the paddle.
- Ball speed is clamped between minimum and maximum values.
- Near-horizontal and near-vertical loops are corrected by axis-lock prevention.
- Brick breaks spawn generated particles and small camera shake.
- Explosive bricks damage nearby breakable bricks.
- Placed wall bricks use custom bounce recovery so narrow corridors behave like native playfield walls instead of trapping the ball.

## Bricks

- Standard `1`: one hit, baseline score.
- Resistant `2` / `3`: multiple hits, higher score, and later campaign levels add health bonuses.
- Explosive `E`: one hit, damages nearby breakable bricks with limited chain depth.
- Bonus `B`: one hit and always drops either `x2` or `x3`.
- Shield `S`: tougher score brick used as a durable obstacle, not a player shield pickup.
- Wall `X`: indestructible, blocks balls, and does not count toward level completion.

## Power-Ups

- `x3` multi-ball: adds two clones from the source ball.
- `x2` split-ball: adds one clone from the source ball.
- `W` wide paddle: temporarily increases paddle width.
- `AIM` sticky paddle: temporarily catches a paddle hit for an aimed relaunch.
- `+1` extra life: grants one life, capped at 5.

Power-ups are round pickups that fall from broken bricks. The drop chance scales with the campaign level and ball bonuses are intentionally dominant. The active-ball limiter starts at 40, grows while frame time is stable, and stops at 96. If `x2` or `x3` is collected at the limit, missing clones are queued instead of discarded.

## Progression

The campaign contains 24 fixed levels across four chapters:

- Forge Basics
- Wall Mazes
- Chain Reactor
- Ball Storm

Difficulty is derived from the campaign level index:

- Ball speed increases gradually.
- Maximum ball speed increases gradually.
- Resistant bricks gain health after later levels.
- Power-up drop chance rises from 35% toward 48%.
- Score multiplier increases per level.
- Starting lives drop gradually but never below 2.

Each campaign level has an objective shown in the HUD. Objectives currently track reaching a target number of balls, triggering explosions, clearing with lives remaining, or reaching a best-combo target.

## Medals

- Bronze: clear the level.
- Silver: clear with at least the level's `silverLives` target.
- Gold: hit either the level's target score or target best combo.

Medals are optional progression markers and do not block unlocks.

## Modes

Implemented now:

- Campaign mode.
- Creative mode: local-only 36x58 editor slots saved in browser storage.
- Admin mode: password-protected server workflow for publishing official campaign overrides.

Creative saves never replace campaign levels. Admin saves are fetched through the server and applied on top of the committed campaign for every player using that deployment.
