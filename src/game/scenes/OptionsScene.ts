import Phaser from 'phaser';
import { getTheme, type ThemeDefinition } from '../config/themeConfig';
import { SaveSystem } from '../systems/SaveSystem';
import { SettingsSystem } from '../systems/SettingsSystem';
import type { FxQuality } from '../systems/SaveSystem';
import { Button } from '../ui/Button';
import { drawScreenBackground } from '../ui/sceneChrome';
import { DEPTHS, WORLD_HEIGHT, WORLD_WIDTH } from '../utils/constants';

const VOLUME_STEPS = [0, 0.25, 0.5, 0.75, 1];

interface OptionsSceneData {
  returnTo?: string;
}

export class OptionsScene extends Phaser.Scene {
  private save!: SaveSystem;
  private settings!: SettingsSystem;
  private theme!: ThemeDefinition;
  private returnTo = 'MainMenuScene';
  private confirmingReset = false;

  public constructor() {
    super('OptionsScene');
  }

  public create(data: OptionsSceneData): void {
    this.save = new SaveSystem();
    this.settings = new SettingsSystem(this.save);
    this.theme = getTheme(this.save.snapshot().preferences.themeId);
    this.returnTo = data.returnTo ?? 'MainMenuScene';
    this.confirmingReset = false;

    drawScreenBackground(this, this.theme, { panel: false, sideRails: true });

    this.add
      .text(WORLD_WIDTH / 2, 220, 'OPTIONS', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '92px',
        fontStyle: '900',
        color: this.theme.text
      })
      .setOrigin(0.5)
      .setShadow(0, 4, '#000814', 8, false, true);

    this.renderAll();
  }

  private renderAll(): void {
    this.children.removeAll();
    drawScreenBackground(this, this.theme, { panel: false, sideRails: true });

    this.add
      .text(WORLD_WIDTH / 2, 220, 'OPTIONS', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '92px',
        fontStyle: '900',
        color: this.theme.text
      })
      .setOrigin(0.5)
      .setShadow(0, 4, '#000814', 8, false, true);

    if (this.confirmingReset) {
      this.renderConfirmReset();
      return;
    }

    this.renderSection('SFX VOLUME', 360, this.settings.get().volumeSfx, (value) =>
      this.applyVolumeSfx(value)
    );
    this.renderSection('MUSIC VOLUME', 540, this.settings.get().volumeMusic, (value) =>
      this.applyVolumeMusic(value)
    );
    this.renderQualityRow('FX QUALITY', 720, this.settings.get().fxQuality);
    this.renderToggle(
      'FULLSCREEN',
      900,
      this.settings.get().fullscreen,
      (next) => this.applyFullscreen(next)
    );
    this.renderToggle(
      'SOUND',
      1040,
      this.settings.get().soundEnabled,
      (next) => this.applySoundEnabled(next)
    );

    new Button(this, WORLD_WIDTH / 2 - 250, 1240, 460, 96, 'RESET SAVE', () => {
      this.confirmingReset = true;
      this.renderAll();
    }, { variant: 'danger' }).setDepth(DEPTHS.overlay);

    new Button(this, WORLD_WIDTH / 2 + 250, 1240, 460, 96, 'BACK', () => {
      this.scene.start(this.returnTo);
    }, { variant: 'ghost' }).setDepth(DEPTHS.overlay);
  }

  private renderSection(
    label: string,
    y: number,
    currentValue: number,
    onPick: (value: number) => void
  ): void {
    this.add
      .text(WORLD_WIDTH / 2 - 460, y, label, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '34px',
        fontStyle: '800',
        color: this.theme.textMuted
      })
      .setOrigin(0, 0.5);

    const buttonWidth = 130;
    const gap = 16;
    const total = VOLUME_STEPS.length * buttonWidth + (VOLUME_STEPS.length - 1) * gap;
    const startX = WORLD_WIDTH / 2 + 220 - total / 2;

    VOLUME_STEPS.forEach((step, index) => {
      const x = startX + index * (buttonWidth + gap) + buttonWidth / 2;
      const isSelected = Math.abs(step - currentValue) < 0.01;
      new Button(
        this,
        x,
        y,
        buttonWidth,
        88,
        `${Math.round(step * 100)}%`,
        () => onPick(step),
        { selected: isSelected, compact: true }
      ).setDepth(DEPTHS.overlay);
    });
  }

  private renderQualityRow(label: string, y: number, current: FxQuality): void {
    this.add
      .text(WORLD_WIDTH / 2 - 460, y, label, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '34px',
        fontStyle: '800',
        color: this.theme.textMuted
      })
      .setOrigin(0, 0.5);

    const buttons: { label: string; value: FxQuality }[] = [
      { label: 'LOW', value: 'low' },
      { label: 'MED', value: 'med' },
      { label: 'HIGH', value: 'high' }
    ];

    const buttonWidth = 200;
    const gap = 18;
    const total = buttons.length * buttonWidth + (buttons.length - 1) * gap;
    const startX = WORLD_WIDTH / 2 + 200 - total / 2;

    buttons.forEach((entry, index) => {
      const x = startX + index * (buttonWidth + gap) + buttonWidth / 2;
      new Button(
        this,
        x,
        y,
        buttonWidth,
        96,
        entry.label,
        () => this.applyFxQuality(entry.value),
        { selected: current === entry.value }
      ).setDepth(DEPTHS.overlay);
    });
  }

  private renderToggle(
    label: string,
    y: number,
    current: boolean,
    onToggle: (next: boolean) => void
  ): void {
    this.add
      .text(WORLD_WIDTH / 2 - 460, y, label, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '34px',
        fontStyle: '800',
        color: this.theme.textMuted
      })
      .setOrigin(0, 0.5);

    new Button(
      this,
      WORLD_WIDTH / 2 + 260,
      y,
      280,
      96,
      current ? 'ON' : 'OFF',
      () => onToggle(!current),
      { selected: current }
    ).setDepth(DEPTHS.overlay);
  }

  private renderConfirmReset(): void {
    this.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 80, 'RESET ALL PROGRESS?', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '54px',
        fontStyle: '900',
        color: this.theme.danger ? '#ffaaaa' : this.theme.text
      })
      .setOrigin(0.5);

    this.add
      .text(
        WORLD_WIDTH / 2,
        WORLD_HEIGHT / 2 + 0,
        'Medals, levels and creative slots will be lost.',
        {
          fontFamily: 'Arial, sans-serif',
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
      { variant: 'danger' }
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
      { variant: 'ghost' }
    ).setDepth(DEPTHS.overlay);
  }

  private applyVolumeSfx(value: number): void {
    this.settings.setVolumeSfx(value);
    this.renderAll();
  }

  private applyVolumeMusic(value: number): void {
    this.settings.setVolumeMusic(value);
    this.renderAll();
  }

  private applyFxQuality(quality: FxQuality): void {
    this.settings.setFxQuality(quality);
    this.renderAll();
  }

  private applyFullscreen(next: boolean): void {
    this.settings.setFullscreen(next);
    this.settings.applyFullscreenToScale(this.scale);
    this.renderAll();
  }

  private applySoundEnabled(next: boolean): void {
    this.settings.setSoundEnabled(next);
    this.renderAll();
  }
}
