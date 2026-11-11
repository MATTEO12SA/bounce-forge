import { comboNoteFrequency, panForX, semitonesToRatio, VoiceLimiter } from './sfxMath';

export type SfxName =
  | 'brickBreak'
  | 'brickHit'
  | 'steel'
  | 'paddle'
  | 'wall'
  | 'launch'
  | 'explosion'
  | 'powerUp'
  | 'powerMiss'
  | 'lifeLost'
  | 'levelClear'
  | 'waveClear'
  | 'lastBrick'
  | 'comboMilestone'
  | 'ballSplit'
  | 'laser'
  | 'shield'
  | 'fire'
  | 'bumper'
  | 'teleport'
  | 'powerCombo'
  | 'risk'
  | 'mechanism';

export interface SfxOptions {
  /** World x of the event, used for subtle stereo panning. */
  x?: number;
  /** Current combo (1-based) for musical brick notes. */
  combo?: number;
  /** 0..1, where the ball hit the paddle (0 = centre, 1 = edge). */
  offset?: number;
  /** 0..1 strength (explosion chain depth, etc.). */
  intensity?: number;
}

/** Minimum time between two triggers of the same sound, in seconds. */
const RETRIGGER: Record<SfxName, number> = {
  brickBreak: 0.018,
  brickHit: 0.03,
  steel: 0.035,
  paddle: 0.04,
  wall: 0.05,
  launch: 0.08,
  explosion: 0.05,
  powerUp: 0.06,
  powerMiss: 0.12,
  lifeLost: 0.3,
  levelClear: 0.5,
  waveClear: 0.5,
  lastBrick: 0.5,
  comboMilestone: 0.15,
  ballSplit: 0.05,
  laser: 0.05,
  shield: 0.15,
  fire: 0.03,
  bumper: 0.05,
  teleport: 0.08,
  powerCombo: 0.4,
  risk: 0.1,
  mechanism: 0.08
};

type AudioContextConstructor = typeof AudioContext;

/**
 * One AudioContext for the whole session (browsers limit how many may exist), unlocked by the
 * first user gesture anywhere on the page. All sounds are synthesised: no files to download.
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = true;
  private volume = 0.7;
  private readonly limiter = new VoiceLimiter(28);

  public get state(): AudioContextState | 'none' {
    return this.context?.state ?? 'none';
  }

  public get activeVoices(): number {
    return this.limiter.activeVoices;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.applyVolume();
  }

  public setVolume(volume: number): void {
    this.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0;
    this.applyVolume();
  }

  /** Must run inside a user gesture handler at least once (autoplay policy). */
  public unlock(): void {
    const Ctor =
      typeof window === 'undefined'
        ? undefined
        : ((window.AudioContext ??
            (window as unknown as { webkitAudioContext?: AudioContextConstructor })
              .webkitAudioContext) as AudioContextConstructor | undefined);
    if (!Ctor) {
      return;
    }

    if (!this.context) {
      try {
        this.context = new Ctor({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      this.build(this.context);
    }

    if (this.context.state === 'suspended') {
      void this.context.resume().catch(() => undefined);
    }

    // iOS only fully unlocks after a sound actually starts inside the gesture.
    const ctx = this.context;
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, 22050);
    source.connect(ctx.destination);
    source.start(0);
  }

  public play(name: SfxName, options: SfxOptions = {}): void {
    const ctx = this.context;
    if (!this.enabled || this.volume <= 0 || !ctx || !this.bus || ctx.state !== 'running') {
      return;
    }
    const now = ctx.currentTime;
    if (!this.limiter.tryAcquire(name, now, RETRIGGER[name])) {
      return;
    }

    const out = ctx.createStereoPanner();
    out.pan.value = options.x === undefined ? 0 : panForX(options.x);
    out.connect(this.bus);

    const duration = this.render(name, ctx, out, now, options);
    const releaseAt = (duration + 0.05) * 1000;
    window.setTimeout(() => {
      out.disconnect();
      this.limiter.release();
    }, releaseAt);
  }

  // ------------------------------------------------------------------ graph

  private build(ctx: AudioContext): void {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 8;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;

    this.master = ctx.createGain();
    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(compressor);
    compressor.connect(this.master);
    this.master.connect(ctx.destination);

    const length = Math.floor(ctx.sampleRate * 0.6);
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    this.applyVolume();
  }

  private applyVolume(): void {
    if (this.master && this.context) {
      const target = this.enabled ? this.volume * 0.95 : 0;
      this.master.gain.setTargetAtTime(target, this.context.currentTime, 0.02);
    }
  }

  // ------------------------------------------------------------------ voices

  private tone(
    ctx: AudioContext,
    out: AudioNode,
    start: number,
    options: {
      type: OscillatorType;
      frequency: number;
      endFrequency?: number;
      gain: number;
      attack?: number;
      decay: number;
      detune?: number;
    }
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = options.type;
    osc.frequency.setValueAtTime(options.frequency, start);
    if (options.endFrequency !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, options.endFrequency),
        start + options.decay
      );
    }
    if (options.detune) {
      osc.detune.value = options.detune;
    }
    const attack = options.attack ?? 0.004;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(options.gain, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + options.decay);
    osc.connect(gain);
    gain.connect(out);
    osc.start(start);
    osc.stop(start + attack + options.decay + 0.02);
  }

  private noiseBurst(
    ctx: AudioContext,
    out: AudioNode,
    start: number,
    options: {
      filter: BiquadFilterType;
      frequency: number;
      endFrequency?: number;
      q?: number;
      gain: number;
      decay: number;
      attack?: number;
    }
  ): void {
    if (!this.noise) {
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = options.filter;
    filter.frequency.setValueAtTime(options.frequency, start);
    if (options.endFrequency !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(20, options.endFrequency),
        start + options.decay
      );
    }
    filter.Q.value = options.q ?? 0.8;
    const gain = ctx.createGain();
    const attack = options.attack ?? 0.002;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(options.gain, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + options.decay);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start(start, Math.random() * 0.3);
    source.stop(start + attack + options.decay + 0.02);
  }

  /** Builds one sound and returns its length in seconds. */
  private render(
    name: SfxName,
    ctx: AudioContext,
    out: AudioNode,
    t: number,
    options: SfxOptions
  ): number {
    switch (name) {
      case 'brickBreak': {
        // A bright bell-like note that climbs the scale with the combo.
        const f = comboNoteFrequency(options.combo ?? 1);
        this.tone(ctx, out, t, { type: 'triangle', frequency: f, gain: 0.34, decay: 0.22 });
        this.tone(ctx, out, t, { type: 'sine', frequency: f * 2, gain: 0.12, decay: 0.12 });
        this.tone(ctx, out, t, { type: 'sine', frequency: f * 3.01, gain: 0.05, decay: 0.06 });
        this.noiseBurst(ctx, out, t, {
          filter: 'bandpass',
          frequency: 4200,
          q: 1.2,
          gain: 0.16,
          decay: 0.025
        });
        return 0.26;
      }
      case 'brickHit': {
        // Metallic tink when an armoured brick takes a hit without breaking.
        this.tone(ctx, out, t, { type: 'square', frequency: 1480, gain: 0.07, decay: 0.05 });
        this.tone(ctx, out, t, { type: 'sine', frequency: 2210, gain: 0.08, decay: 0.08 });
        this.noiseBurst(ctx, out, t, {
          filter: 'highpass',
          frequency: 3000,
          gain: 0.08,
          decay: 0.03
        });
        return 0.1;
      }
      case 'steel': {
        this.tone(ctx, out, t, { type: 'square', frequency: 310, gain: 0.07, decay: 0.12 });
        this.tone(ctx, out, t, { type: 'square', frequency: 467, gain: 0.05, decay: 0.1 });
        this.noiseBurst(ctx, out, t, {
          filter: 'bandpass',
          frequency: 2400,
          q: 3,
          gain: 0.12,
          decay: 0.06
        });
        return 0.14;
      }
      case 'paddle': {
        // Woody "thock": lower in the centre, a little higher on the edges.
        const offset = Math.min(1, Math.abs(options.offset ?? 0));
        const f = 150 + offset * 70;
        this.tone(ctx, out, t, {
          type: 'sine',
          frequency: f * 1.6,
          endFrequency: f,
          gain: 0.5,
          decay: 0.11
        });
        this.tone(ctx, out, t, { type: 'triangle', frequency: f * 3, gain: 0.08, decay: 0.05 });
        this.noiseBurst(ctx, out, t, {
          filter: 'lowpass',
          frequency: 1400,
          gain: 0.2,
          decay: 0.04
        });
        return 0.14;
      }
      case 'wall': {
        this.tone(ctx, out, t, { type: 'triangle', frequency: 880, gain: 0.07, decay: 0.035 });
        this.noiseBurst(ctx, out, t, {
          filter: 'bandpass',
          frequency: 2600,
          q: 2,
          gain: 0.05,
          decay: 0.02
        });
        return 0.05;
      }
      case 'launch': {
        this.noiseBurst(ctx, out, t, {
          filter: 'bandpass',
          frequency: 500,
          endFrequency: 3200,
          q: 1.6,
          gain: 0.18,
          attack: 0.02,
          decay: 0.18
        });
        this.tone(ctx, out, t, {
          type: 'sine',
          frequency: 330,
          endFrequency: 660,
          gain: 0.12,
          decay: 0.14
        });
        return 0.22;
      }
      case 'explosion': {
        const power = 0.6 + 0.4 * Math.min(1, options.intensity ?? 0.5);
        this.noiseBurst(ctx, out, t, {
          filter: 'lowpass',
          frequency: 2600,
          endFrequency: 160,
          gain: 0.55 * power,
          decay: 0.45
        });
        this.tone(ctx, out, t, {
          type: 'sine',
          frequency: 110,
          endFrequency: 38,
          gain: 0.6 * power,
          decay: 0.38
        });
        this.tone(ctx, out, t, {
          type: 'square',
          frequency: 70,
          endFrequency: 45,
          gain: 0.08 * power,
          decay: 0.2
        });
        return 0.5;
      }
      case 'powerUp': {
        [0, 4, 7, 12].forEach((semitone, index) => {
          this.tone(ctx, out, t + index * 0.055, {
            type: 'triangle',
            frequency: 659.25 * semitonesToRatio(semitone),
            gain: 0.22,
            decay: 0.14
          });
        });
        this.tone(ctx, out, t + 0.22, {
          type: 'sine',
          frequency: 1318.5 * 2,
          gain: 0.06,
          decay: 0.25
        });
        return 0.5;
      }
      case 'ballSplit': {
        this.tone(ctx, out, t, {
          type: 'sine',
          frequency: 880,
          endFrequency: 1760,
          gain: 0.12,
          decay: 0.12
        });
        return 0.14;
      }
      case 'laser': {
        this.tone(ctx, out, t, {
          type: 'sawtooth',
          frequency: 1900,
          endFrequency: 620,
          gain: 0.06,
          decay: 0.09
        });
        return 0.1;
      }
      case 'shield': {
        this.tone(ctx, out, t, {
          type: 'sine',
          frequency: 520,
          endFrequency: 1040,
          gain: 0.2,
          decay: 0.2
        });
        this.tone(ctx, out, t + 0.02, {
          type: 'triangle',
          frequency: 1560,
          gain: 0.07,
          decay: 0.25
        });
        this.noiseBurst(ctx, out, t, {
          filter: 'highpass',
          frequency: 5000,
          gain: 0.06,
          decay: 0.12
        });
        return 0.3;
      }
      case 'fire': {
        // Short crackle while a fire ball burns through bricks.
        this.noiseBurst(ctx, out, t, {
          filter: 'bandpass',
          frequency: 1400,
          endFrequency: 500,
          q: 0.7,
          gain: 0.14,
          decay: 0.09
        });
        this.tone(ctx, out, t, {
          type: 'sine',
          frequency: 180,
          endFrequency: 90,
          gain: 0.12,
          decay: 0.08
        });
        return 0.12;
      }
      case 'bumper': {
        this.tone(ctx, out, t, {
          type: 'square',
          frequency: 660,
          endFrequency: 1320,
          gain: 0.08,
          decay: 0.08
        });
        this.tone(ctx, out, t + 0.04, { type: 'sine', frequency: 1320, gain: 0.1, decay: 0.12 });
        return 0.18;
      }
      case 'teleport': {
        this.tone(ctx, out, t, {
          type: 'sine',
          frequency: 300,
          endFrequency: 1800,
          gain: 0.14,
          decay: 0.16
        });
        this.tone(ctx, out, t + 0.08, {
          type: 'sine',
          frequency: 1800,
          endFrequency: 600,
          gain: 0.08,
          decay: 0.12
        });
        return 0.24;
      }
      case 'powerCombo': {
        [0, 7, 12, 19, 24].forEach((semitone, index) => {
          this.tone(ctx, out, t + index * 0.045, {
            type: 'square',
            frequency: 392 * semitonesToRatio(semitone),
            gain: 0.06,
            decay: 0.18
          });
        });
        this.noiseBurst(ctx, out, t, { filter: 'lowpass', frequency: 900, gain: 0.12, decay: 0.3 });
        return 0.5;
      }
      case 'risk': {
        // A dissonant pickup: the player knows they took a risk.
        this.tone(ctx, out, t, { type: 'sawtooth', frequency: 440, gain: 0.08, decay: 0.16 });
        this.tone(ctx, out, t, { type: 'sawtooth', frequency: 466.2, gain: 0.08, decay: 0.16 });
        this.tone(ctx, out, t + 0.1, { type: 'sine', frequency: 880, gain: 0.12, decay: 0.2 });
        return 0.32;
      }
      case 'mechanism': {
        // Click-clack of keys, gates and moving parts.
        this.noiseBurst(ctx, out, t, {
          filter: 'bandpass',
          frequency: 2600,
          q: 4,
          gain: 0.12,
          decay: 0.03
        });
        this.noiseBurst(ctx, out, t + 0.06, {
          filter: 'bandpass',
          frequency: 1700,
          q: 4,
          gain: 0.1,
          decay: 0.04
        });
        this.tone(ctx, out, t + 0.06, { type: 'triangle', frequency: 784, gain: 0.1, decay: 0.12 });
        return 0.2;
      }
      case 'powerMiss': {
        this.noiseBurst(ctx, out, t, {
          filter: 'bandpass',
          frequency: 900,
          endFrequency: 300,
          q: 1,
          gain: 0.07,
          decay: 0.2
        });
        return 0.22;
      }
      case 'lifeLost': {
        this.tone(ctx, out, t, {
          type: 'sawtooth',
          frequency: 392,
          endFrequency: 98,
          gain: 0.18,
          attack: 0.01,
          decay: 0.55
        });
        this.tone(ctx, out, t + 0.05, {
          type: 'sine',
          frequency: 196,
          endFrequency: 49,
          gain: 0.35,
          decay: 0.5
        });
        this.noiseBurst(ctx, out, t, {
          filter: 'lowpass',
          frequency: 800,
          endFrequency: 100,
          gain: 0.15,
          decay: 0.4
        });
        return 0.62;
      }
      case 'comboMilestone': {
        [12, 16, 19].forEach((semitone, index) => {
          this.tone(ctx, out, t + index * 0.035, {
            type: 'sine',
            frequency: 523.25 * semitonesToRatio(semitone),
            gain: 0.1,
            decay: 0.22
          });
        });
        return 0.32;
      }
      case 'waveClear':
      case 'levelClear':
      case 'lastBrick': {
        const notes = name === 'waveClear' ? [0, 7, 12] : [0, 4, 7, 12, 16];
        notes.forEach((semitone, index) => {
          this.tone(ctx, out, t + index * 0.08, {
            type: 'triangle',
            frequency: 523.25 * semitonesToRatio(semitone),
            gain: 0.2,
            decay: 0.35
          });
          this.tone(ctx, out, t + index * 0.08, {
            type: 'sine',
            frequency: 1046.5 * semitonesToRatio(semitone),
            gain: 0.06,
            decay: 0.2
          });
        });
        if (name !== 'waveClear') {
          this.tone(ctx, out, t, {
            type: 'sine',
            frequency: 130.8,
            endFrequency: 65.4,
            gain: 0.35,
            decay: 0.6
          });
        }
        return 0.9;
      }
      default:
        return 0.1;
    }
  }
}

/** The shared engine used by the game and the interface. */
export const audio = new AudioEngine();

/** Short vibration on phones for big moments; silently ignored elsewhere. */
export function haptic(durationMs: number): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(durationMs);
    }
  } catch {
    // Some browsers throw when vibration is blocked by permissions policy.
  }
}
