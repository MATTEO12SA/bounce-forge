import Phaser from 'phaser';
import type { ThemeDefinition } from '../config/themeConfig';
import { Button } from './Button';
import {
  getSegmentedControlWidth,
  resolveSegmentedSelection,
  type SegmentedControlEntry
} from './controlUtils';

export type { SegmentedControlEntry } from './controlUtils';

interface SegmentedControlOptions {
  theme?: ThemeDefinition;
  buttonWidth?: number;
  buttonHeight?: number;
  gap?: number;
}

export class SegmentedControl<T extends string> extends Phaser.GameObjects.Container {
  private readonly buttons: Button[] = [];

  public constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    entries: readonly SegmentedControlEntry<T>[],
    selected: T,
    onChange: (value: T) => void,
    options: SegmentedControlOptions = {}
  ) {
    super(scene, x, y);
    const buttonWidth = options.buttonWidth ?? 178;
    const buttonHeight = options.buttonHeight ?? 82;
    const gap = options.gap ?? 12;
    const width = getSegmentedControlWidth(entries.length, buttonWidth, gap);
    const safeSelected = resolveSegmentedSelection(entries, selected);

    entries.forEach((entry, index) => {
      const button = new Button(
        scene,
        -width / 2 + index * (buttonWidth + gap) + buttonWidth / 2,
        0,
        buttonWidth,
        buttonHeight,
        entry.label,
        () => onChange(entry.value),
        {
          selected: entry.value === safeSelected,
          variant: 'secondary',
          compact: true
        }
      );
      this.buttons.push(button);
      this.add(button);
    });

    this.setSize(width, buttonHeight);
    scene.add.existing(this);
  }

  public override destroy(fromScene?: boolean): void {
    this.buttons.splice(0).forEach((button) => button.destroy(fromScene));
    super.destroy(fromScene);
  }
}
