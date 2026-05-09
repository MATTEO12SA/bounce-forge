import Phaser from 'phaser';
import { CampaignOverrideSystem } from '../systems/CampaignOverrideSystem';

export class PreloadScene extends Phaser.Scene {
  public constructor() {
    super('PreloadScene');
  }

  public create(): void {
    void CampaignOverrideSystem.refresh();
    const showMenu = new URLSearchParams(window.location.search).get('menu') === '1';
    this.scene.start(showMenu ? 'MainMenuScene' : 'GameScene', { levelIndex: 0 });
  }
}
