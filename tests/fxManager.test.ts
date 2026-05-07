import { describe, expect, it, vi } from 'vitest';
import { FxManager } from '../src/game/systems/FxManager';
import type { ParticleSystem } from '../src/game/systems/ParticleSystem';
import { isDebugOverlayEnabled } from '../src/game/ui/DebugOverlay';

interface MockCamera {
  shake: ReturnType<typeof vi.fn>;
  flash: ReturnType<typeof vi.fn>;
  fade: ReturnType<typeof vi.fn>;
  zoom: number;
}

interface MockScene {
  cameras: { main: MockCamera };
  time: { now: number };
  tweens: { add: ReturnType<typeof vi.fn> };
}

function createScene(timeNow = 0): MockScene {
  return {
    cameras: {
      main: {
        shake: vi.fn(),
        flash: vi.fn(),
        fade: vi.fn(),
        zoom: 1
      }
    },
    time: { now: timeNow },
    tweens: { add: vi.fn() }
  };
}

function createParticles(): ParticleSystem {
  return {
    burst: vi.fn(),
    shake: vi.fn()
  } as unknown as ParticleSystem;
}

describe('FxManager', () => {
  it('exposes a quality profile that gates camera flash', () => {
    const scene = createScene();
    const particles = createParticles();
    const lowFx = new FxManager(scene as unknown as Phaser.Scene, particles, 'low');
    const highFx = new FxManager(scene as unknown as Phaser.Scene, particles, 'high');

    expect(lowFx.getProfile().postFx).toBe(false);
    expect(highFx.getProfile().postFx).toBe(true);
    expect(lowFx.getProfile().cameraFlash).toBe(false);
    expect(highFx.getProfile().ballTrail).toBe(true);
  });

  it('forwards burst counts to ParticleSystem with quality scaling', () => {
    const scene = createScene();
    const particles = createParticles();
    const fx = new FxManager(scene as unknown as Phaser.Scene, particles, 'low');

    fx.playHit(10, 20, 0xff0000, 10);
    expect(particles.burst).toHaveBeenCalledTimes(1);
    const callArgs = (particles.burst as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(callArgs).toBeDefined();
    expect(callArgs?.[3]).toBeLessThan(10);
  });

  it('skips redundant shakes within dedup window', () => {
    const scene = createScene(1000);
    const particles = createParticles();
    const fx = new FxManager(scene as unknown as Phaser.Scene, particles, 'med');

    fx.cameraImpact(0.005, 100);
    expect(scene.cameras.main.shake).toHaveBeenCalledTimes(1);

    fx.cameraImpact(0.005, 100);
    expect(scene.cameras.main.shake).toHaveBeenCalledTimes(1);

    scene.time.now = 1100;
    fx.cameraImpact(0.005, 100);
    expect(scene.cameras.main.shake).toHaveBeenCalledTimes(2);
  });

  it('downgrades quality after sustained slow frames and restores after fast ones', () => {
    const scene = createScene();
    const particles = createParticles();
    const fx = new FxManager(scene as unknown as Phaser.Scene, particles, 'high');

    for (let i = 0; i < 200; i += 1) {
      fx.tickPerformance(30);
    }
    expect(fx.getQuality()).not.toBe('high');
    expect(fx.isDegraded()).toBe(true);

    for (let i = 0; i < 800; i += 1) {
      fx.tickPerformance(15);
    }
    expect(fx.getQuality()).toBe('high');
    expect(fx.isDegraded()).toBe(false);
  });

  it('enables the debug overlay only through the debug query parameter', () => {
    expect(isDebugOverlayEnabled('?debug=1')).toBe(true);
    expect(isDebugOverlayEnabled('?debug=0')).toBe(false);
    expect(isDebugOverlayEnabled('?menu=1')).toBe(false);
  });
});
