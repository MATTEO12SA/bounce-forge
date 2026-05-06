import type Phaser from 'phaser';
import type { ThemeDefinition } from '../config/themeConfig';
import type { FxQuality } from './SaveSystem';
import type { ParticleSystem } from './ParticleSystem';

export type FxEntityKind =
  | 'ball'
  | 'paddle'
  | 'brick-standard'
  | 'brick-bonus'
  | 'brick-explosive'
  | 'brick-shield'
  | 'brick-indestructible';

interface PostFxController {
  addBloom?: (
    color?: number,
    offsetX?: number,
    offsetY?: number,
    blurStrength?: number,
    strength?: number,
    steps?: number
  ) => unknown;
  addGlow?: (
    color?: number,
    outerStrength?: number,
    innerStrength?: number,
    knockout?: boolean,
    quality?: number,
    distance?: number
  ) => unknown;
  addShine?: (speed?: number, lineWidth?: number, gradient?: number) => unknown;
  addBlur?: (
    quality?: number,
    x?: number,
    y?: number,
    strength?: number,
    color?: number
  ) => unknown;
}

export interface FxQualityProfile {
  postFx: boolean;
  particleScale: number;
  cameraShakeScale: number;
  cameraFlash: boolean;
  ballTrail: boolean;
  brickShine: boolean;
  brickGlow: boolean;
}

const QUALITY_PROFILES: Record<FxQuality, FxQualityProfile> = {
  low: {
    postFx: false,
    particleScale: 0.45,
    cameraShakeScale: 0.55,
    cameraFlash: false,
    ballTrail: false,
    brickShine: false,
    brickGlow: false
  },
  med: {
    postFx: true,
    particleScale: 0.85,
    cameraShakeScale: 1,
    cameraFlash: true,
    ballTrail: false,
    brickShine: true,
    brickGlow: true
  },
  high: {
    postFx: true,
    particleScale: 1.2,
    cameraShakeScale: 1.15,
    cameraFlash: true,
    ballTrail: true,
    brickShine: true,
    brickGlow: true
  }
};

const SHAKE_DEDUP_MS = 50;

interface FpsSample {
  deltaMs: number;
}

interface FpsState {
  samples: FpsSample[];
  windowMs: number;
  belowThresholdMs: number;
  aboveThresholdMs: number;
}

export class FxManager {
  private quality: FxQuality;
  private profile: FxQualityProfile;
  private lastShakeAt = 0;
  private fps: FpsState = {
    samples: [],
    windowMs: 0,
    belowThresholdMs: 0,
    aboveThresholdMs: 0
  };
  private degraded = false;
  private originalQuality: FxQuality;

  public constructor(
    private readonly scene: Phaser.Scene,
    private readonly particles: ParticleSystem,
    initialQuality: FxQuality
  ) {
    this.quality = initialQuality;
    this.originalQuality = initialQuality;
    this.profile = QUALITY_PROFILES[initialQuality];
  }

  public getQuality(): FxQuality {
    return this.quality;
  }

  public getProfile(): FxQualityProfile {
    return this.profile;
  }

  public setQuality(quality: FxQuality): void {
    this.quality = quality;
    this.profile = QUALITY_PROFILES[quality];
    this.originalQuality = quality;
    this.degraded = false;
  }

  public playHit(x: number, y: number, color: number, count = 10): void {
    const scaled = Math.max(2, Math.round(count * this.profile.particleScale));
    this.particles.burst(x, y, color, scaled);
  }

  public playBreak(x: number, y: number, color: number, count = 18): void {
    const scaled = Math.max(4, Math.round(count * this.profile.particleScale));
    this.particles.burst(x, y, color, scaled);
  }

  public playExplosion(x: number, y: number, color: number, count = 28): void {
    const scaled = Math.max(6, Math.round(count * this.profile.particleScale));
    this.particles.burst(x, y, color, scaled);
    this.cameraImpact(0.008, 180);
    this.cameraFlash(color, 90);
  }

  public cameraImpact(intensity = 0.005, duration = 120): void {
    const now = this.scene.time?.now ?? 0;
    if (now - this.lastShakeAt < SHAKE_DEDUP_MS) {
      return;
    }
    this.lastShakeAt = now;
    const scaled = intensity * this.profile.cameraShakeScale;
    this.scene.cameras.main.shake(duration, scaled);
  }

  public cameraFlash(color: number, duration = 90): void {
    if (!this.profile.cameraFlash) {
      return;
    }
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    this.scene.cameras.main.flash(duration, r, g, b, false);
  }

  public cameraComboZoom(): void {
    if (!this.profile.postFx) {
      return;
    }
    const camera = this.scene.cameras.main;
    const baseZoom = camera.zoom || 1;
    this.scene.tweens.add({
      targets: camera,
      zoom: baseZoom * 1.04,
      duration: 90,
      yoyo: true,
      ease: 'Quad.easeOut'
    });
  }

  public cameraFadeOut(duration: number, color = 0x000000): void {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    this.scene.cameras.main.fade(duration, r, g, b, false);
  }

  public applyEntityFx(
    target: Phaser.GameObjects.GameObject,
    kind: FxEntityKind,
    theme: ThemeDefinition
  ): void {
    if (!this.profile.postFx) {
      return;
    }
    const fxTarget = target as Phaser.GameObjects.GameObject & {
      postFX?: PostFxController | undefined;
    };
    const fx = fxTarget.postFX;
    if (!fx) {
      return;
    }

    switch (kind) {
      case 'ball':
        fx.addBloom?.(theme.primary, 1, 1, 1.4, 1.1);
        if (this.profile.ballTrail) {
          fx.addBlur?.(0, 1, 1, 0.6, theme.primary);
        }
        break;
      case 'paddle':
        fx.addGlow?.(theme.primary, 2, 0.8, false, 0.1, 12);
        break;
      case 'brick-bonus':
        if (this.profile.brickShine) {
          fx.addShine?.(0.4, 0.25, 3);
        }
        break;
      case 'brick-explosive':
        if (this.profile.brickGlow) {
          fx.addGlow?.(theme.danger, 2, 0.6, false, 0.1, 8);
        }
        break;
      case 'brick-shield':
        if (this.profile.brickShine) {
          fx.addShine?.(0.2, 0.15, 2);
        }
        break;
      case 'brick-standard':
      case 'brick-indestructible':
        break;
    }
  }

  public tickPerformance(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
      return;
    }

    this.fps.samples.push({ deltaMs });
    this.fps.windowMs += deltaMs;

    while (this.fps.windowMs > 5000 && this.fps.samples.length > 0) {
      const removed = this.fps.samples.shift();
      if (removed) {
        this.fps.windowMs -= removed.deltaMs;
      }
    }

    if (deltaMs > 22) {
      this.fps.belowThresholdMs += deltaMs;
      this.fps.aboveThresholdMs = 0;
    } else if (deltaMs < 17) {
      this.fps.aboveThresholdMs += deltaMs;
      this.fps.belowThresholdMs = 0;
    }

    if (!this.degraded && this.fps.belowThresholdMs > 3000) {
      this.degradeQuality();
    } else if (this.degraded && this.fps.aboveThresholdMs > 5000) {
      this.restoreQuality();
    }
  }

  public isDegraded(): boolean {
    return this.degraded;
  }

  private degradeQuality(): void {
    if (this.quality === 'low') {
      return;
    }
    const next: FxQuality = this.quality === 'high' ? 'med' : 'low';
    this.quality = next;
    this.profile = QUALITY_PROFILES[next];
    this.degraded = true;
    this.fps.belowThresholdMs = 0;
  }

  private restoreQuality(): void {
    this.quality = this.originalQuality;
    this.profile = QUALITY_PROFILES[this.originalQuality];
    this.degraded = false;
    this.fps.aboveThresholdMs = 0;
  }
}
