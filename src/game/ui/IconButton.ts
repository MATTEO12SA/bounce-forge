import Phaser from 'phaser';
import type { TablerIconName } from './icons';
import { getTablerIconTextureKey } from './icons';
import { Tooltip } from './Tooltip';

type IconButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface IconButtonOptions {
  variant?: IconButtonVariant;
  disabled?: boolean;
  selected?: boolean;
  tooltip?: string;
  label?: string;
  fill?: number;
  hoverFill?: number;
  stroke?: number;
  iconTint?: number;
  textColor?: string;
}

interface IconButtonStyle {
  fill: number;
  hoverFill: number;
  stroke: number;
  textColor: string;
}

export function resolveIconButtonStyle(
  variant: IconButtonVariant = 'primary',
  selected = false
): IconButtonStyle {
  if (selected) {
    return {
      fill: 0x5a4808,
      hoverFill: 0x7a620d,
      stroke: 0xffd31a,
      textColor: '#f4f7fb'
    };
  }

  switch (variant) {
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

function colorStringToNumber(value: string): number {
  return Number.parseInt(value.replace('#', ''), 16);
}

export class IconButton extends Phaser.GameObjects.Container {
  public readonly icon: TablerIconName;
  public readonly buttonLabel: string;
  private readonly background: Phaser.GameObjects.Rectangle;
  private readonly highlight: Phaser.GameObjects.Rectangle;
  private readonly tooltip?: Tooltip;
  private readonly disabled: boolean;
  private readonly fill: number;
  private readonly hoverFill: number;
  private readonly stroke: number;
  private readonly hitTarget: Phaser.GameObjects.Zone;

  public constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    size: number,
    icon: TablerIconName,
    onClick: () => void,
    options: IconButtonOptions = {}
  ) {
    super(scene, x, y);
    this.icon = icon;
    this.buttonLabel = options.label ?? options.tooltip ?? icon;
    this.disabled = options.disabled ?? false;
    const style = resolveIconButtonStyle(options.variant, options.selected);
    this.fill = options.fill ?? style.fill;
    this.hoverFill = options.hoverFill ?? style.hoverFill;
    this.stroke = options.stroke ?? style.stroke;
    const textColor = options.textColor ?? style.textColor;

    const shadow = scene.add.rectangle(0, 5, size, size, 0x000000, this.disabled ? 0.1 : 0.24);
    this.background = scene.add
      .rectangle(0, 0, size, size, this.fill, this.disabled ? 0.38 : 0.96)
      .setStrokeStyle(options.selected ? 3 : 2, this.stroke, this.disabled ? 0.22 : 0.9);
    this.highlight = scene.add
      .rectangle(0, -size / 2 + 5, size - 14, 4, 0xffffff, 0.15)
      .setAlpha(this.disabled ? 0.04 : options.selected ? 0.24 : 0.14);

    const iconKey = getTablerIconTextureKey(icon);
    const iconObject = scene.textures.exists(iconKey)
      ? scene.add
          .image(0, 0, iconKey)
          .setDisplaySize(Math.round(size * 0.46), Math.round(size * 0.46))
          .setTint(options.iconTint ?? colorStringToNumber(textColor))
      : scene.add
          .text(0, 0, '?', {
            fontFamily: 'Arial, sans-serif',
            fontSize: `${Math.round(size * 0.34)}px`,
            fontStyle: '900',
            color: textColor
          })
          .setOrigin(0.5);

    const children: Phaser.GameObjects.GameObject[] = [
      shadow,
      this.background,
      this.highlight,
      iconObject
    ];

    if (options.label) {
      const label = scene.add
        .text(0, size / 2 + 22, options.label, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '18px',
          fontStyle: '900',
          color: textColor,
          align: 'center'
        })
        .setOrigin(0.5)
        .setShadow(0, 2, '#000814', 2, false, true);
      children.push(label);
    }

    const hitHeight = options.label ? size + 58 : size + 18;
    const hitY = options.label ? 20 : 4;
    this.hitTarget = scene.add
      .zone(0, hitY, size + 18, hitHeight)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: !this.disabled });

    children.push(this.hitTarget);
    this.add(children);
    this.setSize(size, size);

    if (options.tooltip) {
      this.tooltip = new Tooltip(scene);
    }

    const handleOver = (): void => {
      if (this.disabled) {
        return;
      }
      this.background.setFillStyle(this.hoverFill, 1);
      this.background.setStrokeStyle(3, this.stroke, 1);
      this.highlight.setAlpha(0.28);
      this.tooltip?.show(options.tooltip ?? '', this.x, this.y - size / 2 - 28);
    };
    const handleOut = (): void => {
      this.background.setFillStyle(this.fill, this.disabled ? 0.38 : 0.96);
      this.background.setStrokeStyle(
        options.selected ? 3 : 2,
        this.stroke,
        this.disabled ? 0.22 : 0.9
      );
      this.highlight.setAlpha(this.disabled ? 0.04 : options.selected ? 0.24 : 0.14);
      this.tooltip?.hide();
    };
    const handleDown = (): void => {
      if (this.disabled) {
        return;
      }
      scene.tweens.add({
        targets: this,
        scaleX: 0.96,
        scaleY: 0.96,
        duration: 42,
        yoyo: true
      });
      onClick();
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
    this.hitTarget.off('pointerover');
    this.hitTarget.off('pointerout');
    this.hitTarget.off('pointerdown');
    this.tooltip?.destroy();
    super.destroy(fromScene);
  }
}
