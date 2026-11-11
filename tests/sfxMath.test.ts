import { describe, expect, it } from 'vitest';
import {
  COMBO_BASE_FREQUENCY,
  COMBO_MAX_STEPS,
  comboNoteFrequency,
  panForX,
  VoiceLimiter
} from '../src/game/audio/sfxMath';

describe('sound helpers', () => {
  it('climbs the pentatonic scale with the combo', () => {
    const notes = [1, 2, 3, 4, 5, 6].map(comboNoteFrequency);
    expect(notes[0]).toBeCloseTo(COMBO_BASE_FREQUENCY, 2);
    for (let i = 1; i < notes.length; i += 1) {
      expect(notes[i]!).toBeGreaterThan(notes[i - 1]!);
    }
    expect(notes[5]).toBeCloseTo(COMBO_BASE_FREQUENCY * 2, 1);
  });

  it('stays within two octaves on very long combos', () => {
    for (let combo = COMBO_MAX_STEPS; combo < 200; combo += 7) {
      const f = comboNoteFrequency(combo);
      expect(f).toBeGreaterThanOrEqual(COMBO_BASE_FREQUENCY);
      expect(f).toBeLessThan(COMBO_BASE_FREQUENCY * 4);
    }
  });

  it('pans gently from left to right', () => {
    expect(panForX(0)).toBeCloseTo(-0.6);
    expect(panForX(540)).toBeCloseTo(0);
    expect(panForX(1080)).toBeCloseTo(0.6);
    expect(panForX(Number.NaN)).toBe(0);
  });

  it('limits polyphony and fast retriggers', () => {
    const limiter = new VoiceLimiter(2);
    expect(limiter.tryAcquire('a', 0, 0.05)).toBe(true);
    expect(limiter.tryAcquire('a', 0.01, 0.05)).toBe(false);
    expect(limiter.tryAcquire('b', 0.01, 0.05)).toBe(true);
    expect(limiter.tryAcquire('c', 0.02, 0.05)).toBe(false);
    limiter.release();
    expect(limiter.tryAcquire('c', 0.03, 0.05)).toBe(true);
  });
});
