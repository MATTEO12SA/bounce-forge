import Phaser from 'phaser';
import { TOKENS } from '../config/designTokens';
import { getTheme } from '../config/themeConfig';
import { SaveSystem } from '../systems/SaveSystem';
import { Button } from '../ui/Button';
import { ScrollPanel } from '../ui/ScrollPanel';
import { TabBar } from '../ui/TabBar';
import { drawRoundedRect } from '../ui/roundedShapes';
import { addCreatorCredit, drawPanel, drawScreenBackground } from '../ui/sceneChrome';
import { startSceneWithTransition } from '../ui/uiFeedback';
import { GAME_TITLE, WORLD_HEIGHT, WORLD_WIDTH } from '../utils/constants';

type GuideTab = 'basics' | 'powerups' | 'editor';

interface GuideSceneData {
  tab?: GuideTab;
}

export class GuideScene extends Phaser.Scene {
  public constructor() {
    super('GuideScene');
  }

  public create(data: GuideSceneData = {}): void {
    const save = new SaveSystem();
    const theme = getTheme(save.snapshot().preferences.themeId);
    const selectedTab: GuideTab = data.tab ?? 'basics';

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

    new TabBar<GuideTab>(
      this,
      WORLD_WIDTH / 2,
      248,
      [
        { label: 'BASICS', value: 'basics' },
        { label: 'POWER-UPS', value: 'powerups' },
        { label: 'EDITOR', value: 'editor' }
      ],
      selectedTab,
      (tab) => this.scene.restart({ tab }),
      { theme, buttonWidth: 216 }
    );

    const sections = [
      {
        tab: 'basics',
        title: 'CONTROLS',
        lines: [
          'Mouse / touch / arrows / A-D',
          'Space or tap launches the ball',
          'P or Esc pauses, R restarts'
        ]
      },
      {
        tab: 'powerups',
        title: 'POWER-UPS',
        lines: [
          'x3 and x2 create extra balls',
          'W widens the paddle',
          'AIM catches the next paddle hit'
        ]
      },
      {
        tab: 'basics',
        title: 'OBJECTIVES',
        lines: [
          'Clear all breakable bricks',
          'HUD tracks combo, balls, lives, explosions',
          'Gold asks for score or best combo'
        ]
      },
      {
        tab: 'editor',
        title: 'EDITOR',
        lines: [
          'Creative maps stay local',
          'Admin publishes campaign overrides',
          'Import/export codes share levels'
        ]
      }
    ].filter((section) => section.tab === selectedTab);

    new ScrollPanel(this, { x: WORLD_WIDTH / 2, y: 890, width: 718, height: 980 }, sections, {
      itemHeight: 256,
      gap: 24,
      theme,
      renderItem: (scene, section) => {
        const container = scene.add.container(0, 0);
        const card = drawRoundedRect(scene, 0, 0, 640, 232, TOKENS.radius.md, {
          fill: { color: theme.surface, alpha: 0.55 },
          stroke: { color: theme.borderDim, width: 2, alpha: 0.7 }
        });
        const title = scene.add
          .text(0, -76, section.title, {
            fontFamily: TOKENS.font.family,
            fontSize: '34px',
            fontStyle: '900',
            color: `#${theme.accent.toString(16).padStart(6, '0')}`,
            align: 'center'
          })
          .setOrigin(0.5);
        const body = scene.add
          .text(0, -28, section.lines.join('\n'), {
            fontFamily: TOKENS.font.family,
            fontSize: '28px',
            fontStyle: '700',
            color: theme.text,
            align: 'center',
            fixedWidth: 600,
            lineSpacing: 10
          })
          .setOrigin(0.5, 0);
        container.add([card, title, body]);
        return container;
      }
    });

    new Button(
      this,
      WORLD_WIDTH / 2,
      WORLD_HEIGHT - 160,
      540,
      96,
      'BACK',
      () => startSceneWithTransition(this, 'MainMenuScene'),
      { variant: 'ghost', icon: 'arrow-left', theme }
    );

    addCreatorCredit(this, theme);
  }
}
