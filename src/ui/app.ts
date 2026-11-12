import {
  bridge,
  type GameMode,
  type GameResult,
  type GameNotice,
  type GameSession,
  type HudSnapshot
} from '../game/bridge';
import { audio } from '../game/audio/AudioEngine';
import { ADMIN_ENABLED } from '../game/config/features';
import { getPowerUpDefinition, introducedInChapter, POWER_UP_TYPES } from '../game/config/powerUps';
import { campaignLevels } from '../game/levels/campaignLevels';
import { decodeCreativeLevelCode, encodeCreativeLevelCode } from '../game/levels/levelShare';
import { createLevelFromPattern } from '../game/levels/levelFactory';
import { estimateDifficulty } from '../game/levels/levelChecks';
import { CAMPAIGN_CHAPTERS, LEVEL_PATTERNS } from '../game/levels/levelPatterns';
import type { LevelOptions } from '../game/levels/levelOptions';
import type { LevelDefinition } from '../game/levels/levelTypes';
import {
  createRunSeed,
  dailySeed,
  DAILY_WAVE_COUNT,
  utcDateKey
} from '../game/modes/waveGenerator';
import { LevelSystem } from '../game/systems/LevelSystem';
import {
  getSharedSaveSystem,
  isPersistentStorageAvailable,
  type FxQuality,
  type LevelMedal,
  type SaveData
} from '../game/systems/SaveSystem';
import { clear, h, icon } from './dom';
import { clearDraft, readDraft, writeDraft } from './editor/drafts';
import { brickSprite, EditorScreen } from './editor/EditorScreen';
import { generateLevel, randomSeed } from './editor/generator';
import { EngineLoader, type EngineState } from './engine';
import {
  formatDate,
  formatNumber,
  getLanguage,
  hasMessage,
  levelDisplayName,
  setLanguage,
  t,
  type MessageKey
} from './i18n';
import { drawLevelPreview } from './preview';

const REPO_URL = 'https://github.com/MATTEO12SA/bounce-forge';
const CHAPTERS = CAMPAIGN_CHAPTERS;
const CHAPTER_SLUG: Record<string, string> = {
  'Forge Basics': 'forge',
  'Wall Mazes': 'steel',
  'Chain Reactor': 'chain',
  'Ball Storm': 'storm',
  Mechanisms: 'mech'
};
/** Brick symbols worth a "New" badge on the level that introduces them. */
const INTRODUCED_SYMBOLS: Array<[string, MessageKey]> = [
  ['B', 'editor.brick.B'],
  ['2', 'editor.brick.2'],
  ['E', 'editor.brick.E'],
  ['C', 'editor.brick.C'],
  ['X', 'editor.brick.X'],
  ['K', 'editor.brick.K'],
  ['O', 'editor.brick.O'],
  ['T', 'editor.brick.T'],
  ['F', 'editor.brick.F'],
  ['R', 'editor.brick.R'],
  ['M', 'editor.brick.M'],
  ['I', 'editor.brick.I']
];
const INTRODUCED_AT = new Map<number, MessageKey[]>();
INTRODUCED_SYMBOLS.forEach(([symbol, key]) => {
  const index = LEVEL_PATTERNS.findIndex((level) => level.rows.some((row) => row.includes(symbol)));
  if (index >= 0) INTRODUCED_AT.set(index, [...(INTRODUCED_AT.get(index) ?? []), key]);
});
const SLOT_COUNT = campaignLevels.length;

type View = 'home' | 'menu' | 'play' | 'tool' | 'editor';
type MenuScreen = 'campaign' | 'modes' | 'create' | 'help' | 'settings';

type Route =
  | { name: 'home' }
  | { name: MenuScreen; chapter?: string }
  | { name: 'play'; mode: GameMode; index: number }
  | { name: 'edit'; slot: number }
  | { name: 'admin' };

function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [head, second, third] = parts;
  switch (head) {
    case 'campaign':
      return { name: 'campaign', chapter: second };
    case 'modes':
    case 'help':
    case 'settings':
      return { name: head };
    case 'create':
      if (second === 'edit') {
        return { name: 'edit', slot: clampIndex(Number(third)) };
      }
      return { name: 'create' };
    case 'admin':
      return ADMIN_ENABLED ? { name: 'admin' } : { name: 'home' };
    case 'play':
      if (second === 'endless' || second === 'daily') {
        return { name: 'play', mode: second, index: 0 };
      }
      if (second === 'creative' || second === 'campaign') {
        return { name: 'play', mode: second, index: clampIndex(Number(third ?? 1) - 1) };
      }
      return { name: 'home' };
    default:
      return { name: 'home' };
  }
}

function clampIndex(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(SLOT_COUNT - 1, Math.floor(value))) : 0;
}

function sessionKey(session: Pick<GameSession, 'mode' | 'levelIndex'>): string {
  return `${session.mode}:${session.mode === 'endless' || session.mode === 'daily' ? 0 : session.levelIndex}`;
}

function playHash(mode: GameMode, index: number): string {
  if (mode === 'endless' || mode === 'daily') {
    return `#/play/${mode}`;
  }
  return `#/play/${mode}/${index + 1}`;
}

export class App {
  private readonly save = getSharedSaveSystem();
  private readonly levelSystem = new LevelSystem(this.save);
  private readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly engine: EngineLoader;
  private readonly main: HTMLElement;
  private readonly topbar: HTMLElement;
  private readonly overlayLayer: HTMLElement;
  private readonly toastRegion: HTMLElement;
  private view: View = 'home';
  private route: Route = { name: 'home' };
  private activeSessionKey: string | null = null;
  private lastHud: HudSnapshot | null = null;
  private hudRefs: Record<string, HTMLElement> = {};
  private lastResult: GameResult | null = null;
  private paused = false;
  private demoRunning = false;
  private readonly cleanups: Array<() => void> = [];
  private resizeObserver: ResizeObserver | null = null;
  private stageSlot: HTMLElement | null = null;
  private editor: EditorScreen | null = null;
  /** Messages shown one after another in the bonus card (left HUD / top of the stage). */
  private readonly cardQueue: BonusCard[] = [];
  private cardTimer = 0;
  private cardShowing: BonusCard | null = null;
  private hoveredEffect: string | null = null;
  /** Unsaved editor level to play next ("Test" never overwrites the saved slot). */
  private pendingDraft: {
    slotIndex: number;
    name: string;
    rows: string[];
    options?: LevelOptions;
  } | null = null;

  public constructor(root: HTMLElement) {
    this.root = root;
    setLanguage(this.save.snapshot().preferences.language);
    this.applyMotionPreference();
    this.applySound();

    this.stage = h('div', { class: 'stage', id: 'stage', 'aria-hidden': 'true' });
    this.engine = new EngineLoader(this.stage);
    this.topbar = h('header', { class: 'topbar' });
    this.main = h('main', { class: 'main', id: 'main', tabindex: '-1' });
    this.overlayLayer = h('div', { class: 'overlay-layer' });
    this.toastRegion = h('div', {
      class: 'toasts',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true'
    });

    clear(this.root);
    this.root.append(
      h('a', { class: 'skip-link', href: '#main' }, t('app.skip')),
      this.topbar,
      this.main,
      this.stage,
      this.overlayLayer,
      this.toastRegion
    );

    this.cleanups.push(
      bridge.on('ready', () => this.onEngineReady()),
      bridge.on('hud', (hud) => this.onHud(hud)),
      bridge.on('result', (result) => this.onResult(result)),
      bridge.on('pauseRequested', () => this.pauseGame()),
      bridge.on('waveCleared', ({ wave }) => {
        if (this.view === 'play' && this.hudRefs.bonusCard) {
          this.queueCard({
            tag: t('bonus.event'),
            highlight: false,
            title: t('wave.cleared', { n: wave }),
            text: '',
            color: '#5fe0a8',
            icon: '✓',
            durationMs: 2600
          });
        } else {
          this.toast(t('wave.cleared', { n: wave }));
        }
      }),
      bridge.on('notice', (notice) => this.onNotice(notice)),
      bridge.on('exitToShell', ({ from }) => this.navigate(from === 'admin' ? '#/' : '#/create')),
      bridge.on('toolOpened', () => this.setView('tool')),
      this.engine.onState((state) => this.onEngineState(state)),
      this.save.subscribe(() => this.onSaveChanged())
    );

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.syncStage());
      this.resizeObserver.observe(this.root);
    }
    const onHashChange = (): void => this.handleRoute();
    const onKeyDown = (event: KeyboardEvent): void => this.onKeyDown(event);
    const onResize = (): void => this.syncStage();
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    // Browsers only allow sound after a user gesture: any tap, click or key unlocks it.
    const unlockAudio = (): void => audio.unlock();
    ['pointerdown', 'touchend', 'keydown'].forEach((type) =>
      document.addEventListener(type, unlockAudio, { capture: true, passive: true })
    );
    this.cleanups.push(() =>
      ['pointerdown', 'touchend', 'keydown'].forEach((type) =>
        document.removeEventListener(type, unlockAudio, { capture: true })
      )
    );
    this.cleanups.push(
      () => window.removeEventListener('hashchange', onHashChange),
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('resize', onResize)
    );
  }

  public start(): void {
    this.handleRoute();
    // Warm up the engine once the interface is visible so the home preview comes alive.
    const warmUp = (): void => {
      void this.engine.load().catch(() => undefined);
    };
    const idle = (
      window as unknown as { requestIdleCallback?: (cb: () => void, o?: object) => void }
    ).requestIdleCallback;
    if (idle) {
      idle(warmUp, { timeout: 1500 });
    } else {
      window.setTimeout(warmUp, 400);
    }
  }

  public destroy(): void {
    this.cleanups.splice(0).forEach((cleanup) => cleanup());
    this.resizeObserver?.disconnect();
    this.engine.destroy();
  }

  // ---------------------------------------------------------------------------------- routing

  private navigate(hash: string): void {
    if (window.location.hash === hash) {
      this.handleRoute();
    } else {
      window.location.hash = hash;
    }
  }

  private handleRoute(): void {
    const route = parseRoute(window.location.hash);
    this.route = route;
    this.closeOverlays();
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }

    if (route.name !== 'play' && this.activeSessionKey) {
      this.activeSessionKey = null;
      this.paused = false;
      this.demoRunning = false;
      if (
        route.name === 'home' ||
        route.name === 'campaign' ||
        route.name === 'modes' ||
        route.name === 'create' ||
        route.name === 'help' ||
        route.name === 'settings'
      ) {
        this.startDemo();
      }
    }

    switch (route.name) {
      case 'home':
        this.renderHome();
        break;
      case 'play':
        this.startFromRoute(route);
        break;
      case 'edit':
        this.renderEditor(route.slot);
        break;
      case 'admin':
        this.demoRunning = false;
        this.setView('tool');
        this.renderTool();
        void this.engine.load().then((engine) => engine.openAdmin());
        break;
      default:
        this.renderMenu(route.name, route.name === 'campaign' ? route.chapter : undefined);
    }
  }

  private setView(view: View): void {
    this.view = view;
    this.root.dataset.view = view;
    const controller = this.engine.controller;
    if (controller && (view === 'menu' || view === 'editor') && !this.activeSessionKey) {
      controller.pause();
    } else if (controller && view === 'home') {
      controller.resume();
    }
  }

  // ------------------------------------------------------------------------------- top bar

  private renderTopbar(active: Route['name']): void {
    clear(this.topbar);
    const nav: Array<[Route['name'], MessageKey, string]> = [
      ['campaign', 'nav.campaign', '#/campaign'],
      ['modes', 'nav.modes', '#/modes'],
      ['create', 'nav.create', '#/create'],
      ['help', 'nav.help', '#/help']
    ];
    const soundOn = this.save.snapshot().preferences.soundEnabled;

    this.topbar.append(
      h(
        'a',
        { class: 'brand', href: '#/', 'aria-label': `Bounce Forge — ${t('nav.home')}` },
        h('span', { class: 'brand-mark', 'aria-hidden': 'true' }),
        h('span', { class: 'brand-name' }, 'Bounce Forge')
      ),
      h(
        'nav',
        { class: 'nav-pills', 'aria-label': t('nav.menu') },
        ...nav.map(([name, key, href]) =>
          h(
            'a',
            {
              class: `pill${active === name ? ' is-active' : ''}`,
              href,
              'aria-current': active === name ? 'page' : null
            },
            t(key)
          )
        )
      ),
      h(
        'div',
        { class: 'topbar-actions' },
        h(
          'button',
          {
            class: 'icon-button',
            type: 'button',
            'aria-pressed': String(soundOn),
            'aria-label': t('settings.sound'),
            onclick: () => this.toggleSound()
          },
          icon(soundOn ? 'volume' : 'mute')
        ),
        h(
          'button',
          {
            class: 'lang-toggle',
            type: 'button',
            'aria-label': t('settings.language'),
            onclick: () => this.setLanguagePreference(getLanguage() === 'fr' ? 'en' : 'fr')
          },
          getLanguage() === 'fr' ? 'EN' : 'FR'
        ),
        h(
          'a',
          {
            class: `icon-button${active === 'settings' ? ' is-active' : ''}`,
            href: '#/settings',
            'aria-label': t('nav.settings')
          },
          icon('settings')
        )
      )
    );
  }

  // ---------------------------------------------------------------------------------- home

  private getResumeIndex(data: SaveData = this.save.snapshot()): number {
    return Math.min(campaignLevels.length - 1, Math.max(0, data.unlockedLevel));
  }

  private renderHome(): void {
    this.setView('home');
    this.renderTopbar('home');
    clear(this.main);
    const data = this.save.snapshot();
    const resumeIndex = this.getResumeIndex(data);
    const resumeLevel = campaignLevels[resumeIndex];
    const hasProgress = data.completedLevels.length > 0 || data.unlockedLevel > 0;
    const medals = Object.keys(data.levelMedals).length;

    const slot = h(
      'figure',
      { class: 'home-stage', 'aria-label': t('home.preview') },
      h(
        'div',
        { class: 'stage-placeholder', 'aria-hidden': 'true' },
        h('div', { class: 'placeholder-bricks' }),
        h('div', { class: 'placeholder-ball' }),
        h('div', { class: 'placeholder-paddle' })
      ),
      h('figcaption', { class: 'visually-hidden' }, t('home.preview'))
    );

    const playButton = h(
      'a',
      { class: 'button button-primary button-xl', href: playHash('campaign', resumeIndex) },
      icon('play'),
      h(
        'span',
        { class: 'button-stack' },
        h('span', {}, hasProgress ? t('home.resume') : t('home.play')),
        h(
          'small',
          {},
          hasProgress
            ? t('home.resumeLevel', {
                n: resumeIndex + 1,
                name: levelDisplayName(resumeLevel?.name ?? '')
              })
            : t('home.startLevel', { name: levelDisplayName(campaignLevels[0]?.name ?? '') })
        )
      )
    );

    const features: Array<[string, MessageKey, MessageKey, string, string]> = [
      ['grid', 'home.feature.campaign.title', 'home.feature.campaign.body', '#/campaign', 'forge'],
      [
        'infinity',
        'home.feature.endless.title',
        'home.feature.endless.body',
        '#/play/endless',
        'chain'
      ],
      ['calendar', 'home.feature.daily.title', 'home.feature.daily.body', '#/play/daily', 'storm'],
      ['pencil', 'home.feature.create.title', 'home.feature.create.body', '#/create', 'steel']
    ];

    this.main.append(
      h(
        'section',
        { class: 'home', 'aria-labelledby': 'home-title' },
        h(
          'div',
          { class: 'home-hero' },
          h('p', { class: 'eyebrow' }, 'Arcade · Brick breaker'),
          h(
            'h1',
            { class: 'wordmark', id: 'home-title' },
            h('span', {}, 'Bounce'),
            h('span', { class: 'wordmark-accent' }, 'Forge')
          ),
          h('p', { class: 'lede' }, t('app.tagline')),
          h(
            'div',
            { class: 'cta-row' },
            playButton,
            h(
              'a',
              { class: 'button button-ghost', href: '#/modes' },
              t('home.modes'),
              icon('arrowRight')
            )
          ),
          h(
            'dl',
            { class: 'home-stats' },
            this.stat(
              `${data.completedLevels.length}/${campaignLevels.length}`,
              t('home.stats.levels')
            ),
            this.stat(String(medals), t('home.stats.medals')),
            this.stat(formatNumber(data.bestScore), t('home.stats.best'))
          )
        ),
        slot,
        h(
          'ul',
          { class: 'feature-grid', role: 'list' },
          ...features.map(([iconName, title, body, href, accent]) =>
            h(
              'li',
              {},
              h(
                'a',
                { class: `feature-card accent-${accent}`, href },
                h('span', { class: 'feature-icon' }, icon(iconName)),
                h('span', { class: 'feature-title' }, t(title)),
                h('span', { class: 'feature-body' }, t(body))
              )
            )
          )
        )
      ),
      this.footer()
    );
    this.mountStage(slot);
    if (this.engine.getState() === 'ready') {
      this.ensureDemo();
    }
  }

  private stat(value: string, label: string): HTMLElement {
    return h('div', { class: 'stat' }, h('dt', {}, label), h('dd', {}, value));
  }

  private footer(): HTMLElement {
    return h(
      'footer',
      { class: 'footer' },
      h('span', {}, '© Bounce Forge'),
      h(
        'a',
        { href: REPO_URL, rel: 'noopener', target: '_blank' },
        icon('github'),
        t('footer.source')
      ),
      h(
        'a',
        { href: `${REPO_URL}/blob/main/LICENSE`, rel: 'noopener', target: '_blank' },
        t('footer.license')
      )
    );
  }

  // ---------------------------------------------------------------------------------- menus

  private renderMenu(screen: MenuScreen, chapter?: string): void {
    this.setView('menu');
    this.renderTopbar(screen);
    this.mountStage(null);
    clear(this.main);
    const content = (() => {
      switch (screen) {
        case 'campaign':
          return this.campaignScreen(chapter);
        case 'modes':
          return this.modesScreen();
        case 'create':
          return this.createScreen();
        case 'help':
          return this.helpScreen();
        case 'settings':
        default:
          return this.settingsScreen();
      }
    })();
    this.main.append(content, this.footer());
    this.main.querySelectorAll<HTMLCanvasElement>('canvas[data-level]').forEach((canvas) => {
      const level = this.resolvePreviewLevel(canvas.dataset.level ?? '');
      if (level) {
        drawLevelPreview(canvas, level, { dim: canvas.dataset.dim === '1' });
      }
    });
  }

  private resolvePreviewLevel(key: string): LevelDefinition | null {
    const [kind, raw] = key.split(':');
    const index = Number(raw);
    if (kind === 'campaign') {
      return campaignLevels[index] ?? null;
    }
    if (kind === 'creative') {
      return this.levelSystem.getCreativeLevel(index);
    }
    if (kind === 'draft') {
      const draft = readDraft(index);
      return draft
        ? createLevelFromPattern({ id: `draft-${index}`, name: draft.name, rows: draft.rows }, 0)
        : null;
    }
    if (kind === 'pattern') {
      const pattern = LEVEL_PATTERNS[index];
      return pattern ? createLevelFromPattern(pattern, index) : null;
    }
    return null;
  }

  private screenHeader(title: string, subtitle: string, extra?: HTMLElement): HTMLElement {
    return h(
      'header',
      { class: 'screen-header' },
      h(
        'div',
        {},
        h('h1', { class: 'screen-title' }, title),
        h('p', { class: 'screen-subtitle' }, subtitle)
      ),
      extra ?? null
    );
  }

  private campaignScreen(chapterSlug?: string): HTMLElement {
    const data = this.save.snapshot();
    const activeChapter = CHAPTERS.find((chapter) => CHAPTER_SLUG[chapter] === chapterSlug);
    const filters = h(
      'nav',
      { class: 'filter-pills', 'aria-label': t('campaign.title') },
      h(
        'a',
        {
          class: `pill${activeChapter ? '' : ' is-active'}`,
          href: '#/campaign',
          'aria-current': activeChapter ? null : 'page'
        },
        t('campaign.all')
      ),
      ...CHAPTERS.map((chapter) =>
        h(
          'a',
          {
            class: `pill accent-${CHAPTER_SLUG[chapter]}${activeChapter === chapter ? ' is-active' : ''}`,
            href: `#/campaign/${CHAPTER_SLUG[chapter]}`,
            'aria-current': activeChapter === chapter ? 'page' : null
          },
          this.chapterName(chapter)
        )
      )
    );

    const cards = campaignLevels
      .filter((level) => !activeChapter || level.chapter === activeChapter)
      .map((level) => {
        const unlocked = level.index <= data.unlockedLevel;
        const medal = data.levelMedals[String(level.index)] as LevelMedal | undefined;
        const accent = CHAPTER_SLUG[level.chapter] ?? 'forge';
        const content = [
          h(
            'div',
            { class: 'card-visual' },
            h('canvas', {
              'data-level': `campaign:${level.index}`,
              'data-dim': unlocked ? '0' : '1',
              'aria-hidden': 'true'
            }),
            unlocked ? null : h('span', { class: 'lock-badge' }, icon('lock', t('campaign.locked')))
          ),
          h(
            'div',
            { class: 'card-meta' },
            h('span', { class: 'card-index' }, String(level.index + 1).padStart(2, '0')),
            h(
              'span',
              { class: 'card-text' },
              h('span', { class: 'card-title' }, levelDisplayName(level.name)),
              h(
                'span',
                { class: 'card-sub' },
                this.objectiveText(level.objective.type, level.objective.target)
              ),
              ...(INTRODUCED_AT.get(level.index) ?? []).map((key) =>
                h('span', { class: 'new-badge' }, t('campaign.new', { name: t(key) }))
              )
            ),
            this.medalBadge(medal)
          )
        ];
        return h(
          'li',
          {},
          unlocked
            ? h(
                'a',
                {
                  class: `level-card accent-${accent}`,
                  href: playHash('campaign', level.index),
                  'aria-label': t('campaign.play', {
                    n: level.index + 1,
                    name: levelDisplayName(level.name)
                  })
                },
                ...content
              )
            : h(
                'div',
                { class: `level-card is-locked accent-${accent}`, 'aria-disabled': 'true' },
                ...content
              )
        );
      });

    return h(
      'section',
      { class: 'screen', 'aria-labelledby': 'screen-title' },
      this.screenHeader(
        t('campaign.title'),
        t('campaign.subtitle'),
        h(
          'p',
          { class: 'progress-chip' },
          t('campaign.progress', {
            done: data.completedLevels.length,
            total: campaignLevels.length
          })
        )
      ),
      filters,
      activeChapter ? this.chapterIntro(activeChapter) : null,
      h('ul', { class: 'card-grid', role: 'list' }, ...cards)
    );
  }

  /** Chapter header: theme and the power-ups that start dropping in it. */
  private chapterIntro(chapter: string): HTMLElement {
    const index = CHAPTERS.indexOf(chapter as (typeof CHAPTERS)[number]);
    const fresh = POWER_UP_TYPES.filter((type) => introducedInChapter(type) === index);
    return h(
      'div',
      { class: `chapter-intro accent-${CHAPTER_SLUG[chapter] ?? 'forge'}` },
      h('p', {}, t(`chapter.about.${CHAPTER_SLUG[chapter] ?? 'forge'}` as MessageKey)),
      fresh.length > 0
        ? h(
            'p',
            { class: 'chapter-powers' },
            t('campaign.newPowers'),
            ' ',
            ...fresh.map((type) => {
              const definition = getPowerUpDefinition(type);
              return h(
                'span',
                {
                  class: `power-chip effect-chip${definition.risk ? ' is-risk' : ''}`,
                  style: `--chip: #${definition.color.toString(16).padStart(6, '0')}; --ratio: 1`,
                  title: t(`power.${type}` as MessageKey)
                },
                definition.icon
              );
            })
          )
        : null
    );
  }

  private medalBadge(medal?: LevelMedal): HTMLElement {
    return h(
      'span',
      {
        class: `medal medal-${medal ?? 'none'}`,
        title: medal ? t(`medal.${medal}`) : t('medal.none')
      },
      h('span', { class: 'visually-hidden' }, medal ? t(`medal.${medal}`) : t('medal.none'))
    );
  }

  private chapterName(chapter: string): string {
    const key = `chapter.${chapter}`;
    return hasMessage(key) ? t(key) : chapter;
  }

  private objectiveText(kind: string, target: number): string {
    const key = `objective.${kind}`;
    return hasMessage(key) ? t(key, { target }) : '';
  }

  private modesScreen(): HTMLElement {
    const data = this.save.snapshot();
    const dateKey = utcDateKey();
    const daily = data.records.daily[dateKey];
    const resumeIndex = this.getResumeIndex(data);
    const endless = data.records.endless;

    const modeCard = (
      accent: string,
      iconName: string,
      title: string,
      lines: string[],
      cta: string,
      href: string
    ): HTMLElement =>
      h(
        'li',
        {},
        h(
          'article',
          { class: `mode-card accent-${accent}` },
          h('span', { class: 'feature-icon' }, icon(iconName)),
          h('h2', { class: 'mode-title' }, title),
          ...lines.map((line) => h('p', { class: 'mode-line' }, line)),
          h('a', { class: 'button button-primary', href }, cta, icon('arrowRight'))
        )
      );

    return h(
      'section',
      { class: 'screen', 'aria-labelledby': 'screen-title' },
      this.screenHeader(t('modes.title'), t('modes.subtitle')),
      h(
        'ul',
        { class: 'mode-grid', role: 'list' },
        modeCard(
          'forge',
          'grid',
          t('mode.campaign'),
          [
            t('campaign.progress', {
              done: data.completedLevels.length,
              total: campaignLevels.length
            }),
            t('home.resumeLevel', {
              n: resumeIndex + 1,
              name: levelDisplayName(campaignLevels[resumeIndex]?.name ?? '')
            })
          ],
          t('modes.campaign.cta'),
          playHash('campaign', resumeIndex)
        ),
        modeCard(
          'chain',
          'infinity',
          t('mode.endless'),
          [
            t('modes.endless.rules'),
            endless.bestScore > 0
              ? t('modes.endless.record', {
                  score: formatNumber(endless.bestScore),
                  wave: endless.bestWave
                })
              : t('modes.endless.none')
          ],
          t('modes.endless.cta'),
          '#/play/endless'
        ),
        modeCard(
          'storm',
          'calendar',
          t('mode.daily'),
          [
            t('modes.daily.date', { date: formatDate(dateKey, true) }),
            t('modes.daily.rules'),
            daily
              ? t('modes.daily.record', {
                  score: formatNumber(daily.bestScore),
                  waves: daily.wavesCleared,
                  attempts: daily.attempts
                })
              : t('modes.daily.none')
          ],
          t('modes.daily.cta'),
          '#/play/daily'
        ),
        modeCard(
          'steel',
          'pencil',
          t('mode.creative'),
          [t('create.subtitle')],
          t('modes.create.cta'),
          '#/create'
        )
      )
    );
  }

  private firstEmptySlot(data: SaveData = this.save.snapshot()): number | null {
    for (let index = 0; index < SLOT_COUNT; index += 1) {
      if (!data.creativeLevelSlots[String(index)]) {
        return index;
      }
    }
    return null;
  }

  private createScreen(): HTMLElement {
    const data = this.save.snapshot();
    const empty = this.firstEmptySlot(data);
    const status = h('p', { class: 'form-status', role: 'status', 'aria-live': 'polite' });
    const textarea = h('textarea', {
      id: 'import-code',
      rows: '2',
      placeholder: t('create.import.placeholder'),
      spellcheck: 'false',
      autocomplete: 'off'
    });
    const importForm = h(
      'form',
      {
        class: 'import-form',
        onsubmit: (event: Event) => {
          event.preventDefault();
          this.importLevel(textarea.value, status);
        }
      },
      h('label', { for: 'import-code' }, t('create.import.label')),
      h(
        'div',
        { class: 'import-row' },
        textarea,
        h(
          'button',
          { class: 'button button-secondary', type: 'submit' },
          icon('download'),
          t('create.import.submit')
        )
      ),
      status
    );

    const startCard = (
      accent: string,
      iconName: string,
      title: string,
      body: string,
      action: () => void
    ): HTMLElement =>
      h(
        'li',
        {},
        h(
          'button',
          {
            class: `start-card accent-${accent}`,
            type: 'button',
            disabled: empty === null,
            onclick: action
          },
          h('span', { class: 'start-card-icon' }, icon(iconName)),
          h('span', { class: 'start-card-title' }, title),
          h('span', { class: 'start-card-body' }, body)
        )
      );

    const starts = h(
      'ul',
      { class: 'start-grid', role: 'list' },
      startCard('storm', 'dice', t('workshop.surprise.title'), t('workshop.surprise.body'), () =>
        this.startWorkshopLevel({
          name: `${t('workshop.surprise.title').replace(/\s*!$/, '')} ${Math.floor(Math.random() * 900) + 100}`,
          rows: generateLevel(randomSeed())
        })
      ),
      startCard('forge', 'grid', t('workshop.campaign.title'), t('workshop.campaign.body'), () =>
        this.openCampaignPicker()
      ),
      startCard('steel', 'pencil', t('workshop.blank.title'), t('workshop.blank.body'), () =>
        this.startWorkshopLevel(null)
      )
    );

    const slots = Object.values(data.creativeLevelSlots).sort((a, b) => a.slotIndex - b.slotIndex);
    const draftOnly: number[] = [];
    for (let index = 0; index < SLOT_COUNT; index += 1) {
      if (!data.creativeLevelSlots[String(index)] && readDraft(index)) {
        draftOnly.push(index);
      }
    }

    const cards = slots.map((slot) => {
      const difficulty = estimateDifficulty(slot.rows);
      const hasDraft = readDraft(slot.slotIndex) !== null;
      return h(
        'li',
        {},
        h(
          'article',
          { class: 'level-card creation-card accent-steel' },
          h(
            'a',
            {
              class: 'card-visual',
              href: `#/create/edit/${slot.slotIndex}`,
              'aria-label': `${t('create.edit')} — ${slot.name}`
            },
            h('canvas', { 'data-level': `creative:${slot.slotIndex}`, 'aria-hidden': 'true' }),
            hasDraft ? h('span', { class: 'draft-badge' }, t('editor.unsaved')) : null
          ),
          h(
            'div',
            { class: 'card-meta' },
            h(
              'span',
              { class: 'card-text' },
              h('span', { class: 'card-title' }, slot.name),
              h(
                'span',
                { class: 'card-sub' },
                `${'★'.repeat(difficulty)}${'☆'.repeat(5 - difficulty)} · ${t('create.updated', { date: formatDate(slot.updatedAt) })}`
              )
            )
          ),
          h(
            'div',
            { class: 'card-actions' },
            h(
              'a',
              {
                class: 'button button-primary button-sm',
                href: playHash('creative', slot.slotIndex)
              },
              icon('play'),
              t('create.play')
            ),
            h(
              'a',
              {
                class: 'button button-secondary button-sm',
                href: `#/create/edit/${slot.slotIndex}`
              },
              icon('pencil'),
              t('create.edit')
            ),
            h(
              'button',
              {
                class: 'icon-button',
                type: 'button',
                title: t('create.duplicate'),
                'aria-label': `${t('create.duplicate')} — ${slot.name}`,
                onclick: () => this.duplicateSlot(slot.slotIndex)
              },
              icon('copy')
            ),
            h(
              'button',
              {
                class: 'icon-button',
                type: 'button',
                title: t('create.share'),
                'aria-label': `${t('create.share')} — ${slot.name}`,
                onclick: () => void this.shareSlot(slot.slotIndex)
              },
              icon('share')
            ),
            h(
              'button',
              {
                class: 'icon-button icon-button-danger',
                type: 'button',
                title: t('create.delete'),
                'aria-label': `${t('create.delete')} — ${slot.name}`,
                onclick: () => void this.deleteSlot(slot.slotIndex)
              },
              icon('trash')
            )
          )
        )
      );
    });

    const draftCards = draftOnly.map((slotIndex) => {
      const draft = readDraft(slotIndex);
      const name = draft?.name ?? t('create.slot', { n: slotIndex + 1 });
      return h(
        'li',
        {},
        h(
          'article',
          { class: 'level-card creation-card is-draft accent-storm' },
          h(
            'a',
            {
              class: 'card-visual',
              href: `#/create/edit/${slotIndex}`,
              'aria-label': `${t('create.edit')} — ${name}`
            },
            h('canvas', { 'data-level': `draft:${slotIndex}`, 'aria-hidden': 'true' }),
            h('span', { class: 'draft-badge' }, t('editor.unsaved'))
          ),
          h(
            'div',
            { class: 'card-meta' },
            h('span', { class: 'card-text' }, h('span', { class: 'card-title' }, name))
          ),
          h(
            'div',
            { class: 'card-actions' },
            h(
              'a',
              { class: 'button button-primary button-sm', href: `#/create/edit/${slotIndex}` },
              icon('pencil'),
              t('create.edit')
            ),
            h(
              'button',
              {
                class: 'icon-button icon-button-danger',
                type: 'button',
                title: t('create.delete'),
                'aria-label': `${t('create.delete')} — ${name}`,
                onclick: () => {
                  clearDraft(slotIndex);
                  this.renderMenu('create');
                }
              },
              icon('trash')
            )
          )
        )
      );
    });

    const mine = [...draftCards, ...cards];
    return h(
      'section',
      { class: 'screen workshop', 'aria-labelledby': 'screen-title' },
      this.screenHeader(t('workshop.title'), t('workshop.subtitle')),
      h('h2', { class: 'section-title' }, t('workshop.start')),
      empty === null ? h('p', { class: 'form-status is-error' }, t('create.import.full')) : null,
      starts,
      h('h2', { class: 'section-title' }, t('workshop.mine')),
      mine.length > 0
        ? h('ul', { class: 'card-grid', role: 'list' }, ...mine)
        : h('p', { class: 'empty-note' }, t('workshop.mineEmpty')),
      h(
        'details',
        { class: 'panel import-panel' },
        h('summary', { class: 'panel-title' }, icon('download'), t('workshop.importToggle')),
        importForm
      )
    );
  }

  /** Opens the editor on a free slot, pre-filled with a draft (template or surprise). */
  private startWorkshopLevel(draft: { name: string; rows: string[] } | null): void {
    const slotIndex = this.firstEmptySlot();
    if (slotIndex === null) {
      this.toast(t('create.import.full'));
      return;
    }
    if (draft) {
      writeDraft(slotIndex, { ...draft, fresh: true });
    } else {
      clearDraft(slotIndex);
    }
    this.navigate(`#/create/edit/${slotIndex}`);
  }

  private openCampaignPicker(): void {
    const grid = h(
      'ul',
      { class: 'picker-grid', role: 'list' },
      ...LEVEL_PATTERNS.map((pattern, index) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              class: 'picker-item',
              type: 'button',
              onclick: () => {
                this.closeOverlays();
                this.startWorkshopLevel({
                  name: levelDisplayName(pattern.name),
                  rows: [...pattern.rows]
                });
              }
            },
            h('canvas', { 'data-level': `pattern:${index}`, 'aria-hidden': 'true' }),
            h('span', {}, `${index + 1}. ${levelDisplayName(pattern.name)}`)
          )
        )
      )
    );
    this.openDialog(
      t('workshop.pickTitle'),
      [grid],
      [{ label: t('common.cancel'), variant: 'secondary', action: () => this.closeOverlays() }],
      () => this.closeOverlays(),
      'dialog-wide'
    );
    grid.querySelectorAll<HTMLCanvasElement>('canvas[data-level]').forEach((canvas) => {
      const level = this.resolvePreviewLevel(canvas.dataset.level ?? '');
      if (level) drawLevelPreview(canvas, level);
    });
  }

  private renderEditor(slotIndex: number): void {
    this.demoRunning = false;
    this.setView('editor');
    clear(this.topbar);
    this.mountStage(null);
    clear(this.main);
    this.editor = new EditorScreen(
      {
        save: this.save,
        toast: (message) => this.toast(message),
        openDialog: (title, body, actions, onEscape) =>
          this.openDialog(title, body, actions, onEscape),
        closeOverlays: () => this.closeOverlays(),
        navigate: (hash) => this.navigate(hash),
        testDraft: (index, name, rows, options) => {
          this.pendingDraft = { slotIndex: index, name, rows, options };
          this.navigate(playHash('creative', index));
        },
        shareCode: (rows, name, options) => void this.shareCode(rows, name, options)
      },
      slotIndex
    );
    this.main.append(this.editor.element);
  }

  private importLevel(code: string, status: HTMLElement): void {
    status.classList.remove('is-error', 'is-success');
    const slotIndex = this.firstEmptySlot();
    try {
      const decoded = decodeCreativeLevelCode(code);
      if (slotIndex === null) {
        throw new Error('full');
      }
      const name = decoded.name ?? t('create.slot', { n: slotIndex + 1 });
      this.save.setCreativeLevelSlot(slotIndex, decoded.rows, name, Date.now(), decoded.options);
      this.toast(t('create.import.success', { name, n: slotIndex + 1 }));
      this.renderMenu('create');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const key: MessageKey =
        message === 'full'
          ? 'create.import.full'
          : message.includes('Corrupted')
            ? 'create.import.corrupted'
            : message.includes('Unsupported')
              ? 'create.import.unsupported'
              : message.includes('breakable')
                ? 'create.import.empty'
                : 'create.import.invalid';
      status.textContent = t(key);
      status.classList.add('is-error');
    }
  }

  private duplicateSlot(slotIndex: number): void {
    const source = this.save.getCreativeLevelSlot(slotIndex);
    const target = this.firstEmptySlot();
    if (!source) {
      return;
    }
    if (target === null) {
      this.toast(t('create.import.full'));
      return;
    }
    const suffix = getLanguage() === 'fr' ? ' (copie)' : ' (copy)';
    this.save.setCreativeLevelSlot(
      target,
      source.rows,
      `${source.name}${suffix}`,
      Date.now(),
      source.options
    );
    this.toast(t('create.duplicated', { n: target + 1 }));
    this.renderMenu('create');
  }

  private async shareSlot(slotIndex: number): Promise<void> {
    const slot = this.save.getCreativeLevelSlot(slotIndex);
    if (slot) {
      await this.shareCode(slot.rows, slot.name, slot.options);
    }
  }

  private async shareCode(
    rows: readonly string[],
    name: string,
    options?: LevelOptions
  ): Promise<void> {
    const code = encodeCreativeLevelCode(rows, name, options);
    try {
      await navigator.clipboard.writeText(code);
      this.toast(t('create.copied'));
    } catch {
      const area = h('textarea', { class: 'code-output', readonly: true, rows: '4' });
      area.value = code;
      this.openDialog(
        t('create.share'),
        [h('p', {}, t('create.copyFallback')), area],
        [{ label: t('common.close'), variant: 'primary', action: () => this.closeOverlays() }]
      );
      area.select();
    }
  }

  private async deleteSlot(slotIndex: number): Promise<void> {
    const slot = this.save.getCreativeLevelSlot(slotIndex);
    if (!slot) {
      return;
    }
    if (await this.confirm(t('create.deleteConfirm', { name: slot.name }), t('create.delete'))) {
      this.save.removeCreativeLevelSlot(slotIndex);
      this.toast(t('create.deleted'));
      this.renderMenu('create');
    }
  }

  /** HUD chip of an active effect: icon, colour, time gauge and charges. */
  private effectChip(effect: { type: string; ratio: number; count?: number }): HTMLElement {
    const known = POWER_UP_TYPES.find((type) => type === effect.type);
    const definition = known ? getPowerUpDefinition(known) : null;
    const color = definition ? `#${definition.color.toString(16).padStart(6, '0')}` : '#ffb423';
    const label = known ? (t(`power.${known}` as MessageKey).split(' — ')[0] ?? '') : effect.type;
    return h(
      'li',
      {
        class: `power-chip effect-chip${definition?.risk ? ' is-risk' : ''}`,
        'data-effect': effect.type,
        style: `--chip: ${color}; --ratio: ${effect.ratio.toFixed(3)}`,
        title: label,
        'aria-label': effect.count ? `${label} ×${effect.count}` : label
      },
      definition?.icon ?? '?',
      effect.count ? h('small', {}, `×${effect.count}`) : null
    );
  }

  private onNotice(notice: GameNotice): void {
    const card = this.cardForNotice(notice);
    if (!card) return;
    if (this.view === 'play' && this.hudRefs.bonusCard) {
      this.queueCard(card);
    } else if (notice.kind !== 'pickup') {
      this.toast(card.text ? `${card.title} — ${card.text}` : card.title);
    }
  }

  /** Turns a game notice into the content of the bonus card. */
  private cardForNotice(notice: GameNotice): BonusCard | null {
    switch (notice.kind) {
      case 'pickup': {
        const known = POWER_UP_TYPES.find((type) => type === notice.id);
        if (!known) return null;
        const definition = getPowerUpDefinition(known);
        const [title, text] = splitInfo(t(`power.${known}` as MessageKey));
        return {
          tag: notice.first
            ? t('bonus.new')
            : definition.risk
              ? t('bonus.risk')
              : t('bonus.picked'),
          highlight: notice.first,
          title,
          text: notice.first ? text : '',
          color: hexColor(definition.color),
          icon: definition.icon,
          durationMs: notice.first ? 5200 : 2200
        };
      }
      case 'discovery': {
        const [group, id] = notice.id.split(':');
        if (group !== 'brick' || !id) return null;
        const key = `brickinfo.${id}`;
        if (!hasMessage(key)) return null;
        const [title, text] = splitInfo(t(key as MessageKey));
        return {
          tag: t('bonus.mechanism'),
          highlight: true,
          title,
          text,
          color: '#c6a8ff',
          brick: BRICK_SYMBOL_FOR_KIND[id],
          durationMs: 5600
        };
      }
      case 'combo':
        return {
          tag: t('bonus.combo'),
          highlight: true,
          title: t(`combo.${notice.id}` as MessageKey),
          text: splitInfo(t(`help.combo.${notice.id}` as MessageKey))[1],
          color: '#ffb423',
          icon: '✦',
          durationMs: 4200
        };
      case 'event': {
        const key = `notice.event.${notice.id}`;
        return hasMessage(key)
          ? {
              tag: t('bonus.event'),
              highlight: false,
              title: t(key as MessageKey),
              text: '',
              color: '#9fd6ff',
              icon: notice.id === 'storm' ? '⚡' : notice.id === 'descend' ? '↓' : '★',
              durationMs: 3600
            }
          : null;
      }
      default:
        return null;
    }
  }

  private queueCard(card: BonusCard): void {
    // A new pickup replaces a plain pickup on screen; discoveries wait their turn.
    if (this.cardShowing && !this.cardShowing.highlight && !card.highlight) {
      this.cardQueue.length = 0;
      this.showNextCard(card);
      return;
    }
    this.cardQueue.push(card);
    if (!this.cardShowing) this.showNextCard();
  }

  private showNextCard(card = this.cardQueue.shift()): void {
    window.clearTimeout(this.cardTimer);
    this.cardShowing = card ?? null;
    if (!this.hoveredEffect) this.paintCard(this.cardShowing);
    if (card) {
      this.cardTimer = window.setTimeout(() => this.showNextCard(), card.durationMs);
    }
  }

  /** Draws a card (or hides it) in the left HUD and at the top of the stage on phones. */
  private paintCard(card: BonusCard | null): void {
    [this.hudRefs.bonusCard, this.hudRefs.cBonusCard].forEach((element) => {
      if (!element) return;
      if (!card) {
        element.hidden = true;
        clear(element);
        return;
      }
      clear(element);
      element.hidden = false;
      element.classList.toggle('is-highlight', card.highlight);
      element.style.setProperty('--chip', card.color);
      let visual: HTMLElement;
      if (card.brick) {
        visual = h('canvas', {
          class: 'bonus-card-brick',
          width: '44',
          height: '40',
          'aria-hidden': 'true'
        });
        const sprite = brickSprite(card.brick);
        if (sprite) (visual as HTMLCanvasElement).getContext('2d')?.drawImage(sprite, 0, 0);
      } else {
        visual = h('span', { class: 'bonus-card-icon', 'aria-hidden': 'true' }, card.icon ?? '');
      }
      element.append(
        visual,
        h(
          'div',
          { class: 'bonus-card-body' },
          h('p', { class: 'bonus-card-tag' }, card.tag),
          h('p', { class: 'bonus-card-title' }, card.title),
          card.text ? h('p', { class: 'bonus-card-text' }, card.text) : null
        )
      );
      // Restart the entrance animation.
      element.classList.remove('is-entering');
      void element.offsetWidth;
      element.classList.add('is-entering');
    });
  }

  /** Card describing an active effect, shown while its row is hovered or focused. */
  private effectInfoCard(type: string): BonusCard | null {
    const known = POWER_UP_TYPES.find((item) => item === type);
    if (!known) return null;
    const definition = getPowerUpDefinition(known);
    const [title, text] = splitInfo(t(`power.${known}` as MessageKey));
    return {
      tag: definition.risk ? t('bonus.risk') : t('bonus.title'),
      highlight: false,
      title,
      text,
      color: hexColor(definition.color),
      icon: definition.icon,
      durationMs: 0
    };
  }

  /** Active effects: one row each (icon, name, time gauge, charges); chips on phones. */
  private renderBonusList(effects: HudSnapshot['effects']): void {
    const list = this.hudRefs.effects;
    const compact = this.hudRefs.cEffects;
    const signature = effects.map((effect) => `${effect.type}:${effect.count ?? ''}`).join(',');
    if (list && list.dataset.signature !== signature) {
      list.dataset.signature = signature;
      clear(list);
      if (effects.length === 0) {
        list.append(h('li', { class: 'bonus-empty' }, t('bonus.empty')));
      }
      effects.forEach((effect) => list.append(this.bonusRow(effect)));
      if (this.hoveredEffect && !effects.some((effect) => effect.type === this.hoveredEffect)) {
        this.hoveredEffect = null;
        this.paintCard(this.cardShowing);
      }
    }
    if (compact && compact.dataset.signature !== signature) {
      compact.dataset.signature = signature;
      clear(compact);
      effects.forEach((effect) => compact.append(this.effectChip(effect)));
    }
    [list, compact].forEach((root) =>
      root?.querySelectorAll<HTMLElement>('[data-effect]').forEach((element) => {
        const effect = effects.find((item) => item.type === element.dataset.effect);
        if (effect) element.style.setProperty('--ratio', effect.ratio.toFixed(3));
      })
    );
  }

  private bonusRow(effect: { type: string; ratio: number; count?: number }): HTMLElement {
    const known = POWER_UP_TYPES.find((type) => type === effect.type);
    const definition = known ? getPowerUpDefinition(known) : null;
    const name = known ? splitInfo(t(`power.${known}` as MessageKey))[0] : effect.type;
    const show = (): void => {
      this.hoveredEffect = effect.type;
      this.paintCard(this.effectInfoCard(effect.type));
    };
    const hide = (): void => {
      if (this.hoveredEffect !== effect.type) return;
      this.hoveredEffect = null;
      this.paintCard(this.cardShowing);
    };
    return h(
      'li',
      {
        class: `bonus-row${definition?.risk ? ' is-risk' : ''}`,
        'data-effect': effect.type,
        tabindex: '0',
        style: `--chip: ${definition ? hexColor(definition.color) : '#ffb423'}; --ratio: ${effect.ratio.toFixed(3)}`,
        onmouseenter: show,
        onmouseleave: hide,
        onfocus: show,
        onblur: hide
      },
      h('span', { class: 'bonus-row-icon', 'aria-hidden': 'true' }, definition?.icon ?? '?'),
      h('span', { class: 'bonus-row-name' }, name),
      effect.count ? h('span', { class: 'bonus-row-count' }, `×${effect.count}`) : null,
      h('span', { class: 'bonus-row-gauge', 'aria-hidden': 'true' }, h('i'))
    );
  }

  private helpScreen(): HTMLElement {
    const bricks: Array<[string, MessageKey]> = [
      ['1', 'help.brick.standard'],
      ['2', 'help.brick.resistant'],
      ['E', 'help.brick.explosive'],
      ['B', 'help.brick.bonus'],
      ['S', 'help.brick.shield'],
      ['X', 'help.brick.indestructible']
    ];
    const mechanisms: Array<[string, MessageKey]> = [
      ['C', 'brickinfo.crystal'],
      ['K', 'brickinfo.key'],
      ['G', 'brickinfo.gate'],
      ['R', 'brickinfo.phoenix'],
      ['I', 'brickinfo.invisible'],
      ['M', 'brickinfo.mover'],
      ['O', 'brickinfo.bumper'],
      ['T', 'brickinfo.teleporter'],
      ['F', 'brickinfo.fuse']
    ];
    const brickItem = ([symbol, key]: [string, MessageKey]): HTMLElement => {
      const swatch = h('canvas', {
        class: 'help-swatch',
        width: '44',
        height: '40',
        'aria-hidden': 'true'
      });
      const sprite = brickSprite(symbol);
      if (sprite) swatch.getContext('2d')?.drawImage(sprite, 0, 0);
      return h('li', {}, swatch, t(key));
    };

    return h(
      'section',
      { class: 'screen', 'aria-labelledby': 'screen-title' },
      this.screenHeader(t('help.title'), t('help.tips')),
      h(
        'div',
        { class: 'help-grid' },
        h(
          'div',
          { class: 'panel' },
          h('h2', { class: 'panel-title' }, t('help.controls')),
          h(
            'ul',
            { class: 'help-list' },
            ...(
              [
                'help.controls.move',
                'help.controls.launch',
                'help.controls.pause',
                'help.controls.restart'
              ] as MessageKey[]
            ).map((key) => h('li', {}, t(key)))
          )
        ),
        h(
          'div',
          { class: 'panel' },
          h('h2', { class: 'panel-title' }, t('help.bricks')),
          h('ul', { class: 'help-list' }, ...bricks.map(brickItem))
        ),
        h(
          'div',
          { class: 'panel' },
          h('h2', { class: 'panel-title' }, t('help.mechanisms')),
          h('ul', { class: 'help-list' }, ...mechanisms.map(brickItem))
        ),
        h(
          'div',
          { class: 'panel' },
          h('h2', { class: 'panel-title' }, t('help.powerups')),
          h(
            'ul',
            { class: 'help-list' },
            ...POWER_UP_TYPES.map((type) => {
              const definition = getPowerUpDefinition(type);
              return h(
                'li',
                {},
                h(
                  'span',
                  {
                    class: `power-chip effect-chip${definition.risk ? ' is-risk' : ''}`,
                    style: `--chip: #${definition.color.toString(16).padStart(6, '0')}; --ratio: 1`,
                    'aria-hidden': 'true'
                  },
                  definition.icon
                ),
                t(`power.${type}` as MessageKey)
              );
            })
          ),
          h('p', { class: 'help-note' }, t('help.risk'))
        ),
        h(
          'div',
          { class: 'panel' },
          h('h2', { class: 'panel-title' }, t('help.combos')),
          h(
            'ul',
            { class: 'help-list' },
            ...(
              ['help.combo.meteor', 'help.combo.explosiveLasers', 'help.combo.sun'] as MessageKey[]
            ).map((key) => h('li', {}, t(key)))
          )
        )
      )
    );
  }

  private settingsScreen(): HTMLElement {
    const prefs = this.save.snapshot().preferences;
    const segmented = <T extends string>(
      name: string,
      legend: string,
      value: T,
      options: Array<[T, string]>,
      onChange: (value: T) => void
    ): HTMLElement =>
      h(
        'fieldset',
        { class: 'setting' },
        h('legend', { class: 'setting-label' }, legend),
        h(
          'div',
          { class: 'segmented' },
          ...options.map(([optionValue, label]) => {
            const input = h('input', {
              type: 'radio',
              name,
              value: optionValue,
              id: `${name}-${optionValue}`,
              checked: optionValue === value,
              onchange: () => onChange(optionValue)
            });
            return h('label', { for: `${name}-${optionValue}` }, input, h('span', {}, label));
          })
        )
      );
    const toggle = (
      id: string,
      label: string,
      checked: boolean,
      onChange: (value: boolean) => void,
      hint?: string
    ): HTMLElement =>
      h(
        'div',
        { class: 'setting setting-row' },
        h(
          'label',
          { class: 'switch', for: id },
          h('span', { class: 'setting-label' }, label, hint ? h('small', {}, hint) : null),
          h('input', {
            type: 'checkbox',
            role: 'switch',
            id,
            checked,
            onchange: (event: Event) => onChange((event.target as HTMLInputElement).checked)
          }),
          h('span', { class: 'switch-track', 'aria-hidden': 'true' })
        )
      );

    const volume = h('input', {
      type: 'range',
      id: 'volume',
      min: '0',
      max: '100',
      step: '5',
      value: String(Math.round(prefs.volumeSfx * 100)),
      oninput: (event: Event) => {
        const value = Number((event.target as HTMLInputElement).value) / 100;
        this.save.setVolumeSfx(value);
        this.applySound();
        audio.play('brickBreak', { combo: 3 });
      }
    });

    const fullscreenSupported = typeof document.documentElement.requestFullscreen === 'function';

    return h(
      'section',
      { class: 'screen screen-narrow', 'aria-labelledby': 'screen-title' },
      this.screenHeader(t('settings.title'), ''),
      isPersistentStorageAvailable()
        ? null
        : h('p', { class: 'notice' }, t('settings.storage.warning')),
      h(
        'div',
        { class: 'panel settings-panel' },
        segmented(
          'language',
          t('settings.language'),
          prefs.language,
          [
            ['fr', 'Français'],
            ['en', 'English']
          ],
          (value) => this.setLanguagePreference(value)
        ),
        toggle('sound', t('settings.sound'), prefs.soundEnabled, (value) => {
          this.save.setSoundEnabled(value);
          this.applySound();
        }),
        h(
          'div',
          { class: 'setting' },
          h('label', { class: 'setting-label', for: 'volume' }, t('settings.volume')),
          volume
        ),
        segmented<FxQuality>(
          'fx',
          t('settings.fx'),
          prefs.fxQuality,
          [
            ['low', t('settings.fx.low')],
            ['med', t('settings.fx.med')],
            ['high', t('settings.fx.high')]
          ],
          (value) => this.save.setFxQuality(value)
        ),
        toggle(
          'motion',
          t('settings.motion'),
          prefs.reducedMotion,
          (value) => {
            this.save.setReducedMotion(value);
            this.applyMotionPreference();
          },
          t('settings.motion.hint')
        ),
        fullscreenSupported
          ? h(
              'div',
              { class: 'setting setting-row' },
              h('span', { class: 'setting-label' }, t('settings.fullscreen')),
              h(
                'button',
                {
                  class: 'button button-secondary',
                  type: 'button',
                  onclick: () => void this.toggleFullscreen()
                },
                icon('maximize'),
                document.fullscreenElement
                  ? t('settings.fullscreen.exit')
                  : t('settings.fullscreen.enter')
              )
            )
          : null,
        h(
          'div',
          { class: 'setting setting-row' },
          h('span', { class: 'setting-label' }, t('settings.reset')),
          h(
            'button',
            {
              class: 'button button-danger',
              type: 'button',
              onclick: () => void this.resetProgress()
            },
            icon('trash'),
            t('settings.reset')
          )
        ),
        ADMIN_ENABLED
          ? h(
              'div',
              { class: 'setting setting-row' },
              h('a', { class: 'button button-ghost', href: '#/admin' }, t('settings.admin'))
            )
          : null
      )
    );
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Some browsers (iOS Safari) refuse fullscreen for documents; nothing else to do.
    }
    if (this.route.name === 'settings') {
      this.renderMenu('settings');
    }
  }

  private async resetProgress(): Promise<void> {
    if (await this.confirm(t('settings.reset.confirm'), t('settings.reset'))) {
      this.save.reset();
      this.toast(t('settings.reset.done'));
      this.renderMenu('settings');
    }
  }

  private setLanguagePreference(language: 'fr' | 'en'): void {
    this.save.setLanguage(language);
    setLanguage(language);
    this.rerender();
  }

  private toggleSound(): void {
    const prefs = this.save.snapshot().preferences;
    this.save.setSoundEnabled(!prefs.soundEnabled);
    this.applySound();
    this.rerender();
  }

  private applySound(): void {
    const prefs = this.save.snapshot().preferences;
    audio.setEnabled(prefs.soundEnabled);
    audio.setVolume(prefs.volumeSfx);
  }

  private applyMotionPreference(): void {
    this.root.classList.toggle('reduce-motion', this.save.snapshot().preferences.reducedMotion);
  }

  private rerender(): void {
    if (this.view === 'play') {
      this.renderTopbar('play');
      this.renderPlay();
      if (this.lastHud) {
        this.updateHud(this.lastHud);
      }
      if (this.paused) {
        this.showPause();
      }
      return;
    }
    if (this.view !== 'tool') {
      this.handleRoute();
    }
  }

  private onSaveChanged(): void {
    // Keep the top bar sound icon honest when another part of the app changes the setting.
  }

  // ---------------------------------------------------------------------------------- play

  private startFromRoute(route: Extract<Route, { name: 'play' }>): void {
    const data = this.save.snapshot();
    if (route.mode === 'campaign' && route.index > data.unlockedLevel) {
      this.navigate('#/campaign');
      return;
    }
    const draft =
      route.mode === 'creative' && this.pendingDraft?.slotIndex === route.index
        ? this.pendingDraft
        : null;
    this.pendingDraft = null;
    if (route.mode === 'creative' && !draft && !data.creativeLevelSlots[String(route.index)]) {
      this.navigate('#/create');
      return;
    }

    const session: GameSession = { mode: route.mode, levelIndex: route.index };
    if (route.mode === 'endless') {
      session.wave = 1;
      session.seed = createRunSeed();
    } else if (route.mode === 'daily') {
      const dateKey = utcDateKey();
      session.wave = 1;
      session.dateKey = dateKey;
      session.seed = dailySeed(dateKey);
    } else if (route.mode === 'creative') {
      session.editorReturn = { mode: 'creative', slotIndex: route.index };
      if (draft) {
        session.draft = { name: draft.name, rows: draft.rows, options: draft.options };
      }
    }
    this.startSession(session);
  }

  private startSession(session: GameSession): void {
    this.closeOverlays();
    this.demoRunning = false;
    this.activeSessionKey = sessionKey(session);
    this.lastResult = null;
    this.paused = false;
    this.lastHud = null;
    this.setView('play');
    this.renderTopbar('play');
    this.renderPlay();

    const loading = this.showLoading();
    this.engine
      .load()
      .then((engine) => {
        loading.remove();
        engine.start(session);
        this.focusStage();
      })
      .catch(() => {
        // The loading panel switches to its error state through onEngineState.
      });
  }

  private renderPlay(): void {
    clear(this.main);
    const ref = (key: string, element: HTMLElement): HTMLElement => {
      this.hudRefs[key] = element;
      return element;
    };
    this.hudRefs = {};

    const pauseButton = (extraClass: string): HTMLElement =>
      h(
        'button',
        {
          class: `icon-button icon-button-lg ${extraClass}`,
          type: 'button',
          'aria-label': t('hud.pause'),
          onclick: () => this.pauseGame()
        },
        icon('pause')
      );

    const slot = h(
      'div',
      { class: 'play-stage', tabindex: '-1', 'aria-label': 'Bounce Forge' },
      ref('launchHint', h('p', { class: 'launch-hint', hidden: true }, t('hud.launch')))
    );

    this.main.append(
      h(
        'section',
        { class: 'play', 'aria-label': t('mode.campaign') },
        h(
          'aside',
          { class: 'hud hud-left', 'aria-label': t('hud.score') },
          ref('mode', h('p', { class: 'hud-eyebrow' })),
          ref('title', h('h1', { class: 'hud-title' })),
          ref('chapter', h('p', { class: 'hud-sub' })),
          h(
            'div',
            { class: 'hud-block' },
            h('p', { class: 'hud-label' }, t('hud.score')),
            ref('score', h('p', { class: 'hud-score' }, '0'))
          ),
          h(
            'div',
            { class: 'hud-block' },
            h('p', { class: 'hud-label' }, t('hud.best')),
            ref('best', h('p', { class: 'hud-value' }, '0'))
          ),
          h(
            'div',
            { class: 'hud-block' },
            h('p', { class: 'hud-label' }, t('hud.lives')),
            ref('lives', h('p', { class: 'hud-lives' }))
          ),
          h(
            'section',
            { class: 'bonus-panel', 'aria-label': t('bonus.title') },
            h('p', { class: 'hud-label' }, t('bonus.title')),
            ref(
              'effects',
              h(
                'ul',
                { class: 'bonus-list', role: 'list' },
                h('li', { class: 'bonus-empty' }, t('bonus.empty'))
              )
            ),
            ref('bonusCard', h('div', { class: 'bonus-card', role: 'status', hidden: true }))
          )
        ),
        slot,
        h(
          'aside',
          { class: 'hud hud-right', 'aria-label': t('hud.objective') },
          h(
            'div',
            { class: 'hud-block' },
            h('p', { class: 'hud-label' }, t('hud.objective')),
            ref('objective', h('p', { class: 'hud-value' })),
            h(
              'div',
              { class: 'meter', 'aria-hidden': 'true' },
              ref('objectiveBar', h('span', { class: 'meter-fill' }))
            )
          ),
          h(
            'div',
            { class: 'hud-block' },
            h('p', { class: 'hud-label' }, t('hud.bricks')),
            ref('bricks', h('p', { class: 'hud-value' })),
            h(
              'div',
              { class: 'meter meter-quiet', 'aria-hidden': 'true' },
              ref('bricksBar', h('span', { class: 'meter-fill' }))
            )
          ),
          h(
            'div',
            { class: 'hud-row' },
            h(
              'div',
              { class: 'hud-block' },
              h('p', { class: 'hud-label' }, t('hud.balls')),
              ref('balls', h('p', { class: 'hud-value' }, '1'))
            ),
            h(
              'div',
              { class: 'hud-block' },
              h('p', { class: 'hud-label' }, t('hud.combo')),
              ref('combo', h('p', { class: 'hud-value' }, '0'))
            )
          ),
          pauseButton('hud-pause')
        ),
        h(
          'div',
          { class: 'hud-compact', 'aria-hidden': 'false' },
          h(
            'div',
            { class: 'compact-cell' },
            h('span', { class: 'hud-label' }, t('hud.score')),
            ref('cScore', h('span', { class: 'compact-value' }, '0'))
          ),
          h(
            'div',
            { class: 'compact-cell' },
            h('span', { class: 'hud-label' }, t('hud.lives')),
            ref('cLives', h('span', { class: 'compact-value hud-lives' }))
          ),
          h(
            'div',
            { class: 'compact-cell compact-objective' },
            ref('cObjective', h('span', { class: 'hud-label' })),
            h(
              'div',
              { class: 'meter', 'aria-hidden': 'true' },
              ref('cObjectiveBar', h('span', { class: 'meter-fill' }))
            )
          ),
          pauseButton('compact-pause'),
          ref('cEffects', h('ul', { class: 'compact-effects', role: 'list' }))
        )
      )
    );
    slot.append(
      ref(
        'cBonusCard',
        h('div', { class: 'bonus-card bonus-card-compact', role: 'status', hidden: true })
      )
    );
    this.cardQueue.length = 0;
    this.cardShowing = null;
    this.hoveredEffect = null;
    window.clearTimeout(this.cardTimer);

    this.mountStage(slot);
    if (!this.save.snapshot().tutorialSeen && this.activeSessionKey?.startsWith('campaign')) {
      slot.append(
        h(
          'div',
          { class: 'coach', role: 'note' },
          h('p', { class: 'coach-title' }, t('tutorial.title')),
          h('p', {}, t('tutorial.move')),
          h('p', {}, t('tutorial.launch')),
          h(
            'button',
            {
              class: 'button button-primary button-sm',
              type: 'button',
              onclick: (event: Event) => {
                (event.currentTarget as HTMLElement).closest('.coach')?.remove();
                this.save.setTutorialSeen();
                this.focusStage();
              }
            },
            t('tutorial.ok')
          )
        )
      );
    }
  }

  private onHud(hud: HudSnapshot): void {
    if (hud.mode === 'demo') {
      return;
    }
    const key = sessionKey(hud);
    if (this.view !== 'play' || this.activeSessionKey !== key) {
      // A session started from inside the engine (editor "test" button).
      this.activeSessionKey = key;
      this.demoRunning = false;
      this.paused = false;
      this.setView('play');
      this.renderTopbar('play');
      this.renderPlay();
      const hash = playHash(hud.mode, hud.levelIndex);
      if (window.location.hash !== hash) {
        history.replaceState(null, '', hash);
        this.route = parseRoute(hash);
      }
    }
    this.lastHud = hud;
    this.updateHud(hud);
  }

  private updateHud(hud: HudSnapshot): void {
    const r = this.hudRefs;
    const modeLabel =
      hud.mode === 'campaign'
        ? `${t('mode.campaign')} · ${t('campaign.level', { n: hud.levelIndex + 1 })}`
        : hud.mode === 'daily'
          ? `${t('mode.daily')} · ${t('hud.waveOf', { n: hud.wave ?? 1, total: hud.waveCount ?? DAILY_WAVE_COUNT })}`
          : hud.mode === 'endless'
            ? `${t('mode.endless')} · ${t('hud.wave', { n: hud.wave ?? 1 })}`
            : t('mode.creative');
    setText(r.mode, modeLabel);
    setText(r.title, levelDisplayName(hud.levelName));
    setText(r.chapter, this.chapterName(hud.chapter));
    setText(r.score, formatNumber(hud.score));
    setText(r.cScore, formatNumber(hud.score));
    setText(r.best, formatNumber(hud.bestScore));
    const lives = `${'♥'.repeat(Math.max(0, hud.lives))}${'♡'.repeat(Math.max(0, Math.min(hud.maxLives, 5) - hud.lives))}`;
    setText(r.lives, lives);
    setText(r.cLives, String(hud.lives));
    r.lives?.setAttribute('aria-label', `${hud.lives} / ${hud.maxLives}`);

    const objectiveLabel = this.objectiveText(hud.objective.kind, hud.objective.target);
    const ratio =
      hud.objective.target > 0 ? Math.min(1, hud.objective.current / hud.objective.target) : 0;
    const objectiveValue =
      hud.objective.kind === 'clearWithLives' || hud.objective.kind === 'clearWave'
        ? objectiveLabel
        : `${objectiveLabel} · ${hud.objective.current}/${hud.objective.target}`;
    setText(r.objective, objectiveValue);
    setText(r.cObjective, objectiveValue);
    setWidth(
      r.objectiveBar,
      hud.objective.kind === 'clearWithLives'
        ? hud.lives >= hud.objective.target
          ? 1
          : 0.3
        : ratio
    );
    setWidth(
      r.cObjectiveBar,
      hud.objective.kind === 'clearWithLives'
        ? 1 - hud.bricksLeft / Math.max(1, hud.bricksTotal)
        : ratio
    );
    setText(r.bricks, t('hud.bricksLeft', { n: hud.bricksLeft, total: hud.bricksTotal }));
    setWidth(r.bricksBar, 1 - hud.bricksLeft / Math.max(1, hud.bricksTotal));
    setText(r.balls, String(hud.balls));
    setText(r.combo, hud.combo > 1 ? `×${hud.combo}` : '0');

    this.renderBonusList(hud.effects);

    const hint = r.launchHint;
    if (hint) {
      hint.hidden = !hud.waitingToLaunch;
    }
    if (!hud.waitingToLaunch && !this.save.snapshot().tutorialSeen) {
      this.save.setTutorialSeen();
      this.main.querySelector('.coach')?.remove();
    }
  }

  private focusStage(): void {
    const active = document.activeElement as HTMLElement | null;
    active?.blur?.();
    this.main.querySelector<HTMLElement>('.play-stage')?.focus({ preventScroll: true });
  }

  private pauseGame(): void {
    if (
      this.view !== 'play' ||
      this.paused ||
      this.lastResult ||
      !this.engine.controller?.isPlaying()
    ) {
      return;
    }
    this.paused = true;
    this.engine.controller.pause();
    this.showPause();
  }

  private resumeGame(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    this.closeOverlays();
    this.engine.controller?.resume();
    this.focusStage();
  }

  private showPause(): void {
    const prefs = this.save.snapshot().preferences;
    this.openDialog(
      t('pause.title'),
      [
        h(
          'label',
          { class: 'switch', for: 'pause-sound' },
          h('span', { class: 'setting-label' }, t('pause.sound')),
          h('input', {
            type: 'checkbox',
            role: 'switch',
            id: 'pause-sound',
            checked: prefs.soundEnabled,
            onchange: (event: Event) => {
              const enabled = (event.target as HTMLInputElement).checked;
              this.save.setSoundEnabled(enabled);
              this.applySound();
            }
          }),
          h('span', { class: 'switch-track', 'aria-hidden': 'true' })
        )
      ],
      [
        {
          label: t('pause.resume'),
          variant: 'primary',
          icon: 'play',
          action: () => this.resumeGame()
        },
        {
          label: t('pause.restart'),
          variant: 'secondary',
          icon: 'restart',
          action: () => {
            this.paused = false;
            this.closeOverlays();
            this.engine.controller?.restart();
            this.focusStage();
          }
        },
        {
          label: t('pause.quit'),
          variant: 'ghost',
          icon: 'home',
          action: () => this.navigate('#/')
        }
      ],
      () => this.resumeGame()
    );
  }

  private onResult(result: GameResult): void {
    if (result.mode === 'demo' || this.view !== 'play') {
      return;
    }
    this.lastResult = result;
    this.paused = false;

    const isWave = result.mode === 'endless' || result.mode === 'daily';
    const title =
      result.outcome === 'victory'
        ? result.mode === 'daily'
          ? t('result.dailyVictory')
          : t('result.victory')
        : isWave
          ? t('result.waveDefeat')
          : t('result.defeat');

    const rows: HTMLElement[] = [
      h(
        'dl',
        { class: 'result-stats' },
        h(
          'div',
          {},
          h('dt', {}, t('result.score')),
          h('dd', { class: 'result-score' }, formatNumber(result.score))
        ),
        result.medal
          ? h(
              'div',
              {},
              h('dt', {}, t('result.medal')),
              h('dd', {}, this.medalBadge(result.medal), t(`medal.${result.medal}`))
            )
          : null,
        isWave
          ? h(
              'div',
              {},
              h('dt', {}, t('result.waves')),
              h(
                'dd',
                {},
                result.mode === 'daily'
                  ? `${result.wavesCleared ?? 0}/${DAILY_WAVE_COUNT}`
                  : String(result.wavesCleared ?? 0)
              )
            )
          : null
      )
    ];
    if (result.isNewBest) {
      rows.unshift(h('p', { class: 'new-best' }, t('result.newBest')));
    }
    if (result.mode === 'campaign' && result.outcome === 'victory' && !result.hasNext) {
      rows.push(h('p', { class: 'result-note' }, t('result.campaignDone')));
    }

    const actions: DialogAction[] = [];
    if (result.editorReturn && result.mode === 'creative') {
      actions.push({
        label: t('result.editor'),
        variant: 'primary',
        icon: 'pencil',
        action: () => this.navigate(`#/create/edit/${result.editorReturn?.slotIndex ?? 0}`)
      });
    }
    if (result.editorReturn?.mode === 'admin') {
      actions.push({
        label: t('result.editor'),
        variant: 'primary',
        icon: 'pencil',
        action: () => {
          this.closeOverlays();
          this.activeSessionKey = null;
          this.engine.controller?.openEditor({ mode: 'admin', slotIndex: result.levelIndex });
        }
      });
    }
    if (result.outcome === 'victory' && result.hasNext) {
      actions.push({
        label: t('result.next'),
        variant: 'primary',
        icon: 'arrowRight',
        action: () => this.navigate(playHash('campaign', result.levelIndex + 1))
      });
    }
    actions.push({
      label: t('result.retry'),
      variant: actions.length === 0 ? 'primary' : 'secondary',
      icon: 'restart',
      action: () => {
        const session: GameSession = { ...result.session };
        if (session.mode === 'endless') {
          session.seed = createRunSeed();
        }
        this.startSession(session);
      }
    });
    actions.push({
      label: t('result.menu'),
      variant: 'ghost',
      icon: 'home',
      action: () => this.navigate('#/')
    });

    this.openDialog(
      title,
      rows,
      actions,
      undefined,
      result.outcome === 'victory' ? 'is-victory' : 'is-defeat'
    );
  }

  // ------------------------------------------------------------------------------ engine

  private onEngineReady(): void {
    if (this.view === 'home') {
      this.ensureDemo();
    }
  }

  private ensureDemo(): void {
    if (this.activeSessionKey || this.view !== 'home') {
      return;
    }
    if (!this.demoRunning) {
      this.startDemo();
    }
    this.engine.controller?.resume();
  }

  private startDemo(): void {
    const controller = this.engine.controller;
    if (!controller) {
      return;
    }
    controller.quit();
    this.demoRunning = true;
    this.root.classList.add('engine-live');
    if (this.view === 'menu') {
      // Keep the attract mode frozen while menus cover it; it resumes on the home screen.
      window.setTimeout(() => {
        if (this.view === 'menu') {
          controller.pause();
        }
      }, 50);
    }
  }

  private onEngineState(state: EngineState): void {
    this.root.dataset.engine = state;
    if (state === 'ready') {
      // The controller only exists once the loader resolved, after the engine's own "ready".
      window.setTimeout(() => this.onEngineReady(), 0);
    }
    const panel = this.overlayLayer.querySelector<HTMLElement>('.loading');
    if (!panel) {
      return;
    }
    this.fillLoading(panel, state);
  }

  private showLoading(): HTMLElement {
    const panel = h('div', { class: 'loading', role: 'status', 'aria-live': 'polite' });
    this.fillLoading(panel, this.engine.getState());
    const target = this.main.querySelector('.play-stage') ?? this.overlayLayer;
    target.append(panel);
    return panel;
  }

  private fillLoading(panel: HTMLElement, state: EngineState): void {
    if (state === 'ready') {
      panel.remove();
      return;
    }
    clear(panel);
    if (state === 'error') {
      panel.append(
        h('p', { class: 'loading-title' }, t('loading.error')),
        h(
          'button',
          {
            class: 'button button-primary',
            type: 'button',
            onclick: () => {
              if (this.route.name === 'play') {
                this.startFromRoute(this.route);
              } else {
                void this.engine.load().catch(() => undefined);
              }
            }
          },
          icon('restart'),
          t('loading.retry')
        )
      );
      return;
    }
    const progress = state === 'starting' ? 80 : state === 'downloading' ? 40 : 10;
    const bar = h('span', { class: 'meter-fill' });
    bar.style.transform = `scaleX(${progress / 100})`;
    panel.append(
      h('p', { class: 'loading-title' }, t('loading.title')),
      h(
        'div',
        {
          class: 'meter',
          role: 'progressbar',
          'aria-valuemin': '0',
          'aria-valuemax': '100',
          'aria-valuenow': String(progress)
        },
        bar
      ),
      h(
        'p',
        { class: 'loading-step' },
        state === 'starting' ? t('loading.start') : t('loading.download')
      )
    );
  }

  private renderTool(): void {
    clear(this.topbar);
    clear(this.main);
    this.mountStage(null);
    this.stage.setAttribute('aria-hidden', 'false');
    this.syncStage();
  }

  /** Moves the canvas container into the slot of the current view, or the tool layer. */
  private mountStage(slot: HTMLElement | null): void {
    this.stageSlot = slot;
    if (slot) {
      slot.append(this.stage);
      this.stage.setAttribute('aria-hidden', 'true');
    } else if (this.stage.parentElement !== this.root) {
      this.root.append(this.stage);
    }
    this.syncStage();
  }

  private syncStage(): void {
    window.requestAnimationFrame(() => this.engine.controller?.refreshLayout());
  }

  // ------------------------------------------------------------------------------ overlays

  private openDialog(
    title: string,
    body: HTMLElement[],
    actions: DialogAction[],
    onEscape?: () => void,
    tone = ''
  ): void {
    this.closeOverlays();
    const titleId = `dialog-${Math.random().toString(36).slice(2, 8)}`;
    const dialog = h(
      'div',
      { class: `dialog ${tone}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('h2', { class: 'dialog-title', id: titleId }, title),
      ...body,
      h(
        'div',
        { class: 'dialog-actions' },
        ...actions.map((action) =>
          h(
            'button',
            {
              class: `button button-${action.variant}`,
              type: 'button',
              onclick: () => action.action()
            },
            action.icon ? icon(action.icon) : null,
            action.label
          )
        )
      )
    );
    const backdrop = h('div', { class: 'backdrop' }, dialog);
    if (onEscape) {
      backdrop.dataset.escape = '1';
      this.escapeHandler = onEscape;
    } else {
      this.escapeHandler = null;
    }
    this.overlayLayer.append(backdrop);
    this.root.classList.add('has-dialog');
    dialog.querySelector<HTMLElement>('.dialog-actions button')?.focus();
    dialog.addEventListener('keydown', (event) => trapFocus(event, dialog));
  }

  private escapeHandler: (() => void) | null = null;

  private closeOverlays(): void {
    this.overlayLayer.querySelectorAll('.backdrop').forEach((node) => node.remove());
    this.root.classList.remove('has-dialog');
    this.escapeHandler = null;
  }

  private confirm(message: string, confirmLabel: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.openDialog(
        confirmLabel,
        [h('p', {}, message)],
        [
          {
            label: t('common.cancel'),
            variant: 'secondary',
            action: () => {
              this.closeOverlays();
              resolve(false);
            }
          },
          {
            label: confirmLabel,
            variant: 'danger',
            action: () => {
              this.closeOverlays();
              resolve(true);
            }
          }
        ],
        () => {
          this.closeOverlays();
          resolve(false);
        }
      );
    });
  }

  private toast(message: string): void {
    const item = h('p', { class: 'toast' }, message);
    this.toastRegion.append(item);
    window.setTimeout(() => item.remove(), 3200);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return;
    }
    if (this.escapeHandler) {
      event.preventDefault();
      this.escapeHandler();
    }
  }
}

/** Content of the bonus card (pickups, discoveries, combos, events, hovered effects). */
interface BonusCard {
  tag: string;
  highlight: boolean;
  title: string;
  text: string;
  color: string;
  icon?: string;
  /** Brick symbol whose real artwork is drawn instead of an icon. */
  brick?: string;
  durationMs: number;
}

const BRICK_SYMBOL_FOR_KIND: Record<string, string> = {
  crystal: 'C',
  key: 'K',
  gate: 'G',
  phoenix: 'R',
  invisible: 'I',
  mover: 'M',
  bumper: 'O',
  teleporter: 'T',
  fuse: 'F'
};

/** "Name — description" → [name, description]. */
function splitInfo(text: string): [string, string] {
  const index = text.indexOf(' — ');
  if (index < 0) return [text, ''];
  const rest = text.slice(index + 3);
  return [text.slice(0, index), rest.charAt(0).toUpperCase() + rest.slice(1)];
}

function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

interface DialogAction {
  label: string;
  variant: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: string;
  action: () => void;
}

function setText(element: HTMLElement | undefined, value: string): void {
  if (element && element.textContent !== value) {
    element.textContent = value;
  }
}

function setWidth(element: HTMLElement | undefined, ratio: number): void {
  if (element) {
    const value = (Math.round(Math.max(0, Math.min(1, ratio)) * 100) / 100).toString();
    if (element.dataset.ratio !== value) {
      element.dataset.ratio = value;
      element.style.transform = `scaleX(${value})`;
    }
  }
}

function trapFocus(event: KeyboardEvent, container: HTMLElement): void {
  if (event.key !== 'Tab') {
    return;
  }
  const focusable = [
    ...container.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select')
  ].filter((node) => !node.hasAttribute('disabled'));
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) {
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
