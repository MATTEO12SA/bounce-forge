/** Pure helpers for the sound engine (no Web Audio here, so they are unit-testable). */

/** Major pentatonic steps: always consonant, so long combos never sound wrong. */
const PENTATONIC = [0, 2, 4, 7, 9] as const;
/** C5. Brick notes climb from here. */
export const COMBO_BASE_FREQUENCY = 523.25;
/** Two octaves of climb, then the melody keeps cycling the top octave. */
export const COMBO_MAX_STEPS = PENTATONIC.length * 2;

export function semitonesToRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

/**
 * Note of the n-th brick of a combo (1-based). Each break climbs one step of the pentatonic
 * scale; past two octaves it loops over the highest octave so the pitch stays pleasant.
 */
export function comboNoteFrequency(combo: number): number {
  const index = Math.max(0, Math.floor(combo) - 1);
  const step =
    index < COMBO_MAX_STEPS
      ? index
      : PENTATONIC.length + ((index - COMBO_MAX_STEPS) % PENTATONIC.length);
  const octave = Math.floor(step / PENTATONIC.length);
  const semitones = (PENTATONIC[step % PENTATONIC.length] ?? 0) + octave * 12;
  return COMBO_BASE_FREQUENCY * semitonesToRatio(semitones);
}

/** Stereo position from a world x coordinate, kept subtle (±0.6). */
export function panForX(x: number, worldWidth = 1080): number {
  if (!Number.isFinite(x)) {
    return 0;
  }
  const centered = (x - worldWidth / 2) / (worldWidth / 2);
  return Math.max(-0.6, Math.min(0.6, centered * 0.6));
}

/**
 * Limits how many voices play at once and how often the same sound may retrigger, so a
 * 96-ball storm stays musical instead of turning into noise (and never clips).
 */
export class VoiceLimiter {
  private active = 0;
  private readonly lastPlayed = new Map<string, number>();

  public constructor(private readonly maxVoices = 28) {}

  public get activeVoices(): number {
    return this.active;
  }

  /** Returns true and reserves a voice when the sound may play now. */
  public tryAcquire(name: string, now: number, minIntervalSeconds: number): boolean {
    if (this.active >= this.maxVoices) {
      return false;
    }
    const last = this.lastPlayed.get(name);
    if (last !== undefined && now - last < minIntervalSeconds) {
      return false;
    }
    this.lastPlayed.set(name, now);
    this.active += 1;
    return true;
  }

  public release(): void {
    this.active = Math.max(0, this.active - 1);
  }

  public reset(): void {
    this.active = 0;
    this.lastPlayed.clear();
  }
}
