import type Phaser from 'phaser';
import type { ThemeDefinition } from '../config/themeConfig';
import { SegmentedControl, type SegmentedControlEntry } from './SegmentedControl';

interface TabBarOptions {
  theme?: ThemeDefinition;
  buttonWidth?: number;
  buttonHeight?: number;
}

export class TabBar<T extends string> extends SegmentedControl<T> {
  public constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    tabs: readonly SegmentedControlEntry<T>[],
    selected: T,
    onChange: (value: T) => void,
    options: TabBarOptions = {}
  ) {
    super(scene, x, y, tabs, selected, onChange, {
      theme: options.theme,
      buttonWidth: options.buttonWidth ?? 210,
      buttonHeight: options.buttonHeight ?? 70,
      gap: 10
    });
  }
}
