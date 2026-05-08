import Phaser from 'phaser';

export interface RoundedRectFill {
  color: number;
  alpha?: number;
}

export interface RoundedRectStroke {
  color: number;
  width?: number;
  alpha?: number;
}

export interface RoundedRectOptions {
  fill?: RoundedRectFill;
  stroke?: RoundedRectStroke;
}

export class RoundedRect extends Phaser.GameObjects.Graphics {
  private widthValue: number;
  private heightValue: number;
  private radius: number;
  private currentFill?: RoundedRectFill;
  private currentStroke?: RoundedRectStroke;

  public constructor(
    scene: Phaser.Scene,
    width: number,
    height: number,
    radius: number,
    options: RoundedRectOptions = {}
  ) {
    super(scene);
    this.widthValue = width;
    this.heightValue = height;
    this.radius = radius;
    this.currentFill = options.fill;
    this.currentStroke = options.stroke;
    this.redraw();
    scene.add.existing(this);
  }

  public setStyles(options: RoundedRectOptions): void {
    if (options.fill !== undefined) {
      this.currentFill = options.fill;
    }
    if (options.stroke !== undefined) {
      this.currentStroke = options.stroke;
    }
    this.redraw();
  }

  public resize(width: number, height: number, radius?: number): void {
    this.widthValue = width;
    this.heightValue = height;
    if (typeof radius === 'number') {
      this.radius = radius;
    }
    this.redraw();
  }

  public override setAlpha(value: number): this {
    super.setAlpha(value);
    return this;
  }

  private redraw(): void {
    this.clear();
    const halfW = this.widthValue / 2;
    const halfH = this.heightValue / 2;
    const r = Math.min(this.radius, halfW, halfH);
    if (this.currentFill) {
      this.fillStyle(this.currentFill.color, this.currentFill.alpha ?? 1);
      this.fillRoundedRect(-halfW, -halfH, this.widthValue, this.heightValue, r);
    }
    if (this.currentStroke) {
      this.lineStyle(
        this.currentStroke.width ?? 2,
        this.currentStroke.color,
        this.currentStroke.alpha ?? 1
      );
      this.strokeRoundedRect(-halfW, -halfH, this.widthValue, this.heightValue, r);
    }
  }
}

export function drawRoundedRect(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  options: RoundedRectOptions = {}
): RoundedRect {
  const shape = new RoundedRect(scene, width, height, radius, options);
  shape.setPosition(x, y);
  return shape;
}
