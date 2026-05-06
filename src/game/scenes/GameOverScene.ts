import Phaser from 'phaser';
import { getTheme } from '../config/themeConfig';
import { SaveSystem } from '../systems/SaveSystem';
import { Button } from '../ui/Button';
import { addCreatorCredit, drawPanel, drawScreenBackground } from '../ui/sceneChrome';
import { WORLD_WIDTH } from '../utils/constants';

interface EndSceneData {
  score?: number;
  levelIndex?: number;
  source?: 'campaign' | 'creative';
  editorReturn?: {
    mode: 'creative' | 'admin';
    slotIndex: number;
  };
}

export class GameOverScene extends Phaser.Scene {
  public constructor() {
    super('GameOverScene');
  }

  public create(data: EndSceneData): void {
    const score = data.score ?? 0;
    const levelIndex = data.levelIndex ?? 0;
    const source = data.source ?? 'campaign';
    const editorReturn = data.editorReturn;
    const save = new SaveSystem();
    const theme = getTheme(save.snapshot().preferences.themeId);

    drawScreenBackground(this, theme, { panel: false, sideRails: true });
    drawPanel(this, WORLD_WIDTH / 2, 880, 752, 832, theme, { alpha: 0.78 });

    this.add
      .text(WORLD_WIDTH / 2, 510, 'GAME OVER', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '104px',
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
        color: `#${theme.danger.toString(16).padStart(6, '0')}`
      })
      .setOrigin(0.5);

    new Button(
      this,
      WORLD_WIDTH / 2,
      900,
      620,
      104,
      editorReturn ? 'BACK TO EDITOR' : 'RESTART',
      () => {
        if (editorReturn) {
          this.scene.start('LevelEditorScene', editorReturn);
          return;
        }

        this.scene.start('GameScene', { levelIndex, source });
      }
    );

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
