import Phaser from 'phaser';
import { TOKENS } from '../config/designTokens';
import type { ThemeDefinition } from '../config/themeConfig';
import { snapSliderValue } from './controlUtils';
import { RoundedRect } from './roundedShapes';

interface SliderOptions {
  height?: number;
  step?: number;
  theme?: ThemeDefinition;
  disabled?: boolean;
}

export class Slider extends Phaser.GameObjects.Container {
  private readonly track: RoundedRect;
  private readonly fill: RoundedRect;
  private readonly knob: Phaser.GameObjects.Arc;
  private readonly valueText: Phaser.GameObjects.Text;
  private readonly widthValue: number;
  private readonly heightValue: number;
  private readonly step?: number;
  private value: number;
  private dragging = false;

  public constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    value: number,
    private readonly onChange: (value: number) => void,
    options: SliderOptions = {}
  ) {
    super(scene, x, y);
    this.widthValue = width;
    this.heightValue = options.height ?? 72;
    this.step = options.step;
    this.value = snapSliderValue(value, this.step);
    const theme = options.theme;
    const fillColor = theme?.primary ?? 0xffd31a;
    const trackColor = theme?.surfaceSoft ?? 0x141414;
    const strokeColor = theme?.borderDim ?? 0x7d6600;
    const textColor = theme?.text ?? '#f4f7fb';

    this.track = new RoundedRect(scene, width, 18, TOKENS.radius.sm, {
      fill: { color: trackColor, alpha: options.disabled ? 0.38 : 0.92 },
      stroke: { color: strokeColor, width: 2, alpha: options.disabled ? 0.22 : 0.76 }
    });
    this.fill = new RoundedRect(scene, 2, 18, TOKENS.radius.sm, {
      fill: { color: fillColor, alpha: options.disabled ? 0.28 : 0.88 }
    });
    this.fill.setPosition(-width / 2 + 1, 0);
    this.knob = scene.add
      .circle(0, 0, 27, fillColor, options.disabled ? 0.42 : 1)
      .setStrokeStyle(3, 0xffffff, 0.42);
    this.valueText = scene.add
      .text(width / 2 + 76, 0, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '26px',
        fontStyle: '900',
        color: textColor,
        align: 'right',
        fixedWidth: 100
      })
      .setOrigin(1, 0.5);

    this.add([this.track, this.fill, this.knob, this.valueText]);
    this.setSize(width + 120, this.heightValue);
    this.setInteractive(
      new Phaser.Geom.Rectangle(-width / 2, -this.heightValue / 2, width, this.heightValue),
      Phaser.Geom.Rectangle.Contains
    );

    if (!options.disabled) {
      this.input!.cursor = 'pointer';
      this.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        this.dragging = true;
        this.updateFromPointer(pointer);
      });
      scene.input.on('pointermove', this.handlePointerMove, this);
      scene.input.on('pointerup', this.stopDragging, this);
      scene.input.on('pointerupoutside', this.stopDragging, this);
      this.once(Phaser.GameObjects.Events.DESTROY, () => {
        scene.input.off('pointermove', this.handlePointerMove, this);
        scene.input.off('pointerup', this.stopDragging, this);
        scene.input.off('pointerupoutside', this.stopDragging, this);
      });
    }

    this.render();
    scene.add.existing(this);
  }

  public getValue(): number {
    return this.value;
  }

  public setValue(value: number, notify = false): void {
    const next = snapSliderValue(value, this.step);

    if (Math.abs(next - this.value) < 0.001) {
      return;
    }

    this.value = next;
    this.render();

    if (notify) {
      this.onChange(this.value);
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.dragging && pointer.isDown) {
      this.updateFromPointer(pointer);
    }
  }

  private stopDragging(): void {
    this.dragging = false;
  }

  private updateFromPointer(pointer: Phaser.Input.Pointer): void {
    const localX = pointer.x - this.x;
    this.setValue((localX + this.widthValue / 2) / this.widthValue, true);
  }

  private render(): void {
    const fillWidth = Math.max(2, this.widthValue * this.value);
    this.fill.resize(fillWidth, 18);
    this.fill.setPosition(-this.widthValue / 2 + fillWidth / 2, 0);
    this.knob.setPosition(-this.widthValue / 2 + this.widthValue * this.value, 0);
    this.valueText.setText(`${Math.round(this.value * 100)}%`);
  }
}
