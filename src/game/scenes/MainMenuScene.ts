import Phaser from 'phaser';
import { getTheme, THEMES } from '../config/themeConfig';
import { AdminApiSystem } from '../systems/AdminApiSystem';
import { LevelSystem } from '../systems/LevelSystem';
import { SaveSystem } from '../systems/SaveSystem';
import { Button } from '../ui/Button';
import { addCreatorCredit, drawPanel, drawScreenBackground } from '../ui/sceneChrome';
import { startSceneWithTransition } from '../ui/uiFeedback';
import { GAME_TITLE, WORLD_WIDTH } from '../utils/constants';
import { clamp } from '../utils/math';

export class MainMenuScene extends Phaser.Scene {
  private readonly adminApi = new AdminApiSystem();
  private adminButton?: Button;
  private adminSessionRequestId = 0;

  public constructor() {
    super('MainMenuScene');
  }

  public create(): void {
    const save = new SaveSystem();
    const saveData = save.snapshot();
    const theme = getTheme(saveData.preferences.themeId);
    const levelSystem = new LevelSystem();
    const nextLevel = Math.floor(clamp(saveData.unlockedLevel, 0, levelSystem.count - 1));

    drawScreenBackground(this, theme, { panel: false, sideRails: true });
    drawPanel(this, WORLD_WIDTH / 2, 600, 746, 1060, theme, { alpha: 0.76 });

    this.renderAdminButton('ADMIN', () => startSceneWithTransition(this, 'AdminLoginScene'));
    void this.refreshAdminButton();

    this.add
      .text(WORLD_WIDTH / 2, 132, GAME_TITLE, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '90px',
        fontStyle: '900',
        color: theme.text
      })
      .setOrigin(0.5)
      .setShadow(0, 4, '#000814', 8, false, true);

    this.add
      .text(WORLD_WIDTH / 2, 220, 'FORGE BREAKOUT SYSTEM', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '24px',
        fontStyle: '900',
        color: theme.textMuted
      })
      .setOrigin(0.5);

    this.add
      .text(WORLD_WIDTH / 2, 306, `BEST ${saveData.bestScore}`, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '42px',
        fontStyle: '900',
        color: `#${theme.primary.toString(16).padStart(6, '0')}`
      })
      .setOrigin(0.5);

    new Button(
      this,
      WORLD_WIDTH / 2,
      440,
      620,
      88,
      'START',
      () => {
        startSceneWithTransition(this, 'GameScene', { levelIndex: nextLevel });
      },
      { icon: 'player-play', theme }
    );

    new Button(
      this,
      WORLD_WIDTH / 2,
      558,
      620,
      88,
      'LEVEL SELECT',
      () => {
        startSceneWithTransition(this, 'LevelSelectScene');
      },
      { variant: 'secondary', icon: 'player-track-next', theme }
    );

    new Button(
      this,
      WORLD_WIDTH / 2,
      676,
      620,
      88,
      'MODE CREATIF',
      () => {
        startSceneWithTransition(this, 'LevelEditorScene', { mode: 'creative' });
      },
      { variant: 'secondary', icon: 'palette', theme }
    );

    new Button(
      this,
      WORLD_WIDTH / 2,
      794,
      620,
      88,
      'GUIDE',
      () => {
        startSceneWithTransition(this, 'GuideScene');
      },
      { variant: 'secondary', icon: 'book', theme }
    );

    new Button(
      this,
      WORLD_WIDTH / 2,
      912,
      620,
      88,
      `THEME ${theme.name.toUpperCase()}`,
      () => {
        const currentIndex = THEMES.findIndex((candidate) => candidate.id === theme.id);
        const nextTheme = THEMES[(currentIndex + 1) % THEMES.length];

        if (!nextTheme) {
          return;
        }

        save.setTheme(nextTheme.id);
        this.scene.restart();
      },
      { variant: 'ghost', icon: 'palette', theme }
    );

    new Button(
      this,
      WORLD_WIDTH / 2,
      1030,
      620,
      88,
      'OPTIONS',
      () => {
        startSceneWithTransition(this, 'OptionsScene', { returnTo: 'MainMenuScene' });
      },
      { variant: 'ghost', icon: 'settings', theme }
    );

    addCreatorCredit(this, theme);
  }

  private renderAdminButton(label: string, onClick: () => void): void {
    this.adminButton?.destroy(true);
    this.adminButton = new Button(this, WORLD_WIDTH - 142, 44, 238, 54, label, onClick, {
      variant: 'ghost',
      compact: true,
      icon: 'settings'
    });
  }

  private async refreshAdminButton(): Promise<void> {
    const requestId = ++this.adminSessionRequestId;

    try {
      const session = await this.adminApi.getSession();

      if (requestId !== this.adminSessionRequestId || !this.scene.isActive('MainMenuScene')) {
        return;
      }

      if (session.authenticated) {
        this.renderAdminButton('ADMIN EDITOR', () =>
          startSceneWithTransition(this, 'LevelEditorScene', { mode: 'admin' })
        );
      }
    } catch {
      // The menu remains fully playable when the admin API is offline.
    }
  }
}
