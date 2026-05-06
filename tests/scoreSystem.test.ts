import { describe, expect, it } from 'vitest';
import { ComboSystem } from '../src/game/systems/ComboSystem';
import { ScoreSystem } from '../src/game/systems/ScoreSystem';

describe('score and combo systems', () => {
  it('awards higher score as combo grows', () => {
    const score = new ScoreSystem();
    const combo = new ComboSystem();

    const firstCombo = combo.registerBreak();
    const first = score.registerBrickBreak(100, firstCombo.multiplier, 1);
    const secondCombo = combo.registerBreak();
    const second = score.registerBrickBreak(100, secondCombo.multiplier, 1);

    expect(first).toBe(100);
    expect(second).toBeGreaterThan(first);
    expect(score.snapshot().bricksBroken).toBe(2);
  });

  it('resets combo after timeout', () => {
    const combo = new ComboSystem(100);

    combo.registerBreak();
    combo.update(120);

    expect(combo.snapshot().streak).toBe(0);
    expect(combo.snapshot().multiplier).toBe(1);
  });
});
