import { createEmptyRows } from '../../../shared/editorGridRules.mjs';
import { getPowerUpDefinition, POWER_UP_TYPES, type PowerUpType } from '../../game/config/powerUps';
import { estimateDifficulty, sealedBricks } from '../../game/levels/levelChecks';
import {
  DESCEND_CHOICES,
  sameOptions,
  sanitizeLevelOptions,
  type LevelOptions
} from '../../game/levels/levelOptions';
import { brickLookForSymbol } from '../../game/levels/levelFactory';
import { BRICK_H, BRICK_W, paintBrick } from '../../game/render/brickArt';
import type { SaveSystem } from '../../game/systems/SaveSystem';
import { clear, h, icon } from '../dom';
import { t, type MessageKey } from '../i18n';
import { clearDraft, readDraft, writeDraft } from './drafts';
import {
  brushCells,
  brushPath,
  COLS,
  EditorModel,
  lineCells,
  rectCells,
  ROWS,
  type Cell,
  type Symmetry,
  type Tool as BaseTool
} from './editorModel';
import { generateLevel, randomSeed } from './generator';
import { artCells, STAMP_IDS, STAMPS, textArt, type StampId } from './stamps';

type Tool = BaseTool | 'stamp' | 'text';

export interface EditorDialogAction {
  label: string;
  variant: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: string;
  action: () => void;
}

export interface EditorHost {
  save: SaveSystem;
  toast(message: string): void;
  openDialog(
    title: string,
    body: HTMLElement[],
    actions: EditorDialogAction[],
    onEscape?: () => void
  ): void;
  closeOverlays(): void;
  navigate(hash: string): void;
  testDraft(slotIndex: number, name: string, rows: string[], options?: LevelOptions): void;
  shareCode(rows: string[], name: string, options?: LevelOptions): void;
}

/** World units of one grid step, the same as in the game (21 × 19 bricks with a 3 px gap). */
const PITCH_X = 24;
const PITCH_Y = 22;
const BRICK_DRAW_W = 21;
const BRICK_DRAW_H = 19;
const FOOTER = 96;
const WORLD_W = COLS * PITCH_X;
const GRID_H = ROWS * PITCH_Y;
const WORLD_H = GRID_H + FOOTER;
/** Bricks drawn from this row down are flagged as too close to the paddle. */
const LOW_ROW = 46;
const PALETTE = [
  '1',
  '2',
  '3',
  'E',
  'B',
  'S',
  'X',
  'C',
  'K',
  'G',
  'R',
  'I',
  'M',
  'O',
  'T',
  'F'
] as const;
/** Classic bricks first; mechanisms get their own group in the palette. */
const FIRST_MECHANISM = 7;
const TOOLS: Array<[Tool, string, MessageKey, string]> = [
  ['brush', 'brush', 'editor.tool.brush', 'b'],
  ['eraser', 'eraser', 'editor.tool.eraser', 'e'],
  ['rect', 'square', 'editor.tool.rect', 'r'],
  ['line', 'line', 'editor.tool.line', 'l'],
  ['fill', 'bucket', 'editor.tool.fill', 'f'],
  ['picker', 'picker', 'editor.tool.picker', 'i'],
  ['stamp', 'stamp', 'editor.tool.stamp', 't'],
  ['text', 'text', 'editor.tool.text', 'x']
];
const SYMMETRIES: Symmetry[] = ['none', 'vertical', 'quad'];

const spriteCache = new Map<string, HTMLCanvasElement>();

/** The game's own brick art for a symbol, painted once. */
export function brickSprite(symbol: string): HTMLCanvasElement | null {
  const cached = spriteCache.get(symbol);
  if (cached) return cached;
  const look = brickLookForSymbol(symbol);
  if (!look) return null;
  const canvas = document.createElement('canvas');
  canvas.width = BRICK_W;
  canvas.height = BRICK_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paintBrick(ctx, look.kind, look.color, 0);
  spriteCache.set(symbol, canvas);
  return canvas;
}

/** Full-screen HTML level editor drawing the real game bricks. */
export class EditorScreen {
  public readonly element: HTMLElement;
  private readonly model: EditorModel;
  private readonly canvas: HTMLCanvasElement;
  private readonly wrap: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly statsLine: HTMLElement;
  private readonly stars: HTMLElement;
  private readonly warnings: HTMLElement;
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly paletteButtons = new Map<string, HTMLButtonElement>();
  private readonly paletteCounts = new Map<string, HTMLElement>();
  private readonly sizeButtons = new Map<number, HTMLButtonElement>();
  private readonly symmetryButtons = new Map<Symmetry, HTMLButtonElement>();
  private readonly stampButtons = new Map<StampId, HTMLButtonElement>();
  private readonly stampPanel: HTMLElement;
  private readonly textPanel: HTMLElement;
  private readonly textInput: HTMLInputElement;
  private readonly cleanups: Array<() => void> = [];

  private tool: Tool = 'brush';
  private symbol: string = '1';
  private size = 2;
  private stamp: StampId = 'heart';
  private zoom = 1;
  private fitScale = 1;
  private savedName: string;
  private options: LevelOptions | undefined;
  private savedOptions: LevelOptions | undefined;
  private readonly settingsSummary: HTMLElement;
  private hover: Cell | null = null;
  private dragStart: Cell | null = null;
  private lastCell: Cell | null = null;
  private stroke: { button: number; tool: Tool; symbol: string } | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { distance: number; zoom: number; midX: number; midY: number } | null = null;
  private renderQueued = false;
  private draftTimer = 0;

  public constructor(
    private readonly host: EditorHost,
    private readonly slotIndex: number
  ) {
    const slot = host.save.getCreativeLevelSlot(slotIndex);
    const defaultName = t('create.slot', { n: slotIndex + 1 });
    this.savedName = slot?.name ?? defaultName;
    this.savedOptions = sanitizeLevelOptions(slot?.options);
    this.options = this.savedOptions;
    this.settingsSummary = h('p', { class: 'editor-settings-summary' });
    this.model = new EditorModel(slot?.rows ?? createEmptyRows());

    this.canvas = h('canvas', {
      class: 'editor-canvas',
      role: 'img',
      'aria-label': t('editor.canvasLabel')
    });
    this.wrap = h(
      'div',
      { class: 'editor-canvas-wrap' },
      h('div', { class: 'editor-canvas-inner' }, this.canvas)
    );
    this.nameInput = h('input', {
      class: 'editor-name',
      type: 'text',
      maxlength: '40',
      'aria-label': t('editor.name'),
      value: this.savedName
    });
    this.status = h('span', { class: 'editor-status', role: 'status' });
    this.undoButton = this.iconButton('undo', t('editor.undo'), () => this.model.undo());
    this.redoButton = this.iconButton('redo', t('editor.redo'), () => this.model.redo());
    this.statsLine = h('p', { class: 'editor-stats' });
    this.stars = h('span', { class: 'editor-stars' });
    this.warnings = h('ul', { class: 'editor-warnings', role: 'list' });
    this.textInput = h('input', {
      class: 'editor-text-input',
      type: 'text',
      maxlength: '12',
      placeholder: t('editor.textPlaceholder'),
      'aria-label': t('editor.textLabel'),
      value: t('editor.textPlaceholder')
    });
    this.stampPanel = this.buildStampPanel();
    this.textPanel = h(
      'div',
      { class: 'editor-group editor-text-panel' },
      h('label', { class: 'editor-group-title' }, t('editor.textLabel')),
      this.textInput
    );

    this.element = this.build();
    this.restoreDraft(slot === null);

    this.cleanups.push(this.model.onChange(() => this.onModelChange()));
    this.bindCanvas();
    this.bindKeyboard();
    this.nameInput.addEventListener('input', () => {
      this.refreshStatus();
      this.scheduleDraft();
    });
    this.textInput.addEventListener('input', () => this.queueRender());
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.fit(false));
      observer.observe(this.wrap);
      this.cleanups.push(() => observer.disconnect());
    }
    this.selectTool('brush');
    this.selectSymbol('1');
    this.selectSize(2);
    this.selectSymmetry('none');
    this.onModelChange();
    window.requestAnimationFrame(() => this.fit(true));
  }

  public destroy(): void {
    window.clearTimeout(this.draftTimer);
    this.flushDraft();
    this.cleanups.splice(0).forEach((cleanup) => cleanup());
  }

  /** Tries to leave; resolves false when the player cancelled. */
  public requestLeave(target = '#/create'): void {
    if (!this.isDirty()) {
      clearDraft(this.slotIndex);
      this.host.navigate(target);
      return;
    }
    this.host.openDialog(
      t('editor.leaveTitle'),
      [h('p', {}, t('editor.leaveBody', { name: this.currentName() }))],
      [
        { label: t('common.cancel'), variant: 'ghost', action: () => this.host.closeOverlays() },
        {
          label: t('editor.leaveDiscard'),
          variant: 'danger',
          action: () => {
            this.host.closeOverlays();
            this.model.markSaved();
            this.nameInput.value = this.savedName;
            this.options = this.savedOptions;
            clearDraft(this.slotIndex);
            this.host.navigate(target);
          }
        },
        {
          label: t('editor.leaveSave'),
          variant: 'primary',
          icon: 'save',
          action: () => {
            this.host.closeOverlays();
            if (this.save()) this.host.navigate(target);
          }
        }
      ],
      () => this.host.closeOverlays()
    );
  }

  // ------------------------------------------------------------------ building

  private build(): HTMLElement {
    const bar = h(
      'header',
      { class: 'editor-bar' },
      h(
        'button',
        {
          class: 'icon-button',
          type: 'button',
          title: t('editor.back'),
          'aria-label': t('editor.back'),
          onclick: () => this.requestLeave()
        },
        icon('arrowLeft')
      ),
      h('div', { class: 'editor-title' }, this.nameInput, this.status),
      h(
        'div',
        { class: 'editor-bar-actions' },
        this.undoButton,
        this.redoButton,
        h(
          'button',
          {
            class: 'button button-ghost button-sm editor-hide-sm',
            type: 'button',
            onclick: () => this.share()
          },
          icon('share'),
          t('editor.share')
        ),
        h(
          'button',
          {
            class: 'button button-secondary button-sm',
            type: 'button',
            onclick: () => this.test()
          },
          icon('play'),
          t('editor.test')
        ),
        h(
          'button',
          { class: 'button button-primary button-sm', type: 'button', onclick: () => this.save() },
          icon('save'),
          t('editor.save')
        )
      )
    );

    const tools = h(
      'div',
      { class: 'editor-tool-grid', role: 'toolbar', 'aria-label': t('editor.tools') },
      ...TOOLS.map(([tool, iconName, label]) => {
        const button = this.iconButton(iconName, t(label), () => this.selectTool(tool));
        button.classList.add('editor-tool');
        this.toolButtons.set(tool, button);
        return button;
      })
    );

    const sizes = h(
      'div',
      { class: 'editor-seg', role: 'group', 'aria-label': t('editor.size') },
      ...[1, 2, 3].map((size) => {
        const button = h(
          'button',
          { class: 'editor-seg-item', type: 'button', onclick: () => this.selectSize(size) },
          `${size}×${size}`
        );
        this.sizeButtons.set(size, button);
        return button;
      })
    );

    const symmetry = h(
      'div',
      { class: 'editor-seg', role: 'group', 'aria-label': t('editor.symmetry') },
      ...SYMMETRIES.map((value) => {
        const button = h(
          'button',
          { class: 'editor-seg-item', type: 'button', onclick: () => this.selectSymmetry(value) },
          t(`editor.symmetry.${value}` as MessageKey)
        );
        this.symmetryButtons.set(value, button);
        return button;
      })
    );

    const move = h(
      'div',
      { class: 'editor-move', role: 'group', 'aria-label': t('editor.move') },
      this.iconButton('arrowUp', t('editor.moveUp'), () => this.model.shiftAll(0, -1)),
      this.iconButton('arrowLeft', t('editor.moveLeft'), () => this.model.shiftAll(-1, 0)),
      this.iconButton('arrowRight', t('editor.moveRight'), () => this.model.shiftAll(1, 0)),
      this.iconButton('arrowDown', t('editor.moveDown'), () => this.model.shiftAll(0, 1))
    );

    const left = h(
      'aside',
      { class: 'editor-side editor-side-tools' },
      h(
        'div',
        { class: 'editor-group' },
        h('h2', { class: 'editor-group-title' }, t('editor.tools')),
        tools
      ),
      this.stampPanel,
      this.textPanel,
      h(
        'div',
        { class: 'editor-group' },
        h('h2', { class: 'editor-group-title' }, t('editor.size')),
        sizes
      ),
      h(
        'div',
        { class: 'editor-group' },
        h('h2', { class: 'editor-group-title' }, t('editor.symmetry')),
        symmetry
      ),
      h(
        'div',
        { class: 'editor-group' },
        h('h2', { class: 'editor-group-title' }, t('editor.move')),
        move
      ),
      h(
        'div',
        { class: 'editor-group' },
        h('h2', { class: 'editor-group-title' }, t('editor.settingsTitle')),
        h(
          'button',
          {
            class: 'button button-secondary button-sm',
            type: 'button',
            onclick: () => this.openSettings()
          },
          icon('settings'),
          t('editor.settings')
        ),
        this.settingsSummary
      ),
      h(
        'div',
        { class: 'editor-group editor-row' },
        h(
          'button',
          {
            class: 'button button-secondary button-sm',
            type: 'button',
            onclick: () => this.surprise()
          },
          icon('dice'),
          t('editor.surprise')
        ),
        h(
          'button',
          {
            class: 'button button-ghost button-sm',
            type: 'button',
            onclick: () => this.model.replace(createEmptyRows())
          },
          icon('trash'),
          t('editor.clear')
        )
      )
    );

    const paletteButton = (symbol: string, index: number): HTMLButtonElement => {
      const swatch = h('canvas', {
        class: 'editor-swatch',
        width: String(BRICK_W),
        height: String(BRICK_H),
        'aria-hidden': 'true'
      });
      const sprite = brickSprite(symbol);
      if (sprite) swatch.getContext('2d')?.drawImage(sprite, 0, 0);
      const count = h('span', { class: 'editor-swatch-count' });
      this.paletteCounts.set(symbol, count);
      const button = h(
        'button',
        {
          class: 'editor-brick',
          type: 'button',
          role: 'radio',
          'aria-checked': 'false',
          onclick: () => this.selectSymbol(symbol)
        },
        swatch,
        h('span', { class: 'editor-brick-name' }, t(`editor.brick.${symbol}` as MessageKey)),
        index < 9 ? h('kbd', {}, String(index + 1)) : h('span'),
        count
      );
      this.paletteButtons.set(symbol, button);
      return button;
    };
    const palette = h(
      'div',
      { class: 'editor-palette', role: 'radiogroup', 'aria-label': t('editor.bricksTitle') },
      ...PALETTE.slice(0, FIRST_MECHANISM).map((symbol, index) => paletteButton(symbol, index))
    );
    const mechanisms = h(
      'div',
      { class: 'editor-palette', role: 'radiogroup', 'aria-label': t('editor.mechanisms') },
      ...PALETTE.slice(FIRST_MECHANISM).map((symbol, index) =>
        paletteButton(symbol, index + FIRST_MECHANISM)
      )
    );

    const right = h(
      'aside',
      { class: 'editor-side editor-side-palette' },
      h(
        'div',
        { class: 'editor-group' },
        h('h2', { class: 'editor-group-title' }, t('editor.bricksTitle')),
        palette
      ),
      h(
        'div',
        { class: 'editor-group' },
        h('h2', { class: 'editor-group-title' }, t('editor.mechanisms')),
        mechanisms
      ),
      h(
        'div',
        { class: 'editor-group editor-check' },
        h('h2', { class: 'editor-group-title' }, t('editor.difficulty'), ' ', this.stars),
        this.statsLine,
        this.warnings
      ),
      h('p', { class: 'editor-hint' }, t('editor.hint'))
    );

    const zoom = h(
      'div',
      { class: 'editor-zoom' },
      this.iconButton('minus', t('editor.zoomOut'), () => this.setZoom(this.zoom / 1.25)),
      this.iconButton('maximize', t('editor.zoomFit'), () => this.fit(true)),
      this.iconButton('plus', t('editor.zoomIn'), () => this.setZoom(this.zoom * 1.25))
    );

    return h(
      'section',
      { class: 'editor', 'aria-label': t('editor.title') },
      bar,
      h(
        'div',
        { class: 'editor-body' },
        left,
        h('div', { class: 'editor-stage' }, this.wrap, zoom),
        right
      )
    );
  }

  private buildStampPanel(): HTMLElement {
    const grid = h(
      'div',
      { class: 'editor-stamp-grid' },
      ...STAMP_IDS.map((id) => {
        const preview = h('canvas', {
          class: 'editor-stamp-preview',
          width: '28',
          height: '28',
          'aria-hidden': 'true'
        });
        const ctx = preview.getContext('2d');
        const art = STAMPS[id];
        if (ctx) {
          const width = Math.max(...art.map((line) => line.length));
          const cell = Math.floor(26 / Math.max(width, art.length));
          const offsetX = (28 - width * cell) / 2;
          const offsetY = (28 - art.length * cell) / 2;
          ctx.fillStyle = '#ffb423';
          art.forEach((line, r) =>
            [...line].forEach((pixel, c) => {
              if (pixel === '#')
                ctx.fillRect(offsetX + c * cell, offsetY + r * cell, cell - 0.5, cell - 0.5);
            })
          );
        }
        const button = h(
          'button',
          {
            class: 'editor-stamp',
            type: 'button',
            title: t(`editor.stamp.${id}` as MessageKey),
            'aria-label': t(`editor.stamp.${id}` as MessageKey),
            'aria-pressed': 'false',
            onclick: () => this.selectStamp(id)
          },
          preview
        );
        this.stampButtons.set(id, button);
        return button;
      })
    );
    return h(
      'div',
      { class: 'editor-group editor-stamp-panel' },
      h('h2', { class: 'editor-group-title' }, t('editor.stamps')),
      grid
    );
  }

  private iconButton(name: string, label: string, onClick: () => void): HTMLButtonElement {
    return h(
      'button',
      { class: 'icon-button', type: 'button', title: label, 'aria-label': label, onclick: onClick },
      icon(name)
    );
  }

  // ------------------------------------------------------------------ state

  private selectTool(tool: Tool): void {
    this.tool = tool;
    this.toolButtons.forEach((button, key) => {
      button.classList.toggle('is-active', key === tool);
      button.setAttribute('aria-pressed', String(key === tool));
    });
    this.stampPanel.hidden = tool !== 'stamp';
    this.textPanel.hidden = tool !== 'text';
    this.canvas.dataset.tool = tool;
    this.queueRender();
  }

  private selectSymbol(symbol: string): void {
    this.symbol = symbol;
    this.paletteButtons.forEach((button, key) => {
      button.classList.toggle('is-active', key === symbol);
      button.setAttribute('aria-checked', String(key === symbol));
    });
    if (this.tool === 'eraser' || this.tool === 'picker') this.selectTool('brush');
    this.queueRender();
  }

  private selectSize(size: number): void {
    this.size = size;
    this.sizeButtons.forEach((button, key) =>
      button.setAttribute('aria-pressed', String(key === size))
    );
    this.queueRender();
  }

  private selectSymmetry(symmetry: Symmetry): void {
    this.model.symmetry = symmetry;
    this.symmetryButtons.forEach((button, key) =>
      button.setAttribute('aria-pressed', String(key === symmetry))
    );
    this.queueRender();
  }

  private selectStamp(id: StampId): void {
    this.stamp = id;
    this.stampButtons.forEach((button, key) =>
      button.setAttribute('aria-pressed', String(key === id))
    );
    this.selectTool('stamp');
  }

  private currentName(): string {
    return this.nameInput.value.trim() || this.savedName;
  }

  private isDirty(): boolean {
    return (
      this.model.isDirty ||
      this.currentName() !== this.savedName ||
      !sameOptions(this.options, this.savedOptions)
    );
  }

  private onModelChange(): void {
    const stats = this.model.stats();
    PALETTE.forEach((symbol) => {
      const count = stats.bySymbol[symbol] ?? 0;
      const label = this.paletteCounts.get(symbol);
      if (label) label.textContent = count > 0 ? String(count) : '';
    });
    this.statsLine.textContent = t('editor.stats', {
      breakable: stats.breakable,
      steel: stats.steel
    });
    const rows = this.model.rows();
    const difficulty = estimateDifficulty(rows, this.options);
    this.renderSettingsSummary();
    this.stars.textContent = '★'.repeat(difficulty) + '☆'.repeat(5 - difficulty);
    this.stars.setAttribute('aria-label', t('workshop.difficulty', { n: difficulty }));

    clear(this.warnings);
    const sealed = stats.breakable > 0 ? sealedBricks(rows).length : 0;
    const low = rows.slice(LOW_ROW).some((row) => /[^.]/.test(row));
    if (stats.breakable === 0)
      this.warnings.append(h('li', { class: 'is-error' }, t('editor.warn.empty')));
    if (sealed > 0)
      this.warnings.append(h('li', { class: 'is-error' }, t('editor.warn.sealed', { n: sealed })));
    if (low) this.warnings.append(h('li', { class: 'is-warning' }, t('editor.warn.low')));
    const portals = stats.bySymbol.T ?? 0;
    if ((stats.bySymbol.G ?? 0) > 0 && (stats.bySymbol.K ?? 0) === 0) {
      this.warnings.append(h('li', { class: 'is-warning' }, t('editor.warn.gatesNoKey')));
    }
    if (portals % 2 === 1) {
      this.warnings.append(h('li', { class: 'is-warning' }, t('editor.warn.lonePortal')));
    }
    if (this.warnings.childElementCount === 0)
      this.warnings.append(h('li', { class: 'is-ok' }, t('editor.ok')));

    this.undoButton.disabled = !this.model.canUndo;
    this.redoButton.disabled = !this.model.canRedo;
    this.refreshStatus();
    this.scheduleDraft();
    this.queueRender();
  }

  private refreshStatus(): void {
    const dirty = this.isDirty();
    this.status.textContent = dirty ? t('editor.unsaved') : t('editor.saved');
    this.status.classList.toggle('is-dirty', dirty);
  }

  // ------------------------------------------------------------------ drafts & actions

  private restoreDraft(isNewSlot: boolean): void {
    const draft = readDraft(this.slotIndex);
    if (!draft) return;
    const differs =
      draft.rows.join('\n') !== this.model.serialize() ||
      draft.name !== this.savedName ||
      !sameOptions(draft.options, this.savedOptions);
    if (!differs) return;
    this.model.replace(draft.rows);
    this.nameInput.value = draft.name;
    this.options = sanitizeLevelOptions(draft.options);
    if (!draft.fresh && !isNewSlot) this.host.toast(t('editor.draftRestored'));
  }

  private scheduleDraft(): void {
    window.clearTimeout(this.draftTimer);
    this.draftTimer = window.setTimeout(() => this.flushDraft(), 300);
  }

  private flushDraft(): void {
    if (this.isDirty()) {
      writeDraft(this.slotIndex, {
        name: this.currentName(),
        rows: this.model.rows(),
        options: this.options
      });
    } else {
      clearDraft(this.slotIndex);
    }
  }

  private checkPlayable(): boolean {
    const rows = this.model.rows();
    if (this.model.stats().breakable === 0) {
      this.host.toast(t('editor.warn.empty'));
      return false;
    }
    const sealed = sealedBricks(rows).length;
    if (sealed > 0) {
      this.host.toast(t('editor.warn.sealed', { n: sealed }));
      return false;
    }
    return true;
  }

  private save(): boolean {
    if (!this.checkPlayable()) return false;
    const name = this.currentName();
    try {
      this.host.save.setCreativeLevelSlot(
        this.slotIndex,
        this.model.rows(),
        name,
        Date.now(),
        this.options
      );
    } catch {
      this.host.toast(t('editor.warn.empty'));
      return false;
    }
    this.savedName = this.host.save.getCreativeLevelSlot(this.slotIndex)?.name ?? name;
    this.nameInput.value = this.savedName;
    this.savedOptions = this.options;
    this.model.markSaved();
    clearDraft(this.slotIndex);
    this.refreshStatus();
    this.host.toast(t('editor.savedToast', { name: this.savedName }));
    return true;
  }

  private test(): void {
    if (!this.checkPlayable()) return;
    window.clearTimeout(this.draftTimer);
    this.flushDraft();
    this.host.testDraft(this.slotIndex, this.currentName(), this.model.rows(), this.options);
  }

  private share(): void {
    if (!this.checkPlayable()) return;
    this.host.shareCode(this.model.rows(), this.currentName(), this.options);
  }

  // ------------------------------------------------------------------ level settings

  private setOptions(next: LevelOptions): void {
    this.options = sanitizeLevelOptions(next);
    this.onModelChange();
  }

  private renderSettingsSummary(): void {
    const options = this.options ?? {};
    const parts: string[] = [];
    if (options.powerUps) parts.push(t('editor.set.powerUpCount', { n: options.powerUps.length }));
    if (options.dropRate) parts.push(t(`editor.set.rate.${options.dropRate}` as MessageKey));
    if (options.lives) parts.push(t('editor.set.livesShort', { n: options.lives }));
    if (options.pace) parts.push(t(`editor.set.pace.${options.pace}` as MessageKey));
    if (options.descendEverySec)
      parts.push(t('editor.set.descendShort', { n: options.descendEverySec }));
    if (options.bonusRain) parts.push(t('editor.set.bonusRainShort'));
    if (options.storm) parts.push(t('editor.set.stormShort'));
    this.settingsSummary.textContent =
      parts.length > 0 ? parts.join(' · ') : t('editor.set.default');
  }

  /** Dialog with every level setting; changes apply immediately (and land in the draft). */
  private openSettings(): void {
    const segment = <T extends string | number>(
      label: string,
      values: Array<[T, string]>,
      current: T,
      onPick: (value: T) => void
    ): HTMLElement => {
      const group = h('div', { class: 'editor-seg', role: 'group', 'aria-label': label });
      const buttons = values.map(([value, text]) => {
        const button = h(
          'button',
          {
            class: 'editor-seg-item',
            type: 'button',
            'aria-pressed': String(value === current),
            onclick: () => {
              buttons.forEach((item) => item.setAttribute('aria-pressed', 'false'));
              button.setAttribute('aria-pressed', 'true');
              onPick(value);
            }
          },
          text
        );
        return button;
      });
      group.append(...buttons);
      return h(
        'div',
        { class: 'settings-row' },
        h('span', { class: 'settings-label' }, label),
        group
      );
    };
    const toggle = (
      label: string,
      checked: boolean,
      onChange: (value: boolean) => void
    ): HTMLElement => {
      const input = h('input', { type: 'checkbox' });
      input.checked = checked;
      input.addEventListener('change', () => onChange(input.checked));
      return h('label', { class: 'settings-toggle' }, input, h('span', {}, label));
    };
    const current = (): LevelOptions => ({ ...(this.options ?? {}) });

    const allowed = new Set<PowerUpType>(this.options?.powerUps ?? POWER_UP_TYPES);
    const chips = POWER_UP_TYPES.map((type) => {
      const definition = getPowerUpDefinition(type);
      const name = t(`power.${type}` as MessageKey).split(' — ')[0] ?? type;
      const chip = h(
        'button',
        {
          class: `power-chip effect-chip settings-power${definition.risk ? ' is-risk' : ''}`,
          type: 'button',
          title: name,
          'aria-label': name,
          'aria-pressed': String(allowed.has(type)),
          style: `--chip: #${definition.color.toString(16).padStart(6, '0')}; --ratio: 1`,
          onclick: () => {
            if (allowed.has(type)) allowed.delete(type);
            else allowed.add(type);
            chip.setAttribute('aria-pressed', String(allowed.has(type)));
            this.setOptions({
              ...current(),
              powerUps: allowed.size === POWER_UP_TYPES.length ? undefined : [...allowed]
            });
          }
        },
        definition.icon
      );
      return chip;
    });

    const body = [
      h(
        'div',
        { class: 'settings-row settings-powers' },
        h('span', { class: 'settings-label' }, t('editor.set.powerUps')),
        h('div', { class: 'settings-power-grid' }, ...chips)
      ),
      segment(
        t('editor.set.dropRate'),
        [
          ['low', t('editor.set.rate.low')],
          ['normal', t('editor.set.rate.normal')],
          ['high', t('editor.set.rate.high')]
        ],
        this.options?.dropRate ?? 'normal',
        (value) => this.setOptions({ ...current(), dropRate: value })
      ),
      segment(
        t('editor.set.lives'),
        [1, 2, 3, 4, 5].map((n) => [n, String(n)] as [number, string]),
        this.options?.lives ?? 3,
        (value) => this.setOptions({ ...current(), lives: value === 3 ? undefined : value })
      ),
      segment(
        t('editor.set.paceLabel'),
        [
          ['slow', t('editor.set.pace.slow')],
          ['normal', t('editor.set.pace.normal')],
          ['fast', t('editor.set.pace.fast')]
        ],
        this.options?.pace ?? 'normal',
        (value) => this.setOptions({ ...current(), pace: value })
      ),
      segment(
        t('editor.set.descend'),
        DESCEND_CHOICES.map(
          (n) => [n, n === 0 ? t('editor.set.descendOff') : `${n} s`] as [number, string]
        ),
        this.options?.descendEverySec ?? 0,
        (value) => this.setOptions({ ...current(), descendEverySec: value || undefined })
      ),
      toggle(t('editor.set.bonusRain'), Boolean(this.options?.bonusRain), (value) =>
        this.setOptions({ ...current(), bonusRain: value || undefined })
      ),
      toggle(t('editor.set.storm'), Boolean(this.options?.storm), (value) =>
        this.setOptions({ ...current(), storm: value || undefined })
      )
    ];
    this.host.openDialog(
      t('editor.settingsTitle'),
      [h('div', { class: 'settings-body' }, ...body)],
      [{ label: t('common.close'), variant: 'primary', action: () => this.host.closeOverlays() }],
      () => this.host.closeOverlays()
    );
  }

  private surprise(): void {
    this.model.replace(generateLevel(randomSeed()));
  }

  // ------------------------------------------------------------------ canvas

  private fit(reset: boolean): void {
    const width = this.wrap.clientWidth;
    const height = this.wrap.clientHeight;
    if (width <= 0 || height <= 0) return;
    this.fitScale = Math.min((width - 16) / WORLD_W, (height - 16) / WORLD_H);
    if (reset) this.zoom = 1;
    this.applyZoom();
  }

  private setZoom(zoom: number, anchor?: { x: number; y: number }): void {
    const previous = this.zoom;
    this.zoom = Math.max(1, Math.min(5, zoom));
    if (this.zoom === previous) return;
    // Keep the point under the cursor (or the centre) still while zooming.
    const ax = anchor?.x ?? this.wrap.clientWidth / 2;
    const ay = anchor?.y ?? this.wrap.clientHeight / 2;
    const ratio = this.zoom / previous;
    const scrollX = (this.wrap.scrollLeft + ax) * ratio - ax;
    const scrollY = (this.wrap.scrollTop + ay) * ratio - ay;
    this.applyZoom();
    this.wrap.scrollLeft = scrollX;
    this.wrap.scrollTop = scrollY;
  }

  private applyZoom(): void {
    const scale = this.fitScale * this.zoom;
    const cssW = Math.round(WORLD_W * scale);
    const cssH = Math.round(WORLD_H * scale);
    const ratio = Math.min(2.5, window.devicePixelRatio || 1);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.round(cssW * ratio);
    this.canvas.height = Math.round(cssH * ratio);
    this.wrap.classList.toggle('is-zoomed', this.zoom > 1.01);
    this.render();
  }

  private queueRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    window.requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  private render(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const scale = this.canvas.width / WORLD_W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = true;

    // Playfield.
    const background = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    background.addColorStop(0, '#15120d');
    background.addColorStop(1, '#0b0a08');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    // Cell dots and a stronger line every 6 columns / 2 rows, aligned with the pixel-art grid.
    ctx.fillStyle = 'rgba(255, 210, 140, 0.07)';
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        ctx.fillRect(col * PITCH_X + 1.5, row * PITCH_Y + 1.5, BRICK_DRAW_W, BRICK_DRAW_H);
      }
    }
    ctx.strokeStyle = 'rgba(255, 180, 35, 0.09)';
    ctx.lineWidth = 1;
    for (let col = 0; col <= COLS; col += 6) {
      ctx.beginPath();
      ctx.moveTo(col * PITCH_X, 0);
      ctx.lineTo(col * PITCH_X, GRID_H);
      ctx.stroke();
    }

    // Danger rows near the paddle.
    ctx.fillStyle = 'rgba(255, 90, 74, 0.06)';
    ctx.fillRect(0, LOW_ROW * PITCH_Y, WORLD_W, GRID_H - LOW_ROW * PITCH_Y);

    // Bricks.
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const symbol = this.model.get(col, row);
        if (symbol === '.') continue;
        const sprite = brickSprite(symbol);
        if (sprite) {
          ctx.drawImage(
            sprite,
            col * PITCH_X + 1.5,
            row * PITCH_Y + 1.5,
            BRICK_DRAW_W,
            BRICK_DRAW_H
          );
        }
      }
    }

    // Symmetry guides.
    if (this.model.symmetry !== 'none') {
      ctx.save();
      ctx.setLineDash([10, 8]);
      ctx.strokeStyle = 'rgba(95, 224, 168, 0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(WORLD_W / 2, 0);
      ctx.lineTo(WORLD_W / 2, GRID_H);
      if (this.model.symmetry === 'quad') {
        ctx.moveTo(0, 15 * PITCH_Y);
        ctx.lineTo(WORLD_W, 15 * PITCH_Y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Paddle footer, to show how far the bricks are from the player.
    ctx.fillStyle = 'rgba(255, 90, 74, 0.12)';
    ctx.fillRect(0, GRID_H, WORLD_W, FOOTER);
    const paddleW = 230;
    const paddleX = (WORLD_W - paddleW) / 2;
    const paddleY = GRID_H + FOOTER - 40;
    const paddle = ctx.createLinearGradient(0, paddleY, 0, paddleY + 20);
    paddle.addColorStop(0, '#fff3d6');
    paddle.addColorStop(1, '#c98a1c');
    ctx.fillStyle = paddle;
    ctx.beginPath();
    ctx.roundRect(paddleX, paddleY, paddleW, 20, 10);
    ctx.fill();
    ctx.fillStyle = 'rgba(244, 239, 228, 0.6)';
    ctx.font = '600 22px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`↓ ${t('editor.paddle')} ↓`, WORLD_W / 2, GRID_H + 32);

    this.renderPreview(ctx);
  }

  /** Ghost of what the current tool would paint. */
  private renderPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.hover && !this.dragStart) return;
    const cells = this.previewCells();
    if (cells.length === 0) return;
    const erasing = this.activeSymbol() === '.';
    const sprite = erasing ? null : brickSprite(this.activeSymbol());
    ctx.save();
    for (const cell of cells) {
      if (cell.col < 0 || cell.col >= COLS || cell.row < 0 || cell.row >= ROWS) continue;
      const x = cell.col * PITCH_X + 1.5;
      const y = cell.row * PITCH_Y + 1.5;
      if (sprite && this.tool !== 'picker' && this.tool !== 'fill') {
        ctx.globalAlpha = 0.55;
        ctx.drawImage(sprite, x, y, BRICK_DRAW_W, BRICK_DRAW_H);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = erasing ? 'rgba(255, 90, 74, 0.95)' : 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, BRICK_DRAW_W, BRICK_DRAW_H);
    }
    ctx.restore();
  }

  private activeSymbol(): string {
    const tool = this.stroke?.tool ?? this.tool;
    if (tool === 'eraser' || this.stroke?.button === 2) return '.';
    return this.stroke?.symbol ?? this.symbol;
  }

  private previewCells(): Cell[] {
    const tool = this.stroke?.tool ?? this.tool;
    const hover = this.hover;
    if (this.dragStart && hover && (tool === 'rect' || tool === 'line')) {
      return this.withMirror(this.shapeCells(tool, this.dragStart, hover));
    }
    if (!hover) return [];
    switch (tool) {
      case 'brush':
      case 'eraser':
        return this.withMirror(brushCells(hover.col, hover.row, this.size));
      case 'stamp':
        return this.withMirror(artCells(STAMPS[this.stamp], hover.col, hover.row, this.size));
      case 'text':
        return this.withMirror(
          artCells(
            textArt(this.textInput.value),
            hover.col,
            hover.row,
            this.size > 2 ? 2 : this.size
          )
        );
      case 'rect':
      case 'line':
        return this.withMirror(brushCells(hover.col, hover.row, this.size));
      default:
        return [hover];
    }
  }

  private shapeCells(tool: 'rect' | 'line', from: Cell, to: Cell): Cell[] {
    if (tool === 'rect') {
      const a = brushCells(from.col, from.row, this.size)[0] ?? from;
      const corner = brushCells(to.col, to.row, this.size);
      const b = corner[corner.length - 1] ?? to;
      return rectCells(a, b, true);
    }
    return brushPath(lineCells(from, to), this.size);
  }

  private withMirror(cells: Cell[]): Cell[] {
    if (this.model.symmetry === 'none') return cells;
    return cells.flatMap((cell) => this.model.mirrored(cell.col, cell.row));
  }

  // ------------------------------------------------------------------ input

  private cellAt(event: PointerEvent | MouseEvent): Cell | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WORLD_W;
    const y = ((event.clientY - rect.top) / rect.height) * WORLD_H;
    const col = Math.floor(x / PITCH_X);
    const row = Math.floor(y / PITCH_Y);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
    return { col, row };
  }

  private bindCanvas(): void {
    const canvas = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement,
      type: K,
      listener: (event: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions
    ): void => {
      target.addEventListener(type, listener, options);
      this.cleanups.push(() => target.removeEventListener(type, listener, options));
    };

    on(canvas, 'contextmenu', (event) => event.preventDefault());
    on(canvas, 'pointerdown', (event) => this.onPointerDown(event));
    on(canvas, 'pointermove', (event) => this.onPointerMove(event));
    on(canvas, 'pointerup', (event) => this.onPointerUp(event));
    on(canvas, 'pointercancel', (event) => this.onPointerUp(event, true));
    on(canvas, 'pointerleave', () => {
      if (!this.stroke) {
        this.hover = null;
        this.queueRender();
      }
    });
    on(
      this.wrap,
      'wheel',
      (event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const rect = this.wrap.getBoundingClientRect();
        this.setZoom(this.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        });
      },
      { passive: false }
    );
  }

  private onPointerDown(event: PointerEvent): void {
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      // Second finger: cancel the stroke and start pinch-zoom / pan.
      if (this.stroke) {
        this.model.revertToCheckpoint();
        this.stroke = null;
        this.dragStart = null;
      }
      const [a, b] = [...this.pointers.values()];
      if (a && b) {
        this.pinch = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          zoom: this.zoom,
          midX: (a.x + b.x) / 2,
          midY: (a.y + b.y) / 2
        };
      }
      return;
    }
    if (this.pointers.size > 2 || (event.button !== 0 && event.button !== 2)) return;
    const cell = this.cellAt(event);
    if (!cell) return;
    event.preventDefault();
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic or already released pointers cannot be captured; painting still works.
    }

    let tool = this.tool;
    if (event.altKey) tool = 'picker';
    if (event.button === 2) tool = 'eraser';
    const symbol = tool === 'eraser' ? '.' : this.symbol;
    this.hover = cell;

    if (tool === 'picker') {
      const picked = this.model.get(cell.col, cell.row);
      if (picked !== '.') {
        this.selectSymbol(picked);
        this.selectTool('brush');
      }
      return;
    }

    this.model.checkpoint();
    this.stroke = { button: event.button, tool, symbol };
    switch (tool) {
      case 'brush':
      case 'eraser':
        this.lastCell = cell;
        this.model.paintCells(brushCells(cell.col, cell.row, this.size), symbol);
        break;
      case 'rect':
      case 'line':
        this.dragStart = cell;
        break;
      case 'fill':
        this.model.fill(cell.col, cell.row, symbol);
        this.finishStroke();
        break;
      case 'stamp':
        this.model.paintCells(artCells(STAMPS[this.stamp], cell.col, cell.row, this.size), symbol);
        this.finishStroke();
        break;
      case 'text':
        this.model.paintCells(
          artCells(
            textArt(this.textInput.value),
            cell.col,
            cell.row,
            this.size > 2 ? 2 : this.size
          ),
          symbol
        );
        this.finishStroke();
        break;
      default:
        this.finishStroke();
    }
    this.queueRender();
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.pointers.has(event.pointerId)) {
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      if (!a || !b) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      this.wrap.scrollLeft -= midX - this.pinch.midX;
      this.wrap.scrollTop -= midY - this.pinch.midY;
      this.pinch.midX = midX;
      this.pinch.midY = midY;
      const rect = this.wrap.getBoundingClientRect();
      this.setZoom(this.pinch.zoom * (distance / Math.max(1, this.pinch.distance)), {
        x: midX - rect.left,
        y: midY - rect.top
      });
      return;
    }
    const cell = this.cellAt(event);
    const changed = cell?.col !== this.hover?.col || cell?.row !== this.hover?.row;
    if (cell) this.hover = cell;
    else if (!this.stroke) this.hover = null;
    if (!changed) return;
    if (this.stroke && cell && (this.stroke.tool === 'brush' || this.stroke.tool === 'eraser')) {
      const from = this.lastCell ?? cell;
      this.model.paintCells(brushPath(lineCells(from, cell), this.size), this.stroke.symbol);
      this.lastCell = cell;
    }
    this.queueRender();
  }

  private onPointerUp(event: PointerEvent, cancelled = false): void {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (!this.stroke) return;
    if (cancelled) {
      this.model.revertToCheckpoint();
    } else if (
      this.dragStart &&
      this.hover &&
      (this.stroke.tool === 'rect' || this.stroke.tool === 'line')
    ) {
      this.model.paintCells(
        this.shapeCells(this.stroke.tool, this.dragStart, this.hover),
        this.stroke.symbol
      );
    }
    this.finishStroke();
  }

  private finishStroke(): void {
    this.model.discardCheckpointIfUnchanged();
    this.stroke = null;
    this.dragStart = null;
    this.lastCell = null;
    this.undoButton.disabled = !this.model.canUndo;
    this.redoButton.disabled = !this.model.canRedo;
    this.queueRender();
  }

  private bindKeyboard(): void {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (document.querySelector('.backdrop')) return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        if (key === 's') {
          event.preventDefault();
          this.save();
        } else if (!typing && key === 'z') {
          event.preventDefault();
          if (event.shiftKey) this.model.redo();
          else this.model.undo();
        } else if (!typing && key === 'y') {
          event.preventDefault();
          this.model.redo();
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (typing) target?.blur();
        else this.requestLeave();
        return;
      }
      if (typing || event.altKey) return;
      const tool = TOOLS.find(([, , , shortcut]) => shortcut === key);
      if (tool) {
        this.selectTool(tool[0]);
        return;
      }
      const index = Number(event.key) - 1;
      const symbol = PALETTE[index];
      if (symbol) {
        this.selectSymbol(symbol);
      } else if (key === 'm') {
        const next = SYMMETRIES[(SYMMETRIES.indexOf(this.model.symmetry) + 1) % SYMMETRIES.length];
        if (next) this.selectSymmetry(next);
      } else if (key === '+' || key === '=') {
        this.setZoom(this.zoom * 1.25);
      } else if (key === '-') {
        this.setZoom(this.zoom / 1.25);
      } else if (key === '0') {
        this.fit(true);
      }
    };
    document.addEventListener('keydown', onKey);
    this.cleanups.push(() => document.removeEventListener('keydown', onKey));
  }
}
