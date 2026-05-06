export class AudioSystem {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private volumeSfx = 1;
  private lastHitAt = 0;
  private detuneCents = 0;

  public constructor(private enabled: boolean, volumeSfx = 1) {
    this.volumeSfx = clamp01(volumeSfx);
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.masterGain && this.context) {
      this.masterGain.gain.setValueAtTime(this.effectiveVolume(), this.context.currentTime);
    }
  }

  public setVolumeSfx(value: number): void {
    this.volumeSfx = clamp01(value);
    if (this.masterGain && this.context) {
      this.masterGain.gain.setValueAtTime(this.effectiveVolume(), this.context.currentTime);
    }
  }

  public unlock(): void {
    if (!this.enabled || typeof window === 'undefined') {
      return;
    }

    if (!this.context) {
      this.context = new AudioContext();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.setValueAtTime(this.effectiveVolume(), this.context.currentTime);
      this.masterGain.connect(this.context.destination);
    }

    if (this.context.state === 'suspended') {
      void this.context.resume();
    }
  }

  public hit(): void {
    this.playTone(360, 0.035, 'triangle', 0.035, true);
  }

  public break(): void {
    this.playTone(620, 0.06, 'square', 0.028);
  }

  public power(): void {
    this.playTone(820, 0.09, 'sine', 0.035);
  }

  public danger(): void {
    this.playTone(160, 0.12, 'sawtooth', 0.03);
  }

  private playTone(
    frequency: number,
    durationSeconds: number,
    type: OscillatorType,
    volume: number,
    detunable = false
  ): void {
    if (!this.enabled || !this.context || !this.masterGain) {
      return;
    }

    const now = this.context.currentTime;

    if (detunable) {
      const sinceLast = now - this.lastHitAt;
      if (sinceLast < 0.4) {
        this.detuneCents = Math.min(this.detuneCents + 12, 240);
      } else {
        this.detuneCents = 0;
      }
      this.lastHitAt = now;
    }

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (detunable && this.detuneCents !== 0) {
      oscillator.detune.setValueAtTime(this.detuneCents, now);
    }
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSeconds);

    oscillator.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + durationSeconds);
  }

  private effectiveVolume(): number {
    return this.enabled ? this.volumeSfx : 0;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
