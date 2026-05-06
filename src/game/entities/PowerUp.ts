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
  public readonly definition: PowerUpDefinition;

  public constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    public readonly powerUpType: PowerUpType,
    public readonly sourceBall?: Ball
  ) {
    const definition = getPowerUpDefinition(powerUpType);
    super(scene, x, y, POWER_UP_RADIUS, 0, 360, false, definition.color, 1);

    this.definition = definition;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(DEPTHS.powerUps);
    this.setStrokeStyle(powerUpType === 'widePaddle' ? 2 : 3, 0xf3fbff, 0.88);

    this.label = scene.add
      .text(x, y, definition.label, {
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
  }

  public get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  public syncLabel(): void {
    this.label.setPosition(this.x, this.y);
  }

  public override destroy(fromScene?: boolean): void {
    this.label.destroy(fromScene);
    super.destroy(fromScene);
  }
}
