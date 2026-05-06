import Phaser from 'phaser';

const SPARK_TEXTURE = 'forge-spark';
const EMBER_TEXTURE = 'forge-ember';
const SHARD_TEXTURE = 'forge-shard';

export class BootScene extends Phaser.Scene {
  public constructor() {
    super('BootScene');
  }

  public create(): void {
    this.generateProceduralTextures();
    this.scene.start('PreloadScene');
  }

  private generateProceduralTextures(): void {
    if (!this.textures.exists(SPARK_TEXTURE)) {
      const sparkSize = 12;
      const spark = this.add.graphics({ x: 0, y: 0 });
      spark.fillStyle(0xffffff, 1);
      spark.fillCircle(sparkSize / 2, sparkSize / 2, sparkSize / 2);
      spark.generateTexture(SPARK_TEXTURE, sparkSize, sparkSize);
      spark.destroy();
    }

    if (!this.textures.exists(EMBER_TEXTURE)) {
      const emberSize = 16;
      const ember = this.add.graphics({ x: 0, y: 0 });
      ember.fillStyle(0xffffff, 0.55);
      ember.fillCircle(emberSize / 2, emberSize / 2, emberSize / 2);
      ember.fillStyle(0xffffff, 1);
      ember.fillCircle(emberSize / 2, emberSize / 2, emberSize / 4);
      ember.generateTexture(EMBER_TEXTURE, emberSize, emberSize);
      ember.destroy();
    }

    if (!this.textures.exists(SHARD_TEXTURE)) {
      const shardW = 7;
      const shardH = 7;
      const shard = this.add.graphics({ x: 0, y: 0 });
      shard.fillStyle(0xffffff, 1);
      shard.fillRect(0, 0, shardW, shardH);
      shard.generateTexture(SHARD_TEXTURE, shardW, shardH);
      shard.destroy();
    }
  }
}
