export class AudioSystem {
  private context: AudioContext | null = null;

  public constructor(private enabled: boolean) {}

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public unlock(): void {
    if (!this.enabled || typeof window === 'undefined') {
      return;
    }

    if (!this.context) {
      this.context = new AudioContext();
    }

    if (this.context.state === 'suspended') {
      void this.context.resume();
    }
  }

  public hit(): void {
    this.playTone(360, 0.035, 'triangle', 0.035);
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
    volume: number
  ): void {
    if (!this.enabled || !this.context) {
      return;
    }

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSeconds);

    oscillator.connect(gain);
    gain.connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + durationSeconds);
  }
}
