import { describe, expect, it, beforeEach } from 'vitest';
import {
  applyAudioSettings,
  clearAudioRegistry,
  registerAudioSystem,
  unregisterAudioSystem
} from '../src/game/systems/audioRegistry';
import type { AudioSystem } from '../src/game/systems/AudioSystem';

interface AudioStub {
  setVolumeSfx: (value: number) => void;
  setEnabled: (value: boolean) => void;
  volumeCalls: number[];
  enabledCalls: boolean[];
}

function createStub(): AudioStub {
  const stub: AudioStub = {
    volumeCalls: [],
    enabledCalls: [],
    setVolumeSfx(value) {
      stub.volumeCalls.push(value);
    },
    setEnabled(value) {
      stub.enabledCalls.push(value);
    }
  };
  return stub;
}

describe('audioRegistry', () => {
  beforeEach(() => {
    clearAudioRegistry();
  });

  it('forwards volumeSfx changes to every registered audio system', () => {
    const a = createStub();
    const b = createStub();
    registerAudioSystem(a as unknown as AudioSystem);
    registerAudioSystem(b as unknown as AudioSystem);

    applyAudioSettings({ volumeSfx: 0.4 });

    expect(a.volumeCalls).toEqual([0.4]);
    expect(b.volumeCalls).toEqual([0.4]);
  });

  it('forwards soundEnabled changes', () => {
    const stub = createStub();
    registerAudioSystem(stub as unknown as AudioSystem);

    applyAudioSettings({ soundEnabled: false });

    expect(stub.enabledCalls).toEqual([false]);
  });

  it('does not forward to unregistered systems', () => {
    const stub = createStub();
    registerAudioSystem(stub as unknown as AudioSystem);
    unregisterAudioSystem(stub as unknown as AudioSystem);

    applyAudioSettings({ volumeSfx: 0.7, soundEnabled: true });

    expect(stub.volumeCalls).toEqual([]);
    expect(stub.enabledCalls).toEqual([]);
  });

  it('skips fields that are absent from the settings payload', () => {
    const stub = createStub();
    registerAudioSystem(stub as unknown as AudioSystem);

    applyAudioSettings({ volumeSfx: 0.2 });

    expect(stub.volumeCalls).toEqual([0.2]);
    expect(stub.enabledCalls).toEqual([]);
  });
});
