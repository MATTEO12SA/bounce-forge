export function clampSliderValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

export function snapSliderValue(value: number, step?: number): number {
  const clamped = clampSliderValue(value);

  if (!step || step <= 0) {
    return clamped;
  }

  return clampSliderValue(Math.round(clamped / step) * step);
}

export function getToggleLabel(checked: boolean): 'ON' | 'OFF' {
  return checked ? 'ON' : 'OFF';
}

export interface SegmentedControlEntry<T extends string> {
  label: string;
  value: T;
}

export function resolveSegmentedSelection<T extends string>(
  entries: readonly SegmentedControlEntry<T>[],
  selected: T
): T {
  const first = entries[0];

  if (!first) {
    throw new Error('Segmented controls require at least one entry.');
  }

  return entries.some((entry) => entry.value === selected) ? selected : first.value;
}

export function getSegmentedControlWidth(count: number, buttonWidth: number, gap: number): number {
  return count * buttonWidth + Math.max(0, count - 1) * gap;
}

export function clampScrollOffset(
  offset: number,
  contentHeight: number,
  viewportHeight: number
): number {
  const maxOffset = Math.max(0, contentHeight - viewportHeight);

  if (!Number.isFinite(offset)) {
    return 0;
  }

  return Math.max(0, Math.min(maxOffset, offset));
}

export function getScrollContentHeight(count: number, itemHeight: number, gap = 0): number {
  return count * itemHeight + Math.max(0, count - 1) * gap;
}
