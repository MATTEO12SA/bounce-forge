import Phaser from 'phaser';
import { getTheme } from '../config/themeConfig';
import { AdminApiSystem } from '../systems/AdminApiSystem';
import { CampaignOverrideSystem } from '../systems/CampaignOverrideSystem';
import { getSharedSaveSystem } from '../systems/SaveSystem';
import { Button } from '../ui/Button';
import { addCreatorCredit, drawPanel, drawScreenBackground } from '../ui/sceneChrome';
import { returnToShell, startSceneWithTransition } from '../ui/uiFeedback';
import { GAME_TITLE, WORLD_WIDTH } from '../utils/constants';

export class AdminMenuScene extends Phaser.Scene {
  private readonly api = new AdminApiSystem();
  private statusText!: Phaser.GameObjects.Text;
  private readonly adminButtons: Button[] = [];

  public constructor() {
    super('AdminMenuScene');
  }

  public create(): void {
    const save = getSharedSaveSystem();
    const theme = getTheme(save.snapshot().preferences.themeId);

    drawScreenBackground(this, theme, { panel: false, sideRails: true });
    drawPanel(this, WORLD_WIDTH / 2, 570, 746, 780, theme, { alpha: 0.78 });

    this.add
      .text(WORLD_WIDTH / 2, 138, GAME_TITLE, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '74px',
        fontStyle: '900',
        color: theme.text
      })
      .setOrigin(0.5)
      .setShadow(0, 4, '#000814', 8, false, true);

    this.add
      .text(WORLD_WIDTH / 2, 242, 'ADMIN', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '48px',
        fontStyle: '900',
        color: `#${theme.primary.toString(16).padStart(6, '0')}`
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(WORLD_WIDTH / 2, 342, 'Verification session...', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '26px',
        fontStyle: '800',
        color: theme.textMuted,
        align: 'center',
        wordWrap: { width: 650 }
      })
      .setOrigin(0.5);

    this.adminButtons.push(
      new Button(
        this,
        WORLD_WIDTH / 2,
        450,
        570,
        78,
        'CAMPAIGN EDITOR',
        () => startSceneWithTransition(this, 'LevelEditorScene', { mode: 'admin' }),
        { selected: true, disabled: true, icon: 'palette' }
      )
    );
    this.adminButtons.push(
      new Button(this, WORLD_WIDTH / 2, 556, 570, 78, 'PLAY', () => returnToShell(this, 'admin'), {
        variant: 'secondary',
        disabled: true,
        icon: 'player-track-next'
      })
    );
    this.adminButtons.push(
      new Button(
        this,
        WORLD_WIDTH / 2,
        662,
        570,
        78,
        'REFRESH DATA',
        () => void this.refreshOverrides(),
        { variant: 'secondary', disabled: true, icon: 'refresh' }
      )
    );
    this.adminButtons.push(
      new Button(this, WORLD_WIDTH / 2, 768, 570, 78, 'LOGOUT', () => void this.logout(), {
        variant: 'danger',
        disabled: true,
        icon: 'x'
      })
    );
    new Button(
      this,
      WORLD_WIDTH / 2,
      874,
      570,
      78,
      'BACK TO GAME',
      () => returnToShell(this, 'admin'),
      { variant: 'ghost', icon: 'home' }
    );

    this.input.keyboard?.on('keydown-ESC', this.goBack, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-ESC', this.goBack, this);
    });

    void this.checkSession();
    addCreatorCredit(this, theme);
  }

  private async checkSession(): Promise<void> {
    try {
      const session = await this.api.getSession();
      if (!session.authenticated) {
        this.scene.start('AdminLoginScene');
        return;
      }

      this.adminButtons.forEach((button) => button.setDisabled(false));
      await this.refreshOverrides();
    } catch {
      this.scene.start('AdminLoginScene');
    }
  }

  private async refreshOverrides(): Promise<void> {
    try {
      this.statusText.setText('Refresh admin data...');
      await CampaignOverrideSystem.refresh(this.api);
      this.statusText.setText(
        `Connecte en admin. Overrides: ${CampaignOverrideSystem.listOverrides().length}.`
      );
    } catch {
      this.statusText.setText('Refresh impossible.');
    }
  }

  private async logout(): Promise<void> {
    await this.api.logout().catch(() => undefined);
    returnToShell(this, 'admin');
  }

  private goBack(): void {
    returnToShell(this, 'admin');
  }
}
