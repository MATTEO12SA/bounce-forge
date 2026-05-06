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
import { decodeCreativeLevelCode, encodeCreativeLevelCode } from '../levels/levelShare';
import { AdminApiSystem } from '../systems/AdminApiSystem';
import { CampaignOverrideSystem } from '../systems/CampaignOverrideSystem';
import { LevelSystem } from '../systems/LevelSystem';
import { SaveSystem } from '../systems/SaveSystem';
import { Button } from '../ui/Button';
import { drawPanel, drawScreenBackground } from '../ui/sceneChrome';
import { DEPTHS, GAME_TITLE, WORLD_HEIGHT, WORLD_WIDTH } from '../utils/constants';
import { clamp } from '../utils/math';

interface LevelEditorSceneData {
  slotIndex?: number;
  mode?: 'creative' | 'admin';
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
  private adminApi = new AdminApiSystem();
  private theme!: ThemeDefinition;
  private rows: string[] = createEmptyEditorRows();
  private selectedCell: EditorCell = '1';
  private slotIndex = 0;
  private mode: 'creative' | 'admin' = 'creative';
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private gridHitArea!: Phaser.GameObjects.Zone;
  private slotLabel!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private readonly slotButtons: Button[] = [];
  private readonly paletteButtons: Button[] = [];
  private baselineRows: string[] = createEmptyEditorRows();
  private readonly undoStack: string[][] = [];
  private readonly redoStack: string[][] = [];
  private currentSlotName = '';
  private currentSavedSuffix = '';
  private painting = false;
  private lastPaintedCell = '';
  private isDirty = false;

  public constructor() {
    super('LevelEditorScene');
  }

  public create(data: LevelEditorSceneData): void {
    this.saveSystem = new SaveSystem();
    this.levelSystem = new LevelSystem(this.saveSystem);
    this.theme = getTheme(this.saveSystem.snapshot().preferences.themeId);
    this.mode = data.mode === 'admin' ? 'admin' : 'creative';
    this.slotIndex = Math.floor(clamp(data.slotIndex ?? 0, 0, this.levelSystem.count - 1));
    this.selectedCell = '1';
    this.undoStack.splice(0);
    this.redoStack.splice(0);
    this.isDirty = false;
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
      .text(WORLD_WIDTH / 2, 124, this.mode === 'admin' ? 'ADMIN EDITOR' : 'MODE CREATIF', {
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

    new Button(this, 134, 1644, 150, 62, 'SAVE', () => void this.saveCurrentSlot(), {
      compact: true
    }).setDepth(DEPTHS.hud);
    new Button(this, 300, 1644, 150, 62, 'PLAY', () => void this.playCurrentSlot(), {
      selected: true,
      compact: true
    }).setDepth(DEPTHS.hud);
    new Button(this, 466, 1644, 150, 62, 'UNDO', () => this.undoEdit(), {
      variant: 'secondary',
      compact: true
    }).setDepth(DEPTHS.hud);
    new Button(this, 632, 1644, 150, 62, 'REDO', () => this.redoEdit(), {
      variant: 'secondary',
      compact: true
    }).setDepth(DEPTHS.hud);
    new Button(this, 798, 1644, 150, 62, 'CLEAR', () => this.clearGrid(), {
      variant: 'danger',
      compact: true
    }).setDepth(DEPTHS.hud);
    new Button(this, 964, 1644, 150, 62, 'RESET', () => void this.resetSlot(), {
      variant: 'danger',
      compact: true
    }).setDepth(DEPTHS.hud);

    new Button(this, 216, 1724, 260, 62, 'EXPORT CODE', () => this.exportCurrentSlot(), {
      variant: 'secondary',
      compact: true
    }).setDepth(DEPTHS.hud);
    new Button(this, 540, 1724, 260, 62, 'IMPORT CODE', () => this.importLevelCode(), {
      variant: 'secondary',
      compact: true
    }).setDepth(DEPTHS.hud);
    new Button(this, 864, 1724, 260, 62, 'COPY LOCAL', () => this.copyToCreativeSlot(), {
      variant: 'secondary',
      compact: true
    }).setDepth(DEPTHS.hud);

    new Button(
      this,
      WORLD_WIDTH / 2,
      1870,
      420,
      70,
      'BACK',
      () => {
        this.goBack();
      },
      { variant: 'ghost' }
    ).setDepth(DEPTHS.hud);

    this.statusText = this.add
      .text(WORLD_WIDTH / 2, 1802, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '24px',
        fontStyle: '800',
        color: `#${this.theme.primary.toString(16).padStart(6, '0')}`,
        align: 'center',
        wordWrap: { width: 860 }
      })
      .setOrigin(0.5)
      .setDepth(DEPTHS.hud);
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
      const visibleIndex = index - pageStart;
      const isSelected = index === this.slotIndex;
      const hasSavedMap =
        this.mode === 'admin'
          ? this.levelSystem.hasAdminCampaignOverride(index)
          : this.levelSystem.hasCreativeLevelSlot(index);
      const button = new Button(
        this,
        startX + visibleIndex * gap,
        188,
        104,
        58,
        `${index + 1}${hasSavedMap ? '*' : ''}`,
        () =>
          this.loadSlot(
            index,
            `${this.mode === 'admin' ? 'Campaign' : 'Creative'} ${index + 1} loaded.`
          ),
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
        1568,
        96,
        54,
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
      this.pushUndoSnapshot();
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
    this.markDirty();
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
    const pattern =
      this.mode === 'admin'
        ? this.levelSystem.getAdminPatternForEditing(this.slotIndex)
        : this.levelSystem.getCreativePatternForEditing(this.slotIndex);
    this.currentSavedSuffix =
      this.mode === 'admin'
        ? this.levelSystem.hasAdminCampaignOverride(this.slotIndex)
          ? ' *admin'
          : ''
        : this.levelSystem.hasCreativeLevelSlot(this.slotIndex)
          ? ' *local'
          : '';
    this.currentSlotName = pattern.name;
    this.rows = normalizeEditorRows(pattern.rows);
    this.baselineRows = this.cloneRows(this.rows);
    this.undoStack.splice(0);
    this.redoStack.splice(0);
    this.isDirty = false;
    this.refreshSlotLabel();
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

  private async saveCurrentSlot(): Promise<boolean> {
    const validation = validateEditorRows(this.rows);

    if (!validation.valid) {
      this.setStatus(validation.message, true);
      return false;
    }

    if (this.mode === 'admin') {
      try {
        this.setStatus('Saving campaign level...', false);
        const fallback = this.levelSystem.getCampaignLevel(this.slotIndex);
        const override = await this.adminApi.saveCampaignOverride(
          this.slotIndex,
          this.rows,
          fallback.name
        );
        CampaignOverrideSystem.setOverride(override);
        this.currentSlotName = override.name;
        this.currentSavedSuffix = ' *admin';
        this.baselineRows = this.cloneRows(this.rows);
        this.isDirty = false;
        this.refreshSlotLabel();
        this.renderSlotButtons();
        this.setStatus(`Campaign level ${this.slotIndex + 1} saved for everyone.`, false);
        return true;
      } catch (error) {
        this.setStatus(error instanceof Error ? error.message : 'Admin save failed.', true);
        return false;
      }
    }

    this.saveSystem.setCreativeLevelSlot(
      this.slotIndex,
      this.rows,
      `Creative ${this.slotIndex + 1}`
    );
    this.currentSlotName = `Creative ${this.slotIndex + 1}`;
    this.currentSavedSuffix = ' *local';
    this.baselineRows = this.cloneRows(this.rows);
    this.isDirty = false;
    this.refreshSlotLabel();
    this.renderSlotButtons();
    this.setStatus(`Creative ${this.slotIndex + 1} saved locally.`, false);
    return true;
  }

  private async playCurrentSlot(): Promise<void> {
    if (!(await this.saveCurrentSlot())) {
      return;
    }

    this.scene.start('GameScene', {
      levelIndex: this.slotIndex,
      source: this.mode === 'admin' ? 'campaign' : 'creative',
      editorReturn: {
        mode: this.mode,
        slotIndex: this.slotIndex
      }
    });
  }

  private clearGrid(): void {
    this.pushUndoSnapshot();
    this.rows = createEmptyEditorRows();
    this.markDirty();
    this.drawGrid();
    this.setStatus('Grid cleared. Add at least one breakable block before saving.', true);
  }

  private async resetSlot(): Promise<void> {
    if (this.mode === 'admin') {
      if (
        typeof window.confirm === 'function' &&
        !window.confirm(`Reset campaign override ${this.slotIndex + 1} for everyone?`)
      ) {
        return;
      }

      this.pushUndoSnapshot();
      this.setStatus('Resetting campaign override...', false);

      try {
        await this.adminApi.deleteCampaignOverride(this.slotIndex);
        CampaignOverrideSystem.removeOverride(this.slotIndex);
        const pattern = this.levelSystem.getOfficialPatternForEditing(this.slotIndex);
        this.rows = normalizeEditorRows(pattern.rows);
        this.currentSlotName = pattern.name;
        this.currentSavedSuffix = '';
        this.baselineRows = this.cloneRows(this.rows);
        this.isDirty = false;
        this.refreshSlotLabel();
        this.renderSlotButtons();
        this.drawGrid();
        this.setStatus(`Campaign override ${this.slotIndex + 1} reset.`, false);
      } catch (error) {
        this.setStatus(error instanceof Error ? error.message : 'Admin reset failed.', true);
      }
      return;
    }

    this.pushUndoSnapshot();
    this.saveSystem.removeCreativeLevelSlot(this.slotIndex);
    this.loadSlot(this.slotIndex, `Creative ${this.slotIndex + 1} reset to empty.`);
  }

  private copyToCreativeSlot(): void {
    const validation = validateEditorRows(this.rows);

    if (!validation.valid) {
      this.setStatus(validation.message, true);
      return;
    }

    const existing = this.saveSystem.getCreativeLevelSlot(this.slotIndex);
    if (
      existing &&
      typeof window.confirm === 'function' &&
      !window.confirm(`Overwrite Creative ${this.slotIndex + 1}?`)
    ) {
      return;
    }

    try {
      this.saveSystem.setCreativeLevelSlot(
        this.slotIndex,
        this.rows,
        `Creative ${this.slotIndex + 1}`
      );
      this.setStatus(`Copied to Creative ${this.slotIndex + 1}.`, false);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Creative copy failed.', true);
    }
  }

  private undoEdit(): void {
    const previous = this.undoStack.pop();

    if (!previous) {
      this.setStatus('Nothing to undo.', true);
      return;
    }

    this.redoStack.push(this.cloneRows(this.rows));
    this.rows = this.cloneRows(previous);
    this.markDirty();
    this.drawGrid();
    this.setStatus('Undo.', false);
  }

  private redoEdit(): void {
    const next = this.redoStack.pop();

    if (!next) {
      this.setStatus('Nothing to redo.', true);
      return;
    }

    this.undoStack.push(this.cloneRows(this.rows));
    this.rows = this.cloneRows(next);
    this.markDirty();
    this.drawGrid();
    this.setStatus('Redo.', false);
  }

  private exportCurrentSlot(): void {
    try {
      const code = encodeCreativeLevelCode(this.rows, this.currentSlotName);
      void navigator.clipboard?.writeText(code).catch(() => undefined);
      window.prompt?.('Bounce Forge level code', code);
      this.setStatus('Export code copied when clipboard is available.', false);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Export failed.', true);
    }
  }

  private importLevelCode(): void {
    const code = window.prompt?.('Paste Bounce Forge level code')?.trim();

    if (!code) {
      return;
    }

    try {
      const decoded = decodeCreativeLevelCode(code);
      this.pushUndoSnapshot();
      this.rows = decoded.rows;
      this.currentSlotName = decoded.name ?? this.currentSlotName;
      this.markDirty();
      this.drawGrid();
      this.setStatus('Imported level code. Save to keep it.', false);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Import failed.', true);
    }
  }

  private goBack(): void {
    if (
      this.isDirty &&
      typeof window.confirm === 'function' &&
      !window.confirm('Leave editor without saving changes?')
    ) {
      return;
    }

    this.scene.start(this.mode === 'admin' ? 'AdminMenuScene' : 'MainMenuScene');
  }

  private pushUndoSnapshot(): void {
    this.undoStack.push(this.cloneRows(this.rows));
    this.redoStack.splice(0);

    if (this.undoStack.length > 60) {
      this.undoStack.shift();
    }
  }

  private markDirty(): void {
    this.isDirty = !this.rowsEqual(this.rows, this.baselineRows);
    this.refreshSlotLabel();
  }

  private refreshSlotLabel(): void {
    this.slotLabel.setText(
      `${this.mode === 'admin' ? 'Campaign' : 'Creative'} ${this.slotIndex + 1}: ${this.currentSlotName}${this.currentSavedSuffix}${this.isDirty ? ' *unsaved' : ''}`
    );
  }

  private cloneRows(rows: readonly string[]): string[] {
    return [...rows];
  }

  private rowsEqual(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((row, index) => row === right[index]);
  }

  private setStatus(message: string, isError: boolean): void {
    this.statusText.setColor(
      isError ? '#ff7d92' : `#${this.theme.primary.toString(16).padStart(6, '0')}`
    );
    this.statusText.setText(message);
  }
}
