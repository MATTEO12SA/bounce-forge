import Phaser from 'phaser';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonOptions {
  fill?: number;
  hoverFill?: number;
  stroke?: number;
  textColor?: string;
  disabled?: boolean;
  selected?: boolean;
  compact?: boolean;
  variant?: ButtonVariant;
}

export class Button extends Phaser.GameObjects.Container {
  private readonly shadow: Phaser.GameObjects.Rectangle;
  private readonly background: Phaser.GameObjects.Rectangle;
  private readonly highlight: Phaser.GameObjects.Rectangle;
  private readonly labelText: Phaser.GameObjects.Text;
  private disabled: boolean;
  private readonly fill: number;
  private readonly hoverFill: number;
  private readonly stroke: number;
  private readonly selected: boolean;

  public constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    onClick: () => void,
    options: ButtonOptions = {}
  ) {
    super(scene, x, y);

    this.disabled = options.disabled ?? false;
    this.selected = options.selected ?? false;
    const style = this.resolveStyle(options);
    this.fill = options.fill ?? style.fill;
    this.hoverFill = options.hoverFill ?? style.hoverFill;
    this.stroke = options.stroke ?? style.stroke;
    const textColor = options.textColor ?? style.textColor;
    const radiusHeight = Math.max(1, height - 14);

    this.shadow = scene.add.rectangle(0, 5, width, height, 0x000000, this.disabled ? 0.12 : 0.24);

    this.background = scene.add
      .rectangle(0, 0, width, height, this.fill, this.disabled ? 0.38 : 0.96)
      .setStrokeStyle(this.selected ? 3 : 2, this.stroke, this.disabled ? 0.22 : 0.9);
    this.highlight = scene.add
      .rectangle(0, -height / 2 + 6, width - 18, Math.min(4, radiusHeight), 0xffffff, 0.16)
      .setAlpha(this.disabled ? 0.04 : this.selected ? 0.24 : 0.14);
    this.labelText = scene.add
      .text(0, 0, label, {
        fontFamily: 'Arial, sans-serif',
        fontSize: `${Math.max(options.compact ? 20 : 24, Math.round(height * 0.34))}px`,
        fontStyle: '800',
        color: textColor,
        align: 'center'
      })
      .setOrigin(0.5)
      .setShadow(0, 2, '#000814', 3, false, true);
    this.fitLabel(width, height);

    this.add([this.shadow, this.background, this.highlight, this.labelText]);
    this.setSize(width, height);
    this.setInteractive(
      new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height),
      Phaser.Geom.Rectangle.Contains
    );

    if (this.input && !this.disabled) {
      this.input.cursor = 'pointer';
    }

    const handleOver = (): void => {
      if (!this.disabled) {
        this.background.setFillStyle(this.hoverFill, 1);
        this.background.setStrokeStyle(3, this.stroke, 1);
        this.highlight.setAlpha(0.28);
      }
    };
    const handleOut = (): void => {
      this.background.setFillStyle(this.fill, this.disabled ? 0.38 : 0.96);
      this.background.setStrokeStyle(
        this.selected ? 3 : 2,
        this.stroke,
        this.disabled ? 0.22 : 0.9
      );
      this.highlight.setAlpha(this.disabled ? 0.04 : this.selected ? 0.24 : 0.14);
    };
    const handleDown = (): void => {
      if (!this.disabled) {
        this.scene.tweens.add({
          targets: this,
          scaleX: 0.985,
          scaleY: 0.985,
          duration: 42,
          yoyo: true
        });
        onClick();
      }
    };

    this.background.setInteractive({ useHandCursor: !this.disabled });
    this.background.on('pointerover', handleOver);
    this.background.on('pointerout', handleOut);
    this.background.on('pointerdown', handleDown);
    this.on('pointerover', handleOver);
    this.on('pointerout', handleOut);
    this.on('pointerdown', handleDown);

    scene.add.existing(this);
  }

  public setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    this.background.setAlpha(disabled ? 0.42 : 1);
    this.labelText.setAlpha(disabled ? 0.5 : 1);
    this.highlight.setAlpha(disabled ? 0.04 : this.selected ? 0.24 : 0.14);
    this.background.setFillStyle(this.fill, disabled ? 0.38 : 0.96);
    this.background.setStrokeStyle(this.selected ? 3 : 2, this.stroke, disabled ? 0.22 : 0.9);
    if (this.input) {
      this.input.cursor = disabled ? 'default' : 'pointer';
    }
  }

  private resolveStyle(options: ButtonOptions): {
    fill: number;
    hoverFill: number;
    stroke: number;
    textColor: string;
  } {
    if (options.selected) {
      return {
        fill: 0x5a4808,
        hoverFill: 0x7a620d,
        stroke: 0xffd31a,
        textColor: '#f4f7fb'
      };
    }

    switch (options.variant ?? 'primary') {
      case 'secondary':
        return {
          fill: 0x211c10,
          hoverFill: 0x362b12,
          stroke: 0xffd31a,
          textColor: '#f4f7fb'
        };
      case 'danger':
        return {
          fill: 0x351d1d,
          hoverFill: 0x522828,
          stroke: 0xff6d5f,
          textColor: '#fff4f4'
        };
      case 'ghost':
        return {
          fill: 0x151515,
          hoverFill: 0x262015,
          stroke: 0x7d6600,
          textColor: '#f4c95d'
        };
      case 'primary':
      default:
        return {
          fill: 0x4f300f,
          hoverFill: 0x704416,
          stroke: 0xff8a3d,
          textColor: '#f4f7fb'
        };
    }
  }

  private fitLabel(width: number, height: number): void {
    const maxWidth = width - 22;
    const maxHeight = height - 16;
    const scale = Math.min(1, maxWidth / this.labelText.width, maxHeight / this.labelText.height);

    if (Number.isFinite(scale) && scale < 1) {
      this.labelText.setScale(Math.max(0.72, scale));
    }
  }
}
