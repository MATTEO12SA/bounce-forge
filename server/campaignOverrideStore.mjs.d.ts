export interface StoredCampaignOverride {
  levelIndex: number;
  name: string;
  rows: string[];
  updatedAt: number;
}

export const EDITOR_GRID_COLS: number;
export const EDITOR_GRID_ROWS: number;

export function normalizeRows(rows: unknown): string[];
export function validateRows(rows: unknown): { valid: boolean; message: string };

export class CampaignOverrideStore {
  public constructor(filePath: string);
  public list(): Promise<StoredCampaignOverride[]>;
  public save(
    levelIndex: number,
    rows: readonly string[],
    name: string
  ): Promise<StoredCampaignOverride>;
  public remove(levelIndex: number): Promise<{ removed: boolean }>;
}
