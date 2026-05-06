import { describe, expect, it } from 'vitest';
import { SaveSystem } from '../src/game/systems/SaveSystem';
import { SettingsSystem } from '../src/game/systems/SettingsSystem';
import type { KeyValueStorage } from '../src/game/utils/storage';

class MemoryStorage implements KeyValueStorage {
  private readonly data = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  public removeItem(key: string): void {
    this.data.delete(key);
  }
}

function makeSystems(): { save: SaveSystem; settings: SettingsSystem } {
  const save = new SaveSystem(new MemoryStorage());
  const settings = new SettingsSystem(save);
  return { save, settings };
}

describe('SettingsSystem', () => {
  it('exposes default v5 preferences', () => {
    const { settings } = makeSystems();
    const snapshot = settings.get();

    expect(snapshot.fxQuality).toBe('med');
    expect(snapshot.volumeSfx).toBe(0.7);
    expect(snapshot.volumeMusic).toBe(0.5);
    expect(snapshot.fullscreen).toBe(false);
    expect(snapshot.soundEnabled).toBe(true);
    expect(snapshot.themeId).toBe('forge');
  });

  it('clamps and persists volume changes', () => {
    const { save, settings } = makeSystems();

    settings.setVolumeSfx(0.42);
    settings.setVolumeMusic(2);

    const reloaded = new SettingsSystem(save);
    expect(reloaded.get().volumeSfx).toBeCloseTo(0.42);
    expect(reloaded.get().volumeMusic).toBe(1);
  });

  it('zeros effective volume when sound disabled', () => {
    const { settings } = makeSystems();
    settings.setVolumeSfx(0.9);
    settings.setSoundEnabled(false);

    expect(settings.getVolumeSfx()).toBe(0);
    expect(settings.getVolumeMusic()).toBe(0);
  });

  it('switches FX quality and persists across reload', () => {
    const { save, settings } = makeSystems();
    settings.setFxQuality('high');

    const reloaded = new SettingsSystem(save);
    expect(reloaded.getFxQuality()).toBe('high');
  });

  it('toggles fullscreen flag persistently', () => {
    const { save, settings } = makeSystems();
    settings.setFullscreen(true);

    const reloaded = new SettingsSystem(save);
    expect(reloaded.isFullscreen()).toBe(true);
  });
});
