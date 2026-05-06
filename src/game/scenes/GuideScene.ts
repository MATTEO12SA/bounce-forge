import Phaser from 'phaser';
import { getTheme } from '../config/themeConfig';
import { SaveSystem } from '../systems/SaveSystem';
import { Button } from '../ui/Button';
import { addCreatorCredit, drawPanel, drawScreenBackground } from '../ui/sceneChrome';
import { GAME_TITLE, WORLD_HEIGHT, WORLD_WIDTH } from '../utils/constants';

export class GuideScene extends Phaser.Scene {
  public constructor() {
    super('GuideScene');
  }

  public create(): void {
    const save = new SaveSystem();
    const theme = getTheme(save.snapshot().preferences.themeId);

    drawScreenBackground(this, theme, { panel: false, sideRails: true });
    drawPanel(this, WORLD_WIDTH / 2, 940, 824, 1390, theme, { alpha: 0.76 });

    this.add
      .text(WORLD_WIDTH / 2, 82, GAME_TITLE, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '72px',
        fontStyle: '900',
        color: theme.text
      })
      .setOrigin(0.5)
      .setShadow(0, 4, '#000814', 8, false, true);

    this.add
      .text(WORLD_WIDTH / 2, 166, 'GUIDE', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '46px',
        fontStyle: '900',
        color: `#${theme.primary.toString(16).padStart(6, '0')}`
      })
      .setOrigin(0.5);

    const sections = [
      {
        title: 'CONTROLS',
        lines: [
          'Mouse / touch / arrows / A-D',
          'Space or tap launches the ball',
          'P or Esc pauses, R restarts'
        ]
      },
      {
        title: 'POWER-UPS',
        lines: [
          'x3 and x2 create extra balls',
          'W widens the paddle',
          'AIM catches the next paddle hit'
        ]
      },
      {
        title: 'OBJECTIVES',
        lines: [
          'Clear all breakable bricks',
          'HUD tracks combo, balls, lives, explosions',
          'Gold asks for score or best combo'
        ]
      },
      {
        title: 'EDITOR',
        lines: [
          'Creative maps stay local',
          'Admin publishes campaign overrides',
          'Import/export codes share levels'
        ]
      }
    ];

    sections.forEach((section, index) => {
      const x = WORLD_WIDTH / 2;
      const y = 338 + index * 292;

      this.add
        .rectangle(x, y + 156, 690, 2, theme.borderDim, 0.7)
        .setOrigin(0.5)
        .setDepth(1);
      this.add
        .text(x, y, section.title, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '34px',
          fontStyle: '900',
          color: `#${theme.primary.toString(16).padStart(6, '0')}`,
          align: 'center'
        })
        .setOrigin(0.5);

      this.add
        .text(x, y + 54, section.lines.join('\n'), {
          fontFamily: 'Arial, sans-serif',
          fontSize: '30px',
          fontStyle: '800',
          color: theme.text,
          align: 'center',
          fixedWidth: 704,
          lineSpacing: 8
        })
        .setOrigin(0.5, 0);
    });

    new Button(
      this,
      WORLD_WIDTH / 2,
      WORLD_HEIGHT - 160,
      540,
      96,
      'BACK',
      () => this.scene.start('MainMenuScene'),
      { variant: 'ghost' }
    );

    addCreatorCredit(this, theme);
  }
}
