import type { AudioSystem } from './AudioSystem';

export interface LiveAudioSettings {
  volumeSfx?: number;
  soundEnabled?: boolean;
}

const registered: Set<AudioSystem> = new Set();

export function registerAudioSystem(audio: AudioSystem): void {
  registered.add(audio);
}

export function unregisterAudioSystem(audio: AudioSystem): void {
  registered.delete(audio);
}

export function applyAudioSettings(settings: LiveAudioSettings): void {
  registered.forEach((audio) => {
    if (typeof settings.volumeSfx === 'number') {
      audio.setVolumeSfx(settings.volumeSfx);
    }
    if (typeof settings.soundEnabled === 'boolean') {
      audio.setEnabled(settings.soundEnabled);
    }
  });
}

export function clearAudioRegistry(): void {
  registered.clear();
}
