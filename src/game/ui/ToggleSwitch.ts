import Phaser from 'phaser';
import type { ThemeDefinition } from '../config/themeConfig';
import { getToggleLabel } from './controlUtils';
import { RoundedRect } from './roundedShapes';

interface ToggleSwitchOptions {
  theme?: ThemeDefinition;
  disabled?: boolean;
}

export class ToggleSwitch extends Phaser.GameObjects.Container {
  private readonly background: RoundedRect;
  private readonly knob: Phaser.GameObjects.Arc;
  private readonly label: Phaser.GameObjects.Text;
  private readonly activeColor: number;
  private readonly inactiveColor: number;
  private readonly strokeColor: number;
  private readonly activeTextColor = '#111111';
  private readonly inactiveTextColor: string;
  private checked: boolean;

  public constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    checked: boolean,
    private readonly onToggle: (checked: boolean) => void,
    options: ToggleSwitchOptions = {}
  ) {
    super(scene, x, y);
    this.checked = checked;
    const theme = options.theme;
    this.activeColor = theme?.primary ?? 0xffd31a;
    this.inactiveColor = theme?.surfaceSoft ?? 0x141414;
    this.strokeColor = theme?.borderDim ?? 0x7d6600;
    this.inactiveTextColor = theme?.text ?? '#f4f7fb';

    this.background = new RoundedRect(scene, 176, 72, 36, {
      fill: {
        color: checked ? this.activeColor : this.inactiveColor,
        alpha: options.disabled ? 0.38 : 0.94
      },
      stroke: {
        color: checked ? this.activeColor : this.strokeColor,
        width: 2,
        alpha: options.disabled ? 0.24 : 0.86
      }
    });
    this.knob = scene.add.circle(
      checked ? 50 : -50,
      0,
      25,
      0xffffff,
      options.disabled ? 0.42 : 0.96
    );
    this.label = scene.add
      .text(0, 0, getToggleLabel(checked), {
        fontFamily: 'Arial, sans-serif',
        fontSize: '23px',
        fontStyle: '900',
        color: checked ? this.activeTextColor : this.inactiveTextColor,
        align: 'center'
      })
      .setOrigin(0.5);

    this.add([this.background, this.knob, this.label]);
    this.setSize(176, 72);
    this.setInteractive(
      new Phaser.Geom.Rectangle(-88, -36, 176, 72),
      Phaser.Geom.Rectangle.Contains
    );

    if (!options.disabled) {
      this.input!.cursor = 'pointer';
      this.on('pointerdown', () => this.setChecked(!this.checked, true));
    }

    scene.add.existing(this);
  }

  public isChecked(): boolean {
    return this.checked;
  }

  public setChecked(checked: boolean, notify = false): void {
    if (checked === this.checked) {
      return;
    }

    this.checked = checked;
    this.render();

    if (notify) {
      this.onToggle(this.checked);
    }
  }

  private render(): void {
    const fill = this.checked ? this.activeColor : this.inactiveColor;
    this.background.setStyles({
      fill: { color: fill, alpha: 0.94 },
      stroke: {
        color: this.checked ? this.activeColor : this.strokeColor,
        width: 2,
        alpha: 0.86
      }
    });
    this.knob.setX(this.checked ? 50 : -50);
    this.label.setText(getToggleLabel(this.checked));
    this.label.setColor(this.checked ? this.activeTextColor : this.inactiveTextColor);
  }
}
