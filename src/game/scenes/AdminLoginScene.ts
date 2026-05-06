import Phaser from 'phaser';
import { getTheme } from '../config/themeConfig';
import { AdminApiSystem } from '../systems/AdminApiSystem';
import { SaveSystem } from '../systems/SaveSystem';
import { Button } from '../ui/Button';
import { addCreatorCredit, drawPanel, drawScreenBackground } from '../ui/sceneChrome';
import { GAME_TITLE, WORLD_WIDTH } from '../utils/constants';

export class AdminLoginScene extends Phaser.Scene {
  private readonly api = new AdminApiSystem();
  private password = '';
  private passwordText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;

  public constructor() {
    super('AdminLoginScene');
  }

  public create(): void {
    const save = new SaveSystem();
    const theme = getTheme(save.snapshot().preferences.themeId);

    drawScreenBackground(this, theme, { panel: false, sideRails: true });
    drawPanel(this, WORLD_WIDTH / 2, 560, 746, 760, theme, { alpha: 0.78 });

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
      .text(WORLD_WIDTH / 2, 242, 'ADMIN LOGIN', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '44px',
        fontStyle: '900',
        color: `#${theme.primary.toString(16).padStart(6, '0')}`
      })
      .setOrigin(0.5);

    this.add
      .rectangle(WORLD_WIDTH / 2, 392, 560, 82, theme.surface, 0.92)
      .setStrokeStyle(2, theme.border, 0.9);

    this.passwordText = this.add
      .text(WORLD_WIDTH / 2, 392, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '34px',
        fontStyle: '800',
        color: theme.text
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(WORLD_WIDTH / 2, 496, 'Tape le mot de passe admin.', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '24px',
        fontStyle: '800',
        color: theme.textMuted,
        align: 'center',
        wordWrap: { width: 640 }
      })
      .setOrigin(0.5);

    new Button(this, WORLD_WIDTH / 2, 620, 520, 84, 'LOGIN', () => void this.login(), {
      selected: true
    });
    new Button(
      this,
      WORLD_WIDTH / 2,
      742,
      520,
      84,
      'BACK',
      () => this.scene.start('MainMenuScene'),
      { variant: 'ghost' }
    );

    this.input.keyboard?.on('keydown', this.handleKeyDown, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown', this.handleKeyDown, this);
    });

    addCreatorCredit(this, theme);
    this.updatePasswordText();
    void this.redirectIfAuthenticated();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.scene.start('MainMenuScene');
      return;
    }

    if (event.key === 'Enter') {
      void this.login();
      return;
    }

    if (event.key === 'Backspace') {
      this.password = this.password.slice(0, -1);
      this.updatePasswordText();
      return;
    }

    if (event.key.length === 1 && this.password.length < 64) {
      this.password += event.key;
      this.updatePasswordText();
    }
  }

  private updatePasswordText(): void {
    this.passwordText.setText(this.password ? '*'.repeat(this.password.length) : 'PASSWORD');
    this.passwordText.setAlpha(this.password ? 1 : 0.48);
  }

  private async redirectIfAuthenticated(): Promise<void> {
    try {
      const session = await this.api.getSession();

      if (session.authenticated && this.scene.isActive('AdminLoginScene')) {
        this.scene.start('AdminMenuScene');
      }
    } catch {
      // Stay on the login screen if the admin API is unavailable.
    }
  }

  private async login(): Promise<void> {
    try {
      this.statusText.setText('Connexion admin...');
      const result = await this.api.login(this.password);

      if (!result.authenticated) {
        this.statusText.setText(result.message ?? 'Mot de passe refuse.');
        return;
      }

      this.scene.start('AdminMenuScene');
    } catch (error) {
      this.statusText.setText(error instanceof Error ? error.message : 'Connexion impossible.');
    }
  }
}
