import Phaser from 'phaser';
import { ensurePowerUpTexture, POWER_UP_SIZE } from '../render/textures';
import { getPowerUpDefinition, type PowerUpType } from '../systems/PowerUpSystem';
import { DEPTHS, POWER_UP_DROP_SPEED } from '../utils/constants';
import type { Ball } from './Ball';

/** Collision half-size of a capsule (smaller than the glowing texture). */
export const POWER_UP_HALF_WIDTH = (POWER_UP_SIZE.width - 20) / 2;
export const POWER_UP_HALF_HEIGHT = (POWER_UP_SIZE.height - 16) / 2;

/** A falling capsule. Motion (fall, sway, separation) is driven by GameScene. */
export class PowerUp extends Phaser.GameObjects.Image {
  public vy = POWER_UP_DROP_SPEED;
  public swayPhase = 0;
  private currentType: PowerUpType = 'multiBall';
  private currentSourceBall: Ball | undefined;

  public constructor(scene: Phaser.Scene) {
    super(
      scene,
      0,
      0,
      ensurePowerUpTexture(scene, 'multiBall', getPowerUpDefinition('multiBall').color)
    );
    this.setDisplaySize(POWER_UP_SIZE.width, POWER_UP_SIZE.height);
    this.setDepth(DEPTHS.powerUps);
    scene.add.existing(this);
    this.setActive(false).setVisible(false);
  }

  public get powerUpType(): PowerUpType {
    return this.currentType;
  }

  public get sourceBall(): Ball | undefined {
    return this.currentSourceBall;
  }

  public reset(x: number, y: number, type: PowerUpType, sourceBall?: Ball): void {
    this.currentType = type;
    this.currentSourceBall = sourceBall;
    this.setTexture(ensurePowerUpTexture(this.scene, type, getPowerUpDefinition(type).color));
    this.setDisplaySize(POWER_UP_SIZE.width, POWER_UP_SIZE.height);
    this.setPosition(x, y).setActive(true).setVisible(true).setAlpha(1).setRotation(0);
    this.vy = POWER_UP_DROP_SPEED * 0.55;
    this.swayPhase = Math.random() * Math.PI * 2;
  }

  public disable(): void {
    this.setActive(false).setVisible(false);
    this.currentSourceBall = undefined;
  }
}
