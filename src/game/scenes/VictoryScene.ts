import Phaser from 'phaser';
import { getTheme } from '../config/themeConfig';
import { LevelSystem } from '../systems/LevelSystem';
import type { LevelMedal } from '../systems/SaveSystem';
import { SaveSystem } from '../systems/SaveSystem';
import { Button } from '../ui/Button';
import { addCreatorCredit, drawPanel, drawScreenBackground } from '../ui/sceneChrome';
import { startSceneWithTransition } from '../ui/uiFeedback';
import { WORLD_WIDTH } from '../utils/constants';

interface EndSceneData {
  score?: number;
  levelIndex?: number;
  medal?: LevelMedal;
  editorReturn?: {
    mode: 'creative' | 'admin';
    slotIndex: number;
  };
}

export class VictoryScene extends Phaser.Scene {
  public constructor() {
    super('VictoryScene');
  }

  public create(data: EndSceneData): void {
    const score = data.score ?? 0;
    const levelIndex = data.levelIndex ?? 0;
    const medal = data.medal ?? 'bronze';
    const editorReturn = data.editorReturn;
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
        color: `#${theme.accent.toString(16).padStart(6, '0')}`
      })
      .setOrigin(0.5);

    new Button(
      this,
      WORLD_WIDTH / 2,
      900,
      620,
      104,
      editorReturn ? 'BACK TO EDITOR' : hasNext ? 'NEXT LEVEL' : 'RESTART',
      () => {
        if (editorReturn) {
          startSceneWithTransition(this, 'LevelEditorScene', editorReturn);
          return;
        }

        startSceneWithTransition(this, 'GameScene', {
          levelIndex: hasNext ? levelIndex + 1 : levelIndex
        });
      },
      { icon: editorReturn ? 'palette' : hasNext ? 'player-track-next' : 'rotate-clockwise', theme }
    );

    new Button(
      this,
      WORLD_WIDTH / 2,
      1040,
      620,
      104,
      'LEVEL SELECT',
      () => {
        startSceneWithTransition(this, 'LevelSelectScene');
      },
      { variant: 'secondary', icon: 'player-track-next', theme }
    );

    new Button(
      this,
      WORLD_WIDTH / 2,
      1180,
      620,
      104,
      'MENU',
      () => {
        startSceneWithTransition(this, 'MainMenuScene');
      },
      { variant: 'ghost', icon: 'home', theme }
    );

    addCreatorCredit(this, theme);
  }
}
