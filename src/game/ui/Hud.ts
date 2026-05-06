import type Phaser from 'phaser';
import type { ThemeDefinition } from '../config/themeConfig';
import { DEPTHS, WORLD_WIDTH } from '../utils/constants';

export interface HudState {
  levelName: string;
  objectiveLabel: string;
  score: number;
  lives: number;
  combo: number;
  bestCombo: number;
  balls: number;
  waitingToLaunch: boolean;
  effectLabel?: string;
}

export class Hud {
  private readonly scoreValue: Phaser.GameObjects.Text;
  private readonly centerText: Phaser.GameObjects.Text;
  private readonly comboText: Phaser.GameObjects.Text;
  private readonly rightText: Phaser.GameObjects.Text;

  public constructor(scene: Phaser.Scene, initial: HudState, theme?: ThemeDefinition) {
    const panelColor = theme?.panelStrong ?? 0x122432;
    const strokeColor = theme?.borderDim ?? 0x2c5367;
    const accentColor = theme?.primary ?? 0x66e3ff;
    const textColor = theme?.text ?? '#f4fbff';
    const mutedColor = theme?.textMuted ?? '#9fb5c8';

    scene.add
      .rectangle(0, 0, WORLD_WIDTH, 86, panelColor, 0.92)
      .setOrigin(0, 0)
      .setStrokeStyle(0, strokeColor, 0)
      .setDepth(DEPTHS.hud);
    scene.add
      .rectangle(0, 84, WORLD_WIDTH, 2, strokeColor, 0.95)
      .setOrigin(0, 0)
      .setDepth(DEPTHS.hud + 0.1);
    scene.add
      .rectangle(0, 5, WORLD_WIDTH, 3, 0xffffff, 0.08)
      .setOrigin(0, 0)
      .setDepth(DEPTHS.hud + 0.1);
    scene.add
      .rectangle(278, 16, 2, 52, strokeColor, 0.45)
      .setOrigin(0, 0)
      .setDepth(DEPTHS.hud + 0.1);
    scene.add
      .rectangle(WORLD_WIDTH - 280, 16, 2, 52, strokeColor, 0.45)
      .setOrigin(0, 0)
      .setDepth(DEPTHS.hud + 0.1);

    scene.add
      .text(30, 18, 'SCORE', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        fontStyle: '800',
        color: mutedColor
      })
      .setDepth(DEPTHS.hud + 1);

    this.scoreValue = scene.add
      .text(30, 38, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '26px',
        fontStyle: '900',
        color: textColor
      })
      .setDepth(DEPTHS.hud + 1);

    this.centerText = scene.add
      .text(WORLD_WIDTH / 2, 15, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '23px',
        fontStyle: '900',
        color: textColor,
        align: 'center',
        fixedWidth: 470
      })
      .setOrigin(0.5, 0)
      .setDepth(DEPTHS.hud + 1);

    this.comboText = scene.add
      .text(WORLD_WIDTH / 2, 47, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '18px',
        fontStyle: '800',
        color: `#${accentColor.toString(16).padStart(6, '0')}`
      })
      .setOrigin(0.5, 0)
      .setDepth(DEPTHS.hud + 1);

    scene.add
      .text(WORLD_WIDTH - 250, 18, 'STATUS', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        fontStyle: '800',
        color: mutedColor
      })
      .setDepth(DEPTHS.hud + 1);

    this.rightText = scene.add
      .text(WORLD_WIDTH - 250, 38, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '24px',
        fontStyle: '900',
        color: textColor
      })
      .setDepth(DEPTHS.hud + 1);

    this.update(initial);
  }

  public update(state: HudState): void {
    this.scoreValue.setText(`${state.score}`);
    this.centerText.setText(this.formatLevelName(state.levelName));
    this.comboText.setText(
      state.waitingToLaunch
        ? `TAP / SPACE  |  ${state.objectiveLabel}`
        : `COMBO x${state.combo}  |  ${state.objectiveLabel}`
    );
    this.rightText.setText(
      `L ${state.lives}  B ${state.balls}${state.effectLabel ? `  ${state.effectLabel}` : ''}`
    );
  }

  private formatLevelName(levelName: string): string {
    return levelName.length > 28 ? `${levelName.slice(0, 25)}...` : levelName.toUpperCase();
  }
}
