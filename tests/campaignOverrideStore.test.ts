import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// prettier-ignore
// @ts-expect-error Server modules are runtime .mjs files exercised by Vitest.
import { CampaignOverrideStore, EDITOR_GRID_COLS, normalizeRows, validateRows } from '../server/campaignOverrideStore.mjs';

let tempDir: string | null = null;

async function makeStore(): Promise<CampaignOverrideStore> {
  tempDir = await mkdtemp(join(tmpdir(), 'bounce-forge-store-'));
  return new CampaignOverrideStore(join(tempDir, 'campaign-level-overrides.json'));
}

function makeRows(): string[] {
  const rows = normalizeRows([]);
  rows[0] = `1${'.'.repeat(EDITOR_GRID_COLS - 1)}`;
  return rows;
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('campaign override store', () => {
  it('validates admin layouts', () => {
    expect(validateRows(makeRows()).valid).toBe(true);
    expect(validateRows(normalizeRows([])).valid).toBe(false);
  });

  it('persists admin campaign overrides on disk', async () => {
    const store = await makeStore();

    await store.save(0, makeRows(), 'Admin Level');
    const reloaded = new CampaignOverrideStore(join(tempDir!, 'campaign-level-overrides.json'));

    expect(await reloaded.list()).toMatchObject([
      {
        levelIndex: 0,
        name: 'Admin Level'
      }
    ]);
  });
});
