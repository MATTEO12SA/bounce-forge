import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getIconManifest, getTablerIconPath, TABLER_ICON_NAMES } from '../src/game/ui/icons';
import {
  clampScrollOffset,
  clampSliderValue,
  getScrollContentHeight,
  getSegmentedControlWidth,
  getToggleLabel,
  resolveSegmentedSelection,
  snapSliderValue
} from '../src/game/ui/controlUtils';

describe('vendor-inspired UI helpers', () => {
  it('clamps and snaps slider values', () => {
    expect(clampSliderValue(-1)).toBe(0);
    expect(clampSliderValue(2)).toBe(1);
    expect(clampSliderValue(Number.NaN)).toBe(0);
    expect(snapSliderValue(0.64, 0.25)).toBe(0.75);
  });

  it('reports toggle labels from state', () => {
    expect(getToggleLabel(true)).toBe('ON');
    expect(getToggleLabel(false)).toBe('OFF');
  });

  it('keeps segmented controls on a valid selection', () => {
    const entries = [
      { label: 'LOW', value: 'low' },
      { label: 'MED', value: 'med' }
    ] as const;

    expect(resolveSegmentedSelection(entries, 'med')).toBe('med');
    expect(resolveSegmentedSelection(entries, 'missing' as 'low')).toBe('low');
    expect(getSegmentedControlWidth(3, 100, 8)).toBe(316);
  });

  it('keeps scroll offsets inside the viewport range', () => {
    expect(getScrollContentHeight(4, 100, 12)).toBe(436);
    expect(clampScrollOffset(-40, 436, 300)).toBe(0);
    expect(clampScrollOffset(999, 436, 300)).toBe(136);
  });

  it('references only SVG icons that exist in public assets', () => {
    expect(TABLER_ICON_NAMES.length).toBeGreaterThan(0);

    for (const entry of getIconManifest()) {
      expect(entry.path).toBe(getTablerIconPath(entry.name));
      expect(existsSync(join(process.cwd(), 'public', entry.path.replace(/^\//, '')))).toBe(true);
    }
  });
});
