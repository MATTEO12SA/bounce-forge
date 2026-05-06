import type Phaser from 'phaser';
import type { FxQuality, SaveData, SaveSystem } from './SaveSystem';

export interface Settings {
  soundEnabled: boolean;
  themeId: string;
  volumeSfx: number;
  volumeMusic: number;
  fxQuality: FxQuality;
  fullscreen: boolean;
}

export class SettingsSystem {
  private cached: Settings;

  public constructor(private readonly save: SaveSystem) {
    this.cached = this.readFromSave(this.save.snapshot());
  }

  public get(): Settings {
    return { ...this.cached };
  }

  public getVolumeSfx(): number {
    return this.cached.soundEnabled ? this.cached.volumeSfx : 0;
  }

  public getVolumeMusic(): number {
    return this.cached.soundEnabled ? this.cached.volumeMusic : 0;
  }

  public getFxQuality(): FxQuality {
    return this.cached.fxQuality;
  }

  public isFullscreen(): boolean {
    return this.cached.fullscreen;
  }

  public setSoundEnabled(enabled: boolean): Settings {
    return this.applySnapshot(this.save.setSoundEnabled(enabled));
  }

  public setVolumeSfx(value: number): Settings {
    return this.applySnapshot(this.save.setVolumeSfx(value));
  }

  public setVolumeMusic(value: number): Settings {
    return this.applySnapshot(this.save.setVolumeMusic(value));
  }

  public setFxQuality(quality: FxQuality): Settings {
    return this.applySnapshot(this.save.setFxQuality(quality));
  }

  public setFullscreen(enabled: boolean): Settings {
    return this.applySnapshot(this.save.setFullscreen(enabled));
  }

  public applyFullscreenToScale(scaleManager: Phaser.Scale.ScaleManager | undefined): void {
    if (!scaleManager) {
      return;
    }
    if (this.cached.fullscreen && !scaleManager.isFullscreen) {
      try {
        scaleManager.startFullscreen();
      } catch {
        // ignore: browser may reject without user gesture
      }
    } else if (!this.cached.fullscreen && scaleManager.isFullscreen) {
      scaleManager.stopFullscreen();
    }
  }

  private applySnapshot(snapshot: SaveData): Settings {
    this.cached = this.readFromSave(snapshot);
    return this.get();
  }

  private readFromSave(snapshot: SaveData): Settings {
    return {
      soundEnabled: snapshot.preferences.soundEnabled,
      themeId: snapshot.preferences.themeId,
      volumeSfx: snapshot.preferences.volumeSfx,
      volumeMusic: snapshot.preferences.volumeMusic,
      fxQuality: snapshot.preferences.fxQuality,
      fullscreen: snapshot.preferences.fullscreen
    };
  }
}
