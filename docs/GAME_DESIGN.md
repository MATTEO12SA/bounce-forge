# Game Design

## Core Loop

The player clears breakable bricks by keeping one or more balls in play. Each cleared level unlocks the next campaign level. Losing all balls costs a life; losing all lives ends the run.

## Feel

- Paddle impact changes the outgoing ball angle based on where the ball hits the paddle.
- Ball speed is clamped between minimum and maximum values.
- Near-horizontal and near-vertical loops are corrected by axis-lock prevention.
- Brick breaks spawn generated particles and small camera shake.
- Explosive bricks damage nearby breakable bricks.

## Bricks

- Standard: one hit, baseline score.
- Resistant: multiple hits, higher score.
- Explosive: one hit, damages nearby bricks.
- Indestructible: blocks the ball and does not count toward level completion.

## Power-Ups And Maluses

- Multi-ball: duplicates active balls up to the active ball cap.
- Wide paddle: temporarily increases paddle width.
- Laser: temporarily auto-fires projectiles from the paddle.
- Fireball: temporarily increases ball damage.
- Slow motion: temporarily reduces ball speed.
- Shield: spawns a one-shot barrier under the paddle that bounces the next falling ball, then disappears.
- Extra Life: grants +1 life, capped at 5.
- Small paddle: temporarily shrinks the paddle.
- Fast ball: temporarily increases ball speed.

Power-ups are round pickups that fall from broken bricks. The drop chance scales with the campaign level.

## Progression

Difficulty is derived from the campaign level index:

- Ball speed increases gradually.
- Maximum ball speed increases gradually.
- Resistant bricks gain health after later levels.
- Power-up drop chance increases slightly.
- Score multiplier increases per level.

## Modes

Implemented now:

- Campaign mode.

Planned:

- Endless mode.
- Level editor.
