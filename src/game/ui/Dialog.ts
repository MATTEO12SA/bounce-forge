import Phaser from 'phaser';
import { TOKENS } from '../config/designTokens';
import { DEPTHS, WORLD_HEIGHT, WORLD_WIDTH } from '../utils/constants';
import { Button } from './Button';
import { drawRoundedRect } from './roundedShapes';

interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface TextAreaDialogOptions {
  title: string;
  message: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  readOnly?: boolean;
}

class DialogFrame {
  protected readonly container: Phaser.GameObjects.Container;
  private readonly keys: Phaser.Input.Keyboard.Key[] = [];

  public constructor(
    protected readonly scene: Phaser.Scene,
    title: string,
    message: string,
    width = 820,
    height = 560
  ) {
    this.container = scene.add.container(0, 0).setDepth(DEPTHS.overlay + 30);
    const backdrop = scene.add
      .rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 0x000000, 0.62)
      .setOrigin(0)
      .setInteractive();
    const shadow = drawRoundedRect(
      scene,
      WORLD_WIDTH / 2,
      WORLD_HEIGHT / 2 + 12,
      width,
      height,
      TOKENS.radius.lg,
      { fill: { color: 0x000000, alpha: 0.42 } }
    );
    const panel = drawRoundedRect(
      scene,
      WORLD_WIDTH / 2,
      WORLD_HEIGHT / 2,
      width,
      height,
      TOKENS.radius.lg,
      {
        fill: { color: 0x120f08, alpha: 0.97 },
        stroke: { color: 0xffd31a, width: 3, alpha: 0.9 }
      }
    );
    const heading = scene.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - height / 2 + 54, title, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '34px',
        fontStyle: '900',
        color: '#ffe680',
        align: 'center'
      })
      .setOrigin(0.5);
    const body = scene.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - height / 2 + 112, message, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '24px',
        fontStyle: '700',
        color: '#f4f7fb',
        align: 'center',
        wordWrap: { width: width - 110 }
      })
      .setOrigin(0.5, 0);

    this.container.add([backdrop, shadow, panel, heading, body]);
  }

  protected bindKey(keyCode: number, callback: () => void): void {
    const key = this.scene.input.keyboard?.addKey(keyCode);

    if (!key) {
      return;
    }

    key.on('down', callback);
    this.keys.push(key);
  }

  protected destroy(): void {
    this.keys.forEach((key) => key.removeAllListeners('down'));
    this.container.destroy(true);
  }
}

export class ConfirmDialog extends DialogFrame {
  public static show(scene: Phaser.Scene, options: ConfirmDialogOptions): Promise<boolean> {
    return new Promise((resolve) => {
      new ConfirmDialog(scene, options, resolve);
    });
  }

  private constructor(
    scene: Phaser.Scene,
    options: ConfirmDialogOptions,
    resolve: (confirmed: boolean) => void
  ) {
    super(scene, options.title, options.message, 780, 440);

    const close = (confirmed: boolean): void => {
      this.destroy();
      resolve(confirmed);
    };

    const y = WORLD_HEIGHT / 2 + 142;
    const cancel = new Button(
      scene,
      WORLD_WIDTH / 2 - 158,
      y,
      230,
      66,
      options.cancelLabel ?? 'CANCEL',
      () => close(false),
      { variant: 'secondary', icon: 'x' }
    );
    const confirm = new Button(
      scene,
      WORLD_WIDTH / 2 + 158,
      y,
      230,
      66,
      options.confirmLabel ?? 'CONFIRM',
      () => close(true),
      {
        variant: options.danger ? 'danger' : 'primary',
        selected: !options.danger,
        icon: options.danger ? 'trash' : 'check'
      }
    );

    this.container.add([cancel, confirm]);
    this.bindKey(Phaser.Input.Keyboard.KeyCodes.ESC, () => close(false));
    this.bindKey(Phaser.Input.Keyboard.KeyCodes.ENTER, () => close(true));
  }
}

export class TextAreaDialog extends DialogFrame {
  private value: string;
  private readonly text: Phaser.GameObjects.Text;
  private readonly readOnly: boolean;
  private readonly handlePasteEvent = (event: ClipboardEvent): void => {
    if (this.readOnly) {
      return;
    }

    const pasted = event.clipboardData?.getData('text') ?? '';
    if (pasted) {
      event.preventDefault();
      this.value += pasted;
      this.renderValue();
    }
  };
  private readonly handleKeyDownEvent = (event: KeyboardEvent): void => {
    if (this.readOnly || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    if (event.key === 'Backspace') {
      event.preventDefault();
      this.value = this.value.slice(0, -1);
      this.renderValue();
      return;
    }

    if (event.key === 'Delete') {
      event.preventDefault();
      this.value = '';
      this.renderValue();
      return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
      this.value += event.key;
      this.renderValue();
    }
  };

  public static show(scene: Phaser.Scene, options: TextAreaDialogOptions): Promise<string | null> {
    return new Promise((resolve) => {
      new TextAreaDialog(scene, options, resolve);
    });
  }

  private constructor(
    scene: Phaser.Scene,
    options: TextAreaDialogOptions,
    resolve: (value: string | null) => void
  ) {
    super(scene, options.title, options.message, 900, 700);
    this.value = options.initialValue ?? '';
    this.readOnly = options.readOnly ?? false;

    const box = drawRoundedRect(
      scene,
      WORLD_WIDTH / 2,
      WORLD_HEIGHT / 2 + 42,
      760,
      320,
      TOKENS.radius.md,
      {
        fill: { color: 0x070a0d, alpha: 0.96 },
        stroke: { color: 0xffd31a, width: 2, alpha: 0.58 }
      }
    );
    this.text = scene.add
      .text(WORLD_WIDTH / 2 - 356, WORLD_HEIGHT / 2 - 96, '', {
        fontFamily: 'Consolas, monospace',
        fontSize: '20px',
        color: '#f4f7fb',
        wordWrap: { width: 712 },
        lineSpacing: 4
      })
      .setOrigin(0);
    const hint = scene.add
      .text(
        WORLD_WIDTH / 2,
        WORLD_HEIGHT / 2 + 222,
        this.readOnly ? 'Use COPY, then CLOSE.' : 'Paste or type the level code.',
        {
          fontFamily: 'Arial, sans-serif',
          fontSize: '20px',
          fontStyle: '700',
          color: '#b8c4d6',
          align: 'center'
        }
      )
      .setOrigin(0.5);

    const close = (value: string | null): void => {
      window.removeEventListener('paste', this.handlePasteEvent);
      window.removeEventListener('keydown', this.handleKeyDownEvent);
      this.destroy();
      resolve(value);
    };

    const y = WORLD_HEIGHT / 2 + 292;
    const cancel = new Button(
      scene,
      WORLD_WIDTH / 2 - 166,
      y,
      250,
      66,
      options.cancelLabel ?? 'CANCEL',
      () => close(null),
      { variant: 'secondary', icon: 'x' }
    );
    const confirm = new Button(
      scene,
      WORLD_WIDTH / 2 + 166,
      y,
      250,
      66,
      options.confirmLabel ?? 'OK',
      () => close(this.value),
      { selected: true, icon: this.readOnly ? 'copy' : 'check' }
    );

    this.container.add([box, this.text, hint, cancel, confirm]);
    this.renderValue(options.placeholder);
    window.addEventListener('paste', this.handlePasteEvent);
    window.addEventListener('keydown', this.handleKeyDownEvent);
    this.bindKey(Phaser.Input.Keyboard.KeyCodes.ESC, () => close(null));
  }

  private renderValue(placeholder = ''): void {
    const value = this.value || placeholder;
    const display = value.length > 1800 ? `${value.slice(0, 1800)}...` : value;
    this.text.setText(display);
    this.text.setColor(this.value ? '#f4f7fb' : '#7f8c9d');
  }
}
