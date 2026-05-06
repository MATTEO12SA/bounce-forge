import Phaser from 'phaser';
import { getTheme } from '../config/themeConfig';
import { SaveSystem } from '../systems/SaveSystem';
import { Button } from '../ui/Button';
import { drawPanel } from '../ui/sceneChrome';
import { DEPTHS, WORLD_HEIGHT, WORLD_WIDTH } from '../utils/constants';

interface PauseSceneData {
  levelIndex?: number;
}

export class PauseScene extends Phaser.Scene {
  private levelIndex = 0;

  public constructor() {
    super('PauseScene');
  }

  public create(data: PauseSceneData): void {
    this.levelIndex = data.levelIndex ?? 0;
    const save = new SaveSystem();
    const theme = getTheme(save.snapshot().preferences.themeId);

    this.add
      .rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, 0x02070c, 0.78)
      .setDepth(DEPTHS.overlay);
    drawPanel(this, WORLD_WIDTH / 2, 770, 734, 610, theme, {
      depth: DEPTHS.overlay + 1,
      alpha: 0.92
    });

    this.add
      .text(WORLD_WIDTH / 2, 480, 'PAUSED', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '104px',
        fontStyle: '900',
        color: theme.text
      })
      .setOrigin(0.5)
      .setDepth(DEPTHS.overlay + 2)
      .setShadow(0, 4, '#000814', 8, false, true);

    new Button(this, WORLD_WIDTH / 2, 640, 620, 104, 'RESUME', () => {
      this.scene.resume('GameScene');
      this.scene.stop();
    }).setDepth(DEPTHS.overlay + 2);

    new Button(
      this,
      WORLD_WIDTH / 2,
      770,
      620,
      104,
      'RESTART',
      () => {
        this.scene.stop('GameScene');
        this.scene.start('GameScene', { levelIndex: this.levelIndex });
      },
      { variant: 'secondary' }
    ).setDepth(DEPTHS.overlay + 2);

    new Button(
      this,
      WORLD_WIDTH / 2,
      900,
      620,
      104,
      'OPTIONS',
      () => {
        this.scene.stop('GameScene');
        this.scene.start('OptionsScene', { returnTo: 'MainMenuScene' });
      },
      { variant: 'ghost' }
    ).setDepth(DEPTHS.overlay + 2);

    new Button(
      this,
      WORLD_WIDTH / 2,
      1030,
      620,
      104,
      'MENU',
      () => {
        this.scene.stop('GameScene');
        this.scene.start('MainMenuScene');
      },
      { variant: 'ghost' }
    ).setDepth(DEPTHS.overlay + 2);
  }
}
