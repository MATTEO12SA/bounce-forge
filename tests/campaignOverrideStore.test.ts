import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// prettier-ignore
// @ts-expect-error Server modules are runtime .mjs files exercised by Vitest.
import { CampaignOverrideStore, EDITOR_GRID_COLS, ValidationError, normalizeRows, validateRows } from '../server/campaignOverrideStore.mjs';

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

  it('normalizes admin override names before writing', async () => {
    const store = await makeStore();
    const longName = 'C'.repeat(132);

    await store.save(0, makeRows(), `  ${longName}  `);
    await store.save(1, makeRows(), '   ');

    expect(await store.list()).toMatchObject([
      {
        levelIndex: 0,
        name: 'C'.repeat(120)
      },
      {
        levelIndex: 1,
        name: 'Level 2'
      }
    ]);
  });

  it('removes a stored admin campaign override', async () => {
    const store = await makeStore();

    await store.save(0, makeRows(), 'Admin Level');
    await store.save(1, makeRows(), 'Second Level');

    expect(await store.remove(0)).toEqual({ removed: true });
    expect(await store.remove(0)).toEqual({ removed: false });
    expect(await store.list()).toMatchObject([
      {
        levelIndex: 1,
        name: 'Second Level'
      }
    ]);
  });

  it('throws validation errors for invalid writes', async () => {
    const store = await makeStore();
    const rows = makeRows();
    rows[0] = `Z${'.'.repeat(EDITOR_GRID_COLS - 1)}`;

    await expect(store.save(24, makeRows(), 'Missing')).rejects.toBeInstanceOf(ValidationError);
    await expect(store.save(0, rows, 'Broken')).rejects.toThrow('Unknown block');
    await expect(store.remove(24)).rejects.toBeInstanceOf(ValidationError);
  });
});
