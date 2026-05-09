import Phaser from 'phaser';
import { TOKENS } from '../config/designTokens';
import type { ThemeDefinition } from '../config/themeConfig';
import type { TablerIconName } from './icons';
import { getTablerIconTextureKey } from './icons';
import { RoundedRect } from './roundedShapes';

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
  icon?: TablerIconName;
  theme?: ThemeDefinition;
}

interface ResolvedStyle {
  fill: number;
  hoverFill: number;
  stroke: number;
  textColor: string;
}

export class Button extends Phaser.GameObjects.Container {
  public readonly icon?: TablerIconName;
  private readonly shadow: RoundedRect;
  private readonly background: RoundedRect;
  private readonly highlight: Phaser.GameObjects.Rectangle;
  private readonly iconImage?: Phaser.GameObjects.Image;
  private readonly labelText: Phaser.GameObjects.Text;
  private readonly hitTarget: Phaser.GameObjects.Zone;
  private disabled: boolean;
  private readonly fill: number;
  private readonly hoverFill: number;
  private readonly stroke: number;
  private readonly selected: boolean;
  private readonly widthValue: number;
  private readonly heightValue: number;

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

    this.icon = options.icon;
    this.disabled = options.disabled ?? false;
    this.selected = options.selected ?? false;
    this.widthValue = width;
    this.heightValue = height;
    const style = this.resolveStyle(options);
    this.fill = options.fill ?? style.fill;
    this.hoverFill = options.hoverFill ?? style.hoverFill;
    this.stroke = options.stroke ?? style.stroke;
    const textColor = options.textColor ?? style.textColor;
    const radius = TOKENS.radius.sm;

    this.shadow = new RoundedRect(scene, width, height, radius, {
      fill: { color: 0x000000, alpha: this.disabled ? 0.12 : 0.32 }
    });
    this.shadow.setPosition(0, 6);

    this.background = new RoundedRect(scene, width, height, radius, {
      fill: { color: this.fill, alpha: this.disabled ? 0.4 : 0.97 },
      stroke: {
        color: this.stroke,
        width: this.selected ? 3 : 2,
        alpha: this.disabled ? 0.22 : 0.92
      }
    });

    this.highlight = scene.add
      .rectangle(
        0,
        -height / 2 + 6,
        width - 18,
        Math.min(4, Math.max(2, height - 14)),
        0xffffff,
        0.16
      )
      .setAlpha(this.disabled ? 0.04 : this.selected ? 0.24 : 0.14);

    if (options.icon) {
      const iconKey = getTablerIconTextureKey(options.icon);

      if (scene.textures.exists(iconKey)) {
        this.iconImage = scene.add
          .image(-width / 2 + Math.max(36, height * 0.48), 0, iconKey)
          .setDisplaySize(Math.round(height * 0.34), Math.round(height * 0.34))
          .setTint(Number.parseInt(textColor.replace('#', ''), 16))
          .setAlpha(this.disabled ? 0.45 : 0.95);
      }
    }

    this.labelText = scene.add
      .text(this.iconImage ? Math.max(18, height * 0.18) : 0, 0, label, {
        fontFamily: TOKENS.font.family,
        fontSize: `${Math.max(options.compact ? 20 : 24, Math.round(height * 0.34))}px`,
        fontStyle: '800',
        color: textColor,
        align: 'center'
      })
      .setOrigin(0.5)
      .setShadow(0, 2, '#000814', 3, false, true);
    this.fitLabel(width, height);

    const children: Phaser.GameObjects.GameObject[] = [
      this.shadow,
      this.background,
      this.highlight,
      this.labelText
    ];

    if (this.iconImage) {
      children.splice(3, 0, this.iconImage);
    }

    this.hitTarget = scene.add
      .zone(0, 4, width + 16, height + 18)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: !this.disabled });

    children.push(this.hitTarget);
    this.add(children);
    this.setSize(width, height);

    const handleOver = (): void => {
      if (!this.disabled) {
        this.background.setStyles({
          fill: { color: this.hoverFill, alpha: 1 },
          stroke: { color: this.stroke, width: 3, alpha: 1 }
        });
        this.highlight.setAlpha(0.28);
      }
    };
    const handleOut = (): void => {
      this.background.setStyles({
        fill: { color: this.fill, alpha: this.disabled ? 0.4 : 0.97 },
        stroke: {
          color: this.stroke,
          width: this.selected ? 3 : 2,
          alpha: this.disabled ? 0.22 : 0.92
        }
      });
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

    this.on('pointerover', handleOver);
    this.on('pointerout', handleOut);
    this.on('pointerdown', handleDown);
    this.hitTarget.on('pointerover', handleOver);
    this.hitTarget.on('pointerout', handleOut);
    this.hitTarget.on('pointerdown', handleDown);

    scene.add.existing(this);
  }

  public override destroy(fromScene?: boolean): void {
    this.off('pointerover');
    this.off('pointerout');
    this.off('pointerdown');
    this.hitTarget.off('pointerover');
    this.hitTarget.off('pointerout');
    this.hitTarget.off('pointerdown');
    super.destroy(fromScene);
  }

  public setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    this.background.setStyles({
      fill: { color: this.fill, alpha: disabled ? 0.4 : 0.97 },
      stroke: {
        color: this.stroke,
        width: this.selected ? 3 : 2,
        alpha: disabled ? 0.22 : 0.92
      }
    });
    this.background.setAlpha(disabled ? 0.95 : 1);
    this.labelText.setAlpha(disabled ? 0.5 : 1);
    this.iconImage?.setAlpha(disabled ? 0.45 : 0.95);
    this.highlight.setAlpha(disabled ? 0.04 : this.selected ? 0.24 : 0.14);
    if (this.hitTarget.input) {
      this.hitTarget.input.cursor = disabled ? 'default' : 'pointer';
    }
  }

  private resolveStyle(options: ButtonOptions): ResolvedStyle {
    const theme = options.theme;

    if (options.selected) {
      return {
        fill: 0x5a4808,
        hoverFill: 0x7a620d,
        stroke: theme?.primary ?? 0xffd31a,
        textColor: theme?.text ?? '#f4f7fb'
      };
    }

    switch (options.variant ?? 'primary') {
      case 'secondary':
        return {
          fill: 0x211c10,
          hoverFill: 0x362b12,
          stroke: theme?.primary ?? 0xffd31a,
          textColor: theme?.text ?? '#f4f7fb'
        };
      case 'danger':
        return {
          fill: 0x351d1d,
          hoverFill: 0x522828,
          stroke: theme?.danger ?? 0xff6d5f,
          textColor: '#fff4f4'
        };
      case 'ghost':
        return {
          fill: 0x151515,
          hoverFill: 0x262015,
          stroke: theme?.borderDim ?? 0x7d6600,
          textColor:
            theme?.accent !== undefined
              ? `#${theme.accent.toString(16).padStart(6, '0')}`
              : '#f4c95d'
        };
      case 'primary':
      default:
        return {
          fill: 0x4f300f,
          hoverFill: 0x704416,
          stroke: theme?.secondary ?? 0xff8a3d,
          textColor: theme?.text ?? '#f4f7fb'
        };
    }
  }

  private fitLabel(width: number, height: number): void {
    const maxWidth = width - (this.iconImage ? Math.max(90, height * 0.86) : 22);
    const maxHeight = height - 16;
    const scale = Math.min(1, maxWidth / this.labelText.width, maxHeight / this.labelText.height);

    if (Number.isFinite(scale) && scale < 1) {
      this.labelText.setScale(Math.max(0.72, scale));
    }
  }
}
