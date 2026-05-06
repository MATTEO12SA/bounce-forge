import Phaser from 'phaser';
import { GAME_TITLE, WORLD_HEIGHT, WORLD_WIDTH } from '../utils/constants';
import { ProgressBar } from '../ui/ProgressBar';
import { getTheme } from '../config/themeConfig';
import { drawScreenBackground } from '../ui/sceneChrome';
import { CampaignOverrideSystem } from '../systems/CampaignOverrideSystem';

export class PreloadScene extends Phaser.Scene {
  public constructor() {
    super('PreloadScene');
  }

  public create(): void {
    const theme = getTheme('forge');
    const overridesReady = CampaignOverrideSystem.refresh();
    drawScreenBackground(this, theme, { panel: false, sideRails: true });

    this.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 190, GAME_TITLE, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '118px',
        fontStyle: '900',
        color: theme.text
      })
      .setOrigin(0.5)
      .setShadow(0, 4, '#000814', 8, false, true);

    this.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 82, 'SYSTEM ONLINE', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '26px',
        fontStyle: '900',
        color: theme.textMuted
      })
      .setOrigin(0.5);

    const bar = new ProgressBar(
      this,
      WORLD_WIDTH / 2 - 260,
      WORLD_HEIGHT / 2 + 42,
      520,
      24,
      theme.primary
    );

    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 360,
      onUpdate: (tween) => {
        bar.setProgress(tween.getValue() ?? 0);
      },
      onComplete: () => {
        const showMenu = new URLSearchParams(window.location.search).get('menu') === '1';
        void overridesReady.finally(() => {
          this.scene.start(showMenu ? 'MainMenuScene' : 'GameScene', { levelIndex: 0 });
        });
      }
    });
  }
}
