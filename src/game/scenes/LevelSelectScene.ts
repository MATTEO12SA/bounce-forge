import Phaser from 'phaser';
import { getTheme } from '../config/themeConfig';
import { LevelSystem } from '../systems/LevelSystem';
import { SaveSystem } from '../systems/SaveSystem';
import { Button } from '../ui/Button';
import { addCreatorCredit, drawPanel, drawScreenBackground } from '../ui/sceneChrome';
import { GAME_TITLE, WORLD_HEIGHT, WORLD_WIDTH } from '../utils/constants';

export class LevelSelectScene extends Phaser.Scene {
  public constructor() {
    super('LevelSelectScene');
  }

  public create(): void {
    const save = new SaveSystem();
    const levelSystem = new LevelSystem(save);
    const saveData = save.snapshot();
    const theme = getTheme(saveData.preferences.themeId);

    drawScreenBackground(this, theme, { panel: false, sideRails: true });
    drawPanel(this, WORLD_WIDTH / 2, 928, 812, 1438, theme, { alpha: 0.74 });

    this.add
      .text(WORLD_WIDTH / 2, 70, GAME_TITLE, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '74px',
        fontStyle: '900',
        color: theme.text
      })
      .setOrigin(0.5)
      .setShadow(0, 4, '#000814', 8, false, true);

    this.add
      .text(WORLD_WIDTH / 2, 178, 'CAMPAIGN', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '46px',
        fontStyle: '900',
        color: `#${theme.primary.toString(16).padStart(6, '0')}`
      })
      .setOrigin(0.5);

    Array.from({ length: levelSystem.count }, (_, index) =>
      levelSystem.getCampaignLevel(index)
    ).forEach((level, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = col === 0 ? 326 : 754;
      const y = 300 + row * 104;
      const locked = index > saveData.unlockedLevel;
      const medal = saveData.levelMedals[String(index)]?.toUpperCase();
      const adminMark = levelSystem.hasAdminCampaignOverride(index) ? ' *' : '';

      new Button(
        this,
        x,
        y,
        382,
        76,
        locked
          ? `LOCKED ${index + 1}`
          : `${index + 1}. ${level.name}${adminMark}${medal ? ` ${medal}` : ''}`,
        () => {
          this.scene.start('GameScene', { levelIndex: index });
        },
        { disabled: locked, variant: locked ? 'ghost' : 'secondary', compact: true }
      );
    });

    new Button(
      this,
      WORLD_WIDTH / 2,
      WORLD_HEIGHT - 150,
      540,
      96,
      'BACK',
      () => {
        this.scene.start('MainMenuScene');
      },
      { variant: 'ghost' }
    );

    addCreatorCredit(this, theme);
  }
}
