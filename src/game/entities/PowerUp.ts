import Phaser from 'phaser';
import { DEPTHS, POWER_UP_DROP_SPEED } from '../utils/constants';
import {
  getPowerUpDefinition,
  type PowerUpDefinition,
  type PowerUpType
} from '../systems/PowerUpSystem';
import type { Ball } from './Ball';

export const POWER_UP_RADIUS = 30;

export class PowerUp extends Phaser.GameObjects.Arc {
  private readonly label: Phaser.GameObjects.Text;
  private currentDefinition: PowerUpDefinition;
  private currentType: PowerUpType;
  private currentSourceBall: Ball | undefined;

  public constructor(scene: Phaser.Scene, x = 0, y = 0) {
    const fallbackDefinition = getPowerUpDefinition('multiBall');
    super(scene, x, y, POWER_UP_RADIUS, 0, 360, false, fallbackDefinition.color, 1);

    this.currentDefinition = fallbackDefinition;
    this.currentType = 'multiBall';
    this.currentSourceBall = undefined;

    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(DEPTHS.powerUps);
    this.setStrokeStyle(3, 0xf3fbff, 0.88);

    this.label = scene.add
      .text(x, y, fallbackDefinition.label, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '24px',
        fontStyle: '900',
        color: '#061016'
      })
      .setOrigin(0.5)
      .setDepth(DEPTHS.powerUps + 1);

    const body = this.arcadeBody;
    body.setAllowGravity(false);
    body.setCircle(POWER_UP_RADIUS);
    body.setVelocity(0, POWER_UP_DROP_SPEED);

    this.setActive(false);
    this.setVisible(false);
    this.label.setActive(false);
    this.label.setVisible(false);
  }

  public get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  public get powerUpType(): PowerUpType {
    return this.currentType;
  }

  public get sourceBall(): Ball | undefined {
    return this.currentSourceBall;
  }

  public get definition(): PowerUpDefinition {
    return this.currentDefinition;
  }

  public reset(x: number, y: number, type: PowerUpType, sourceBall?: Ball): void {
    const definition = getPowerUpDefinition(type);
    this.currentDefinition = definition;
    this.currentType = type;
    this.currentSourceBall = sourceBall;

    this.setActive(true);
    this.setVisible(true);
    this.setPosition(x, y);
    this.setFillStyle(definition.color, 1);
    this.setStrokeStyle(type === 'widePaddle' ? 2 : 3, 0xf3fbff, 0.88);
    this.setScale(1);
    this.setAlpha(1);

    this.label.setText(definition.label);
    this.label.setActive(true);
    this.label.setVisible(true);
    this.label.setPosition(x, y);
    this.label.setScale(1);
    this.label.setAlpha(1);

    const body = this.arcadeBody;
    body.enable = true;
    body.reset(x, y);
    body.setVelocity(0, POWER_UP_DROP_SPEED);
  }

  public disable(): void {
    this.setActive(false);
    this.setVisible(false);
    this.label.setActive(false);
    this.label.setVisible(false);
    const body = this.arcadeBody;
    body.setVelocity(0, 0);
    body.enable = false;
    this.currentSourceBall = undefined;
  }

  public syncLabel(): void {
    this.label.setPosition(this.x, this.y);
    this.label.setScale(this.scaleX, this.scaleY);
  }

  public override destroy(fromScene?: boolean): void {
    this.label.destroy(fromScene);
    super.destroy(fromScene);
  }
}
