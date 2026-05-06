import Phaser from 'phaser';
import { getTheme } from '../config/themeConfig';
import { LevelSystem } from '../systems/LevelSystem';
import { SaveSystem } from '../systems/SaveSystem';
import { Button } from '../ui/Button';
import { addCreatorCredit, drawPanel, drawScreenBackground } from '../ui/sceneChrome';
import { WORLD_WIDTH } from '../utils/constants';

interface EndSceneData {
  score?: number;
  levelIndex?: number;
  medal?: string;
}

export class VictoryScene extends Phaser.Scene {
  public constructor() {
    super('VictoryScene');
  }

  public create(data: EndSceneData): void {
    const score = data.score ?? 0;
    const levelIndex = data.levelIndex ?? 0;
    const medal = data.medal ?? 'bronze';
    const save = new SaveSystem();
    const theme = getTheme(save.snapshot().preferences.themeId);
    const levelSystem = new LevelSystem();
    const hasNext = levelSystem.hasNext(levelIndex);

    drawScreenBackground(this, theme, { panel: false, sideRails: true });
    drawPanel(this, WORLD_WIDTH / 2, 880, 752, 832, theme, { alpha: 0.78 });

    this.add
      .text(WORLD_WIDTH / 2, 510, 'VICTORY', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '112px',
        fontStyle: '900',
        color: theme.text
      })
      .setOrigin(0.5)
      .setShadow(0, 4, '#000814', 8, false, true);

    this.add
      .text(WORLD_WIDTH / 2, 680, `SCORE ${score}`, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '54px',
        fontStyle: '900',
        color: `#${theme.accent.toString(16).padStart(6, '0')}`
      })
      .setOrigin(0.5);

    this.add
      .text(WORLD_WIDTH / 2, 760, `MEDAL ${medal.toUpperCase()}`, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '34px',
        fontStyle: '900',
        color: '#f4c95d'
      })
      .setOrigin(0.5);

    new Button(this, WORLD_WIDTH / 2, 900, 620, 104, hasNext ? 'NEXT LEVEL' : 'RESTART', () => {
      this.scene.start('GameScene', { levelIndex: hasNext ? levelIndex + 1 : levelIndex });
    });

    new Button(
      this,
      WORLD_WIDTH / 2,
      1040,
      620,
      104,
      'LEVEL SELECT',
      () => {
        this.scene.start('LevelSelectScene');
      },
      { variant: 'secondary' }
    );

    new Button(
      this,
      WORLD_WIDTH / 2,
      1180,
      620,
      104,
      'MENU',
      () => {
        this.scene.start('MainMenuScene');
      },
      { variant: 'ghost' }
    );

    addCreatorCredit(this, theme);
  }
}
