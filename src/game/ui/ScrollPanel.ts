import Phaser from 'phaser';
import { TOKENS } from '../config/designTokens';
import type { ThemeDefinition } from '../config/themeConfig';
import { clampScrollOffset, getScrollContentHeight } from './controlUtils';
import { RoundedRect } from './roundedShapes';

export interface ScrollPanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScrollPanelOptions<T> {
  itemHeight: number;
  theme?: ThemeDefinition;
  gap?: number;
  renderItem: (
    scene: Phaser.Scene,
    item: T,
    index: number,
    width: number
  ) => Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[];
}

export class ScrollPanel<T> extends Phaser.GameObjects.Container {
  private readonly content: Phaser.GameObjects.Container;
  private readonly viewportHeight: number;
  private readonly contentHeight: number;
  private scrollOffset = 0;

  public constructor(
    scene: Phaser.Scene,
    bounds: ScrollPanelBounds,
    items: readonly T[],
    options: ScrollPanelOptions<T>
  ) {
    super(scene, bounds.x, bounds.y);
    this.viewportHeight = bounds.height;
    this.contentHeight = getScrollContentHeight(items.length, options.itemHeight, options.gap);
    const theme = options.theme;

    const frame = new RoundedRect(scene, bounds.width, bounds.height, TOKENS.radius.md, {
      fill: { color: theme?.panelStrong ?? 0x111111, alpha: 0.18 },
      stroke: { color: theme?.borderDim ?? 0x7d6600, width: 2, alpha: 0.58 }
    });
    this.content = scene.add.container(-bounds.width / 2, -bounds.height / 2);

    items.forEach((item, index) => {
      const y = index * (options.itemHeight + (options.gap ?? 0));
      const rendered = options.renderItem(scene, item, index, bounds.width);
      const children = Array.isArray(rendered) ? rendered : [rendered];

      children.forEach((child) => {
        const display = child as unknown as { x: number; y: number };
        display.x += bounds.width / 2;
        display.y += y + options.itemHeight / 2;
        this.content.add(child);
      });
    });

    this.add([frame, this.content]);
    this.setSize(bounds.width, bounds.height);
    this.setInteractive(
      new Phaser.Geom.Rectangle(-bounds.width / 2, -bounds.height / 2, bounds.width, bounds.height),
      Phaser.Geom.Rectangle.Contains
    );
    this.on('wheel', (_pointer: Phaser.Input.Pointer, _dx: number, dy: number) => {
      this.setScrollOffset(this.scrollOffset + dy * 0.55);
    });

    scene.add.existing(this);
  }

  public setScrollOffset(offset: number): void {
    this.scrollOffset = clampScrollOffset(offset, this.contentHeight, this.viewportHeight);
    this.content.setY(-this.viewportHeight / 2 - this.scrollOffset);
  }

  public override destroy(fromScene?: boolean): void {
    super.destroy(fromScene);
  }
}
