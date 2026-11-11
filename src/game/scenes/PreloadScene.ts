import Phaser from 'phaser';
import { bridge } from '../bridge';
import { CampaignOverrideSystem } from '../systems/CampaignOverrideSystem';

/** Waits for the interface: the HTML shell decides what to start (demo, campaign, editor...). */
export class PreloadScene extends Phaser.Scene {
  public constructor() {
    super('PreloadScene');
  }

  public create(): void {
    void CampaignOverrideSystem.refresh();
    bridge.emit('ready', undefined);
  }
}
