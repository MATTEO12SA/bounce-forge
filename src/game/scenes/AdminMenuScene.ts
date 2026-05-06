import Phaser from 'phaser';
import { getTheme } from '../config/themeConfig';
import { AdminApiSystem } from '../systems/AdminApiSystem';
import { SaveSystem } from '../systems/SaveSystem';
import { Button } from '../ui/Button';
import { addCreatorCredit, drawPanel, drawScreenBackground } from '../ui/sceneChrome';
import { GAME_TITLE, WORLD_WIDTH } from '../utils/constants';

export class AdminMenuScene extends Phaser.Scene {
  private readonly api = new AdminApiSystem();
  private statusText!: Phaser.GameObjects.Text;

  public constructor() {
    super('AdminMenuScene');
  }

  public create(): void {
    const save = new SaveSystem();
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

    new Button(
      this,
      WORLD_WIDTH / 2,
      500,
      570,
      88,
      'ADMIN EDITOR',
      () => this.scene.start('LevelEditorScene', { mode: 'admin' }),
      { selected: true }
    );
    new Button(this, WORLD_WIDTH / 2, 620, 570, 88, 'LOGOUT', () => void this.logout(), {
      variant: 'secondary'
    });
    new Button(
      this,
      WORLD_WIDTH / 2,
      740,
      570,
      88,
      'BACK',
      () => this.scene.start('MainMenuScene'),
      { variant: 'ghost' }
    );

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

      this.statusText.setText('Connecte en admin.');
    } catch {
      this.scene.start('AdminLoginScene');
    }
  }

  private async logout(): Promise<void> {
    await this.api.logout().catch(() => undefined);
    this.scene.start('MainMenuScene');
  }
}
