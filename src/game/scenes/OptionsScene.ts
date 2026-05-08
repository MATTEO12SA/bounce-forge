import Phaser from 'phaser';
import { TOKENS } from '../config/designTokens';
import { getTheme, type ThemeDefinition } from '../config/themeConfig';
import { SaveSystem } from '../systems/SaveSystem';
import { SettingsSystem } from '../systems/SettingsSystem';
import type { FxQuality } from '../systems/SaveSystem';
import { applyAudioSettings } from '../systems/audioRegistry';
import { Button } from '../ui/Button';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Slider } from '../ui/Slider';
import { ToggleSwitch } from '../ui/ToggleSwitch';
import { drawScreenBackground } from '../ui/sceneChrome';
import { drawRoundedRect } from '../ui/roundedShapes';
import { DEPTHS, WORLD_HEIGHT, WORLD_WIDTH } from '../utils/constants';

const CARD_WIDTH = 880;
const CARD_HEIGHT = 720;
const CARD_CENTER_Y = 720;
const CARD_LEFT_X = WORLD_WIDTH / 2 - CARD_WIDTH / 2;
const CARD_RIGHT_X = WORLD_WIDTH / 2 + CARD_WIDTH / 2;
const ROW_LABEL_X = CARD_LEFT_X + 56;
const ROW_CONTROL_CENTER_X = CARD_RIGHT_X - 240;
const ROW_GAP = 152;
const FIRST_ROW_Y = CARD_CENTER_Y - CARD_HEIGHT / 2 + 124;

interface OptionsSceneData {
  returnTo?: 'MainMenuScene' | 'PauseScene';
  pauseData?: {
    levelIndex?: number;
    source?: 'campaign' | 'creative';
    editorReturn?: {
      mode: 'creative' | 'admin';
      slotIndex: number;
    };
  };
}

export class OptionsScene extends Phaser.Scene {
  private save!: SaveSystem;
  private settings!: SettingsSystem;
  private theme!: ThemeDefinition;
  private returnTo: 'MainMenuScene' | 'PauseScene' = 'MainMenuScene';
  private pauseData?: OptionsSceneData['pauseData'];
  private confirmingReset = false;

  public constructor() {
    super('OptionsScene');
  }

  public create(data: OptionsSceneData = {}): void {
    this.save = new SaveSystem();
    this.settings = new SettingsSystem(this.save);
    this.theme = getTheme(this.save.snapshot().preferences.themeId);
    this.returnTo = data.returnTo === 'PauseScene' ? 'PauseScene' : 'MainMenuScene';
    this.pauseData = data.pauseData;
    this.confirmingReset = false;

    this.renderAll();
  }

  private renderAll(): void {
    this.children.removeAll(true);
    drawScreenBackground(this, this.theme, { panel: false, sideRails: true });

    this.add
      .text(WORLD_WIDTH / 2, 220, 'OPTIONS', {
        fontFamily: TOKENS.font.family,
        fontSize: `${TOKENS.font.title.size}px`,
        fontStyle: TOKENS.font.title.weight,
        color: this.theme.text
      })
      .setOrigin(0.5)
      .setShadow(0, 4, '#000814', 8, false, true);

    if (this.confirmingReset) {
      this.renderConfirmReset();
      return;
    }

    drawRoundedRect(
      this,
      WORLD_WIDTH / 2,
      CARD_CENTER_Y,
      CARD_WIDTH,
      CARD_HEIGHT,
      TOKENS.radius.lg,
      {
        fill: { color: this.theme.panelStrong, alpha: 0.55 },
        stroke: { color: this.theme.borderDim, width: 2, alpha: 0.6 }
      }
    );

    const sectionY = CARD_CENTER_Y - CARD_HEIGHT / 2 + 56;
    this.add
      .text(WORLD_WIDTH / 2, sectionY, 'AUDIO & DISPLAY', {
        fontFamily: TOKENS.font.family,
        fontSize: '26px',
        fontStyle: '900',
        color: `#${this.theme.accent.toString(16).padStart(6, '0')}`
      })
      .setOrigin(0.5);

    this.renderSliderRow('SFX VOLUME', FIRST_ROW_Y, this.settings.get().volumeSfx, (value) =>
      this.applyVolumeSfx(value)
    );
    this.renderQualityRow('FX QUALITY', FIRST_ROW_Y + ROW_GAP, this.settings.get().fxQuality);
    this.renderToggle(
      'FULLSCREEN',
      FIRST_ROW_Y + ROW_GAP * 2,
      this.settings.get().fullscreen,
      (next) => this.applyFullscreen(next)
    );
    this.renderToggle(
      'SOUND',
      FIRST_ROW_Y + ROW_GAP * 3,
      this.settings.get().soundEnabled,
      (next) => this.applySoundEnabled(next)
    );

    const buttonsY = CARD_CENTER_Y + CARD_HEIGHT / 2 + TOKENS.spacing.xl + 20;

    new Button(
      this,
      WORLD_WIDTH / 2 - 250,
      buttonsY,
      460,
      96,
      'RESET SAVE',
      () => {
        this.confirmingReset = true;
        this.renderAll();
      },
      { variant: 'danger', icon: 'trash', theme: this.theme }
    ).setDepth(DEPTHS.overlay);

    new Button(
      this,
      WORLD_WIDTH / 2 + 250,
      buttonsY,
      460,
      96,
      'BACK',
      () => {
        if (this.returnTo === 'PauseScene') {
          this.scene.start('PauseScene', this.pauseData ?? {});
          return;
        }

        this.scene.start('MainMenuScene');
      },
      { variant: 'ghost', icon: 'arrow-left', theme: this.theme }
    ).setDepth(DEPTHS.overlay);
  }

  private renderSliderRow(
    label: string,
    y: number,
    currentValue: number,
    onPick: (value: number) => void
  ): void {
    this.add
      .text(ROW_LABEL_X, y, label, {
        fontFamily: TOKENS.font.family,
        fontSize: `${TOKENS.font.label.size}px`,
        fontStyle: TOKENS.font.label.weight,
        color: this.theme.textMuted
      })
      .setOrigin(0, 0.5);

    new Slider(this, ROW_CONTROL_CENTER_X, y, 380, currentValue, onPick, {
      theme: this.theme,
      step: 0.05
    }).setDepth(DEPTHS.overlay);
  }

  private renderQualityRow(label: string, y: number, current: FxQuality): void {
    this.add
      .text(ROW_LABEL_X, y, label, {
        fontFamily: TOKENS.font.family,
        fontSize: `${TOKENS.font.label.size}px`,
        fontStyle: TOKENS.font.label.weight,
        color: this.theme.textMuted
      })
      .setOrigin(0, 0.5);

    new SegmentedControl<FxQuality>(
      this,
      ROW_CONTROL_CENTER_X,
      y,
      [
        { label: 'LOW', value: 'low' },
        { label: 'MED', value: 'med' },
        { label: 'HIGH', value: 'high' }
      ],
      current,
      (value) => this.applyFxQuality(value),
      { theme: this.theme, buttonWidth: 144, buttonHeight: 80 }
    ).setDepth(DEPTHS.overlay);
  }

  private renderToggle(
    label: string,
    y: number,
    current: boolean,
    onToggle: (next: boolean) => void
  ): void {
    this.add
      .text(ROW_LABEL_X, y, label, {
        fontFamily: TOKENS.font.family,
        fontSize: `${TOKENS.font.label.size}px`,
        fontStyle: TOKENS.font.label.weight,
        color: this.theme.textMuted
      })
      .setOrigin(0, 0.5);

    new ToggleSwitch(this, ROW_CONTROL_CENTER_X, y, current, onToggle, {
      theme: this.theme
    }).setDepth(DEPTHS.overlay);
  }

  private renderConfirmReset(): void {
    drawRoundedRect(
      this,
      WORLD_WIDTH / 2,
      WORLD_HEIGHT / 2 + 40,
      820,
      460,
      TOKENS.radius.lg,
      {
        fill: { color: this.theme.panelStrong, alpha: 0.92 },
        stroke: { color: this.theme.danger, width: 3, alpha: 0.9 }
      }
    );

    this.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 80, 'RESET ALL PROGRESS?', {
        fontFamily: TOKENS.font.family,
        fontSize: '54px',
        fontStyle: '900',
        color: '#ffaaaa'
      })
      .setOrigin(0.5);

    this.add
      .text(
        WORLD_WIDTH / 2,
        WORLD_HEIGHT / 2 + 0,
        'Medals, levels and creative slots will be lost.',
        {
          fontFamily: TOKENS.font.family,
          fontSize: '28px',
          fontStyle: '700',
          color: this.theme.textMuted
        }
      )
      .setOrigin(0.5);

    new Button(
      this,
      WORLD_WIDTH / 2 - 220,
      WORLD_HEIGHT / 2 + 160,
      400,
      104,
      'CONFIRM RESET',
      () => {
        this.save.reset();
        this.settings = new SettingsSystem(this.save);
        this.confirmingReset = false;
        this.renderAll();
      },
      { variant: 'danger', icon: 'trash', theme: this.theme }
    ).setDepth(DEPTHS.overlay);

    new Button(
      this,
      WORLD_WIDTH / 2 + 220,
      WORLD_HEIGHT / 2 + 160,
      400,
      104,
      'CANCEL',
      () => {
        this.confirmingReset = false;
        this.renderAll();
      },
      { variant: 'ghost', icon: 'x', theme: this.theme }
    ).setDepth(DEPTHS.overlay);
  }

  private applyVolumeSfx(value: number): void {
    const next = this.settings.setVolumeSfx(value);
    applyAudioSettings({ volumeSfx: next.volumeSfx });
  }

  private applyFxQuality(quality: FxQuality): void {
    this.settings.setFxQuality(quality);
  }

  private applyFullscreen(next: boolean): void {
    this.settings.setFullscreen(next);
    this.settings.applyFullscreenToScale(this.scale);
  }

  private applySoundEnabled(next: boolean): void {
    const updated = this.settings.setSoundEnabled(next);
    applyAudioSettings({ soundEnabled: updated.soundEnabled });
  }
}
