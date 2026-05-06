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
          'Mouse, touch, arrows or A/D: move paddle',
          'Space or tap: launch attached balls',
          'P or Esc: pause, R: restart'
        ]
      },
      {
        title: 'POWER-UPS',
        lines: [
          'x3 and x2 add balls from the source ball',
          'W widens the paddle, AIM catches balls for relaunch',
          '+1 restores one life up to the cap'
        ]
      },
      {
        title: 'OBJECTIVES',
        lines: [
          'Clear every breakable brick to win',
          'HUD objectives track balls, combos, explosions, or lives',
          'Bronze clears, Silver keeps lives, Gold hits score/combo'
        ]
      },
      {
        title: 'EDITOR',
        lines: [
          'Creative slots stay local to this browser',
          'Admin publishes campaign overrides through the server',
          'Import/export codes share maps; playtest returns here'
        ]
      }
    ];

    sections.forEach((section, index) => {
      const x = WORLD_WIDTH / 2;
      const y = 332 + index * 286;

      this.add
        .rectangle(x, y + 78, 704, 216, theme.surface, 0.5)
        .setStrokeStyle(2, theme.borderDim, 0.72);
      this.add
        .text(x, y, section.title, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '32px',
          fontStyle: '900',
          color: `#${theme.primary.toString(16).padStart(6, '0')}`,
          align: 'center'
        })
        .setOrigin(0.5);

      this.add
        .text(x - 312, y + 50, section.lines.join('\n'), {
          fontFamily: 'Arial, sans-serif',
          fontSize: '28px',
          fontStyle: '800',
          color: theme.text,
          lineSpacing: 10,
          wordWrap: { width: 624 }
        })
        .setOrigin(0, 0);
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
