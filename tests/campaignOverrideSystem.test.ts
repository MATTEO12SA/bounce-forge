import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminApiSystem } from '../src/game/systems/AdminApiSystem';
import { CampaignOverrideSystem } from '../src/game/systems/CampaignOverrideSystem';

describe('campaign override system', () => {
  afterEach(() => {
    vi.useRealTimers();
    CampaignOverrideSystem.clear();
  });

  it('does not stay pending when the admin API never resolves', async () => {
    vi.useFakeTimers();
    const refresh = CampaignOverrideSystem.refresh({
      getCampaignOverrides: () => new Promise<never>(() => {})
    } as unknown as AdminApiSystem);

    await vi.advanceTimersByTimeAsync(2500);
    await expect(refresh).resolves.toBeUndefined();
    expect(CampaignOverrideSystem.isLoaded()).toBe(false);
  });
});
