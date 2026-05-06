import Phaser from 'phaser';
import { getTheme, type ThemeDefinition } from '../config/themeConfig';
import {
  EDITOR_CELL_DEFINITIONS,
  EDITOR_GRID_COLS,
  EDITOR_GRID_ROWS,
  EDITOR_PALETTE,
  createEmptyEditorRows,
  normalizeEditorRows,
  validateEditorRows,
  type EditorCell
} from '../levels/editorGrid';
import { LevelSystem } from '../systems/LevelSystem';
import { SaveSystem } from '../systems/SaveSystem';
import { Button } from '../ui/Button';
import { addCreatorCredit, drawPanel, drawScreenBackground } from '../ui/sceneChrome';
import { DEPTHS, GAME_TITLE, WORLD_HEIGHT, WORLD_WIDTH } from '../utils/constants';
import { clamp } from '../utils/math';

interface LevelEditorSceneData {
  slotIndex?: number;
}

const CELL_SIZE = 19;
const CELL_GAP = 3;
const CELL_STEP = CELL_SIZE + CELL_GAP;
const GRID_WIDTH = EDITOR_GRID_COLS * CELL_SIZE + (EDITOR_GRID_COLS - 1) * CELL_GAP;
const GRID_HEIGHT = EDITOR_GRID_ROWS * CELL_SIZE + (EDITOR_GRID_ROWS - 1) * CELL_GAP;
const GRID_LEFT = (WORLD_WIDTH - GRID_WIDTH) / 2;
const GRID_TOP = 260;

export class LevelEditorScene extends Phaser.Scene {
  private saveSystem!: SaveSystem;
  private levelSystem!: LevelSystem;
  private theme!: ThemeDefinition;
  private rows: string[] = createEmptyEditorRows();
  private selectedCell: EditorCell = '1';
  private slotIndex = 0;
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private gridHitArea!: Phaser.GameObjects.Zone;
  private slotLabel!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private readonly slotButtons: Button[] = [];
  private readonly paletteButtons: Button[] = [];
  private painting = false;
  private lastPaintedCell = '';

  public constructor() {
    super('LevelEditorScene');
  }

  public create(data: LevelEditorSceneData): void {
    this.saveSystem = new SaveSystem();
    this.levelSystem = new LevelSystem(this.saveSystem);
    this.theme = getTheme(this.saveSystem.snapshot().preferences.themeId);
    this.slotIndex = Math.floor(clamp(data.slotIndex ?? 0, 0, this.levelSystem.count - 1));
    this.selectedCell = '1';
    this.painting = false;
    this.lastPaintedCell = '';

    this.drawBackground();
    this.createHeader();
    this.gridGraphics = this.add.graphics().setDepth(DEPTHS.bricks);
    this.gridHitArea = this.add
      .zone(GRID_LEFT + GRID_WIDTH / 2, GRID_TOP + GRID_HEIGHT / 2, GRID_WIDTH, GRID_HEIGHT)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setDepth(DEPTHS.overlay);

    this.createControls();
    this.registerGridInput();
    this.loadSlot(this.slotIndex, 'Slot loaded.');

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdownEditor, this);
  }

  private drawBackground(): void {
    drawScreenBackground(this, this.theme, { panel: false, sideRails: true });
    drawPanel(
      this,
      WORLD_WIDTH / 2,
      WORLD_HEIGHT / 2,
      WORLD_WIDTH - 232,
      WORLD_HEIGHT - 96,
      this.theme,
      {
        alpha: 0.74
      }
    );
  }

  private createHeader(): void {
    this.add
      .text(WORLD_WIDTH / 2, 66, GAME_TITLE, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '58px',
        fontStyle: '900',
        color: this.theme.text
      })
      .setOrigin(0.5)
      .setDepth(DEPTHS.hud)
      .setShadow(0, 4, '#000814', 8, false, true);

    this.add
      .text(WORLD_WIDTH / 2, 124, 'WORLD EDITOR', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '36px',
        fontStyle: '900',
        color: `#${this.theme.primary.toString(16).padStart(6, '0')}`
      })
      .setOrigin(0.5)
      .setDepth(DEPTHS.hud);

    this.slotLabel = this.add
      .text(WORLD_WIDTH / 2, 252, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '26px',
        fontStyle: '700',
        color: this.theme.text
      })
      .setOrigin(0.5)
      .setDepth(DEPTHS.hud);
  }

  private createControls(): void {
    this.renderSlotButtons();
    this.renderPaletteButtons();

    new Button(this, 234, 1664, 192, 74, 'SAVE', () => this.saveCurrentSlot(), {
      compact: true
    }).setDepth(DEPTHS.hud);
    new Button(this, 450, 1664, 192, 74, 'PLAY', () => this.playCurrentSlot(), {
      selected: true,
      compact: true
    }).setDepth(DEPTHS.hud);
    new Button(this, 666, 1664, 192, 74, 'CLEAR', () => this.clearGrid(), {
      variant: 'secondary',
      compact: true
    }).setDepth(DEPTHS.hud);
    new Button(this, 882, 1664, 192, 74, 'RESET', () => this.resetSlot(), {
      variant: 'danger',
      compact: true
    }).setDepth(DEPTHS.hud);

    new Button(
      this,
      WORLD_WIDTH / 2,
      1784,
      420,
      80,
      'BACK',
      () => {
        this.scene.start('MainMenuScene');
      },
      { variant: 'ghost' }
    ).setDepth(DEPTHS.hud);

    this.statusText = this.add
      .text(WORLD_WIDTH / 2, 1838, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '28px',
        fontStyle: '800',
        color: `#${this.theme.primary.toString(16).padStart(6, '0')}`,
        align: 'center',
        wordWrap: { width: 760 }
      })
      .setOrigin(0.5)
      .setDepth(DEPTHS.hud);
    addCreatorCredit(this, this.theme);
  }

  private renderSlotButtons(): void {
    this.slotButtons.splice(0).forEach((button) => button.destroy(true));

    const pageSize = 6;
    const pageStart = Math.floor(this.slotIndex / pageSize) * pageSize;
    const pageEnd = Math.min(pageStart + pageSize, this.levelSystem.count);
    const startX = 202;
    const gap = 136;

    const prev = new Button(
      this,
      132,
      188,
      76,
      58,
      '<',
      () => this.loadSlot(Math.max(0, pageStart - pageSize), 'Previous slots.'),
      {
        disabled: pageStart === 0,
        variant: 'ghost',
        compact: true
      }
    ).setDepth(DEPTHS.hud);
    this.slotButtons.push(prev);

    for (let index = pageStart; index < pageEnd; index += 1) {
      const isSelected = index === this.slotIndex;
      const hasCustomMap = this.levelSystem.hasCustomLevelOverride(index);
      const button = new Button(
        this,
        startX + index * gap,
        188,
        104,
        58,
        `${index + 1}${hasCustomMap ? '*' : ''}`,
        () => this.loadSlot(index, `Slot ${index + 1} loaded.`),
        {
          fill: isSelected ? 0x123445 : 0x10202d,
          hoverFill: isSelected ? 0x123445 : undefined,
          stroke: isSelected ? this.theme.border : undefined,
          selected: isSelected,
          variant: 'secondary',
          compact: true
        }
      ).setDepth(DEPTHS.hud);
      this.slotButtons.push(button);
    }

    const next = new Button(
      this,
      948,
      188,
      76,
      58,
      '>',
      () =>
        this.loadSlot(Math.min(this.levelSystem.count - 1, pageStart + pageSize), 'Next slots.'),
      {
        disabled: pageEnd >= this.levelSystem.count,
        variant: 'ghost',
        compact: true
      }
    ).setDepth(DEPTHS.hud);
    this.slotButtons.push(next);
  }

  private renderPaletteButtons(): void {
    this.paletteButtons.splice(0).forEach((button) => button.destroy(true));

    const startX = 148;
    const gap = 112;

    EDITOR_PALETTE.forEach((cell, index) => {
      const definition = EDITOR_CELL_DEFINITIONS[cell];
      const isSelected = cell === this.selectedCell;
      const button = new Button(
        this,
        startX + index * gap,
        1582,
        96,
        62,
        definition.label,
        () => {
          this.selectedCell = cell;
          this.renderPaletteButtons();
          this.setStatus(`Brush ${definition.label}.`, false);
        },
        {
          fill: isSelected ? definition.color : 0x10202d,
          hoverFill: definition.color,
          stroke: isSelected ? this.theme.brickStroke : this.theme.borderDim,
          textColor: cell === '.' || cell === 'X' ? this.theme.text : this.theme.textDark,
          selected: isSelected,
          compact: true
        }
      ).setDepth(DEPTHS.hud);
      this.paletteButtons.push(button);
    });
  }

  private registerGridInput(): void {
    this.gridHitArea.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.painting = true;
      this.lastPaintedCell = '';
      this.paintPointer(pointer);
    });
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup', this.stopPainting, this);
    this.input.on('pointerupoutside', this.stopPainting, this);
  }

  private shutdownEditor(): void {
    this.input.off('pointermove', this.handlePointerMove, this);
    this.input.off('pointerup', this.stopPainting, this);
    this.input.off('pointerupoutside', this.stopPainting, this);
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.painting || !pointer.isDown) {
      return;
    }

    this.paintPointer(pointer);
  }

  private stopPainting(): void {
    this.painting = false;
    this.lastPaintedCell = '';
  }

  private paintPointer(pointer: Phaser.Input.Pointer): void {
    const cell = this.getCellAt(pointer.x, pointer.y);

    if (!cell) {
      return;
    }

    const key = `${cell.row}:${cell.col}`;

    if (key === this.lastPaintedCell) {
      return;
    }

    this.lastPaintedCell = key;
    const rowChars = [...this.rows[cell.row]];

    if (rowChars[cell.col] === this.selectedCell) {
      return;
    }

    rowChars[cell.col] = this.selectedCell;
    this.rows[cell.row] = rowChars.join('');
    this.drawGrid();
  }

  private getCellAt(x: number, y: number): { row: number; col: number } | null {
    const localX = x - GRID_LEFT;
    const localY = y - GRID_TOP;

    if (localX < 0 || localY < 0 || localX >= GRID_WIDTH || localY >= GRID_HEIGHT) {
      return null;
    }

    const col = Math.floor(localX / CELL_STEP);
    const row = Math.floor(localY / CELL_STEP);

    if (row < 0 || row >= EDITOR_GRID_ROWS || col < 0 || col >= EDITOR_GRID_COLS) {
      return null;
    }

    return { row, col };
  }

  private loadSlot(slotIndex: number, message: string): void {
    this.slotIndex = Math.floor(clamp(slotIndex, 0, this.levelSystem.count - 1));
    const pattern = this.levelSystem.getPatternForEditing(this.slotIndex);
    this.rows = normalizeEditorRows(pattern.rows);
    this.slotLabel.setText(
      `Slot ${this.slotIndex + 1}: ${pattern.name}${this.levelSystem.hasCustomLevelOverride(this.slotIndex) ? ' *custom' : ''}`
    );
    this.renderSlotButtons();
    this.drawGrid();
    this.setStatus(message, false);
  }

  private drawGrid(): void {
    this.gridGraphics.clear();
    this.gridGraphics.fillStyle(this.theme.surface, 1);
    this.gridGraphics.fillRect(GRID_LEFT - 8, GRID_TOP - 8, GRID_WIDTH + 16, GRID_HEIGHT + 16);
    this.gridGraphics.lineStyle(2, this.theme.borderDim, 0.42);
    this.gridGraphics.strokeRect(GRID_LEFT - 4, GRID_TOP - 4, GRID_WIDTH + 8, GRID_HEIGHT + 8);

    for (let row = 0; row < EDITOR_GRID_ROWS; row += 1) {
      for (let col = 0; col < EDITOR_GRID_COLS; col += 1) {
        const cell = this.rows[row][col] as EditorCell;
        const definition = EDITOR_CELL_DEFINITIONS[cell] ?? EDITOR_CELL_DEFINITIONS['.'];
        const x = GRID_LEFT + col * CELL_STEP;
        const y = GRID_TOP + row * CELL_STEP;

        this.gridGraphics.fillStyle(definition.color, cell === '.' ? 0.24 : 1);
        this.gridGraphics.fillRect(x, y, CELL_SIZE, CELL_SIZE);
        this.gridGraphics.lineStyle(
          1,
          cell === '.' ? this.theme.borderDim : this.theme.brickStroke,
          0.52
        );
        this.gridGraphics.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
      }
    }

    this.gridGraphics.lineStyle(4, this.theme.border, 0.82);
    this.gridGraphics.strokeRect(GRID_LEFT - 8, GRID_TOP - 8, GRID_WIDTH + 16, GRID_HEIGHT + 16);
  }

  private saveCurrentSlot(): boolean {
    const validation = validateEditorRows(this.rows);

    if (!validation.valid) {
      this.setStatus(validation.message, true);
      return false;
    }

    this.saveSystem.setCustomLevelOverride(
      this.slotIndex,
      this.rows,
      `Custom ${this.slotIndex + 1}`
    );
    this.slotLabel.setText(`Slot ${this.slotIndex + 1}: Custom ${this.slotIndex + 1} *custom`);
    this.renderSlotButtons();
    this.setStatus(`Slot ${this.slotIndex + 1} saved.`, false);
    return true;
  }

  private playCurrentSlot(): void {
    if (!this.saveCurrentSlot()) {
      return;
    }

    this.scene.start('GameScene', { levelIndex: this.slotIndex, source: 'custom' });
  }

  private clearGrid(): void {
    this.rows = createEmptyEditorRows();
    this.drawGrid();
    this.setStatus('Grid cleared. Add at least one breakable block before saving.', true);
  }

  private resetSlot(): void {
    this.saveSystem.removeCustomLevelOverride(this.slotIndex);
    this.loadSlot(this.slotIndex, `Slot ${this.slotIndex + 1} restored to campaign map.`);
  }

  private setStatus(message: string, isError: boolean): void {
    this.statusText.setColor(
      isError ? '#ff7d92' : `#${this.theme.primary.toString(16).padStart(6, '0')}`
    );
    this.statusText.setText(message);
  }
}
