import {
  bridge,
  type GameMode,
  type GameResult,
  type GameSession,
  type HudSnapshot
} from '../game/bridge';
import { ADMIN_ENABLED } from '../game/config/features';
import { campaignLevels } from '../game/levels/campaignLevels';
import { decodeCreativeLevelCode, encodeCreativeLevelCode } from '../game/levels/levelShare';
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
import { EngineLoader, type EngineState } from './engine';
import {
  formatDate,
  formatNumber,
  getLanguage,
  hasMessage,
  setLanguage,
  t,
  type MessageKey
} from './i18n';
import { drawLevelPreview } from './preview';

const REPO_URL = 'https://github.com/MATTEO12SA/bounce-forge';
const CHAPTERS = ['Forge Basics', 'Wall Mazes', 'Chain Reactor', 'Ball Storm'] as const;
const CHAPTER_SLUG: Record<string, string> = {
  'Forge Basics': 'forge',
  'Wall Mazes': 'steel',
  'Chain Reactor': 'chain',
  'Ball Storm': 'storm'
};
const SLOT_COUNT = campaignLevels.length;

type View = 'home' | 'menu' | 'play' | 'tool';
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

  public constructor(root: HTMLElement) {
    this.root = root;
    setLanguage(this.save.snapshot().preferences.language);
    this.applyMotionPreference();

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
      bridge.on('waveCleared', ({ wave }) => this.toast(t('wave.cleared', { n: wave }))),
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
        this.demoRunning = false;
        this.setView('tool');
        this.renderTool();
        void this.engine
          .load()
          .then((engine) => engine.openEditor({ mode: 'creative', slotIndex: route.slot }));
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
    if (controller && view === 'menu' && !this.activeSessionKey) {
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
            ? t('home.resumeLevel', { n: resumeIndex + 1, name: resumeLevel?.name ?? '' })
            : t('home.startLevel', { name: campaignLevels[0]?.name ?? '' })
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
              h('span', { class: 'card-title' }, level.name),
              h(
                'span',
                { class: 'card-sub' },
                this.objectiveText(level.objective.type, level.objective.target)
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
                  'aria-label': t('campaign.play', { n: level.index + 1, name: level.name })
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
      h('ul', { class: 'card-grid', role: 'list' }, ...cards)
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
              name: campaignLevels[resumeIndex]?.name ?? ''
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

    const slots = Object.values(data.creativeLevelSlots).sort((a, b) => a.slotIndex - b.slotIndex);
    const empty = this.firstEmptySlot(data);

    const cards = slots.map((slot) => {
      const level = this.levelSystem.getCreativeLevel(slot.slotIndex);
      const breakable =
        level?.bricks.filter((brick) => brick.kind !== 'indestructible').length ?? 0;
      return h(
        'li',
        {},
        h(
          'article',
          { class: 'level-card creation-card accent-steel' },
          h(
            'div',
            { class: 'card-visual' },
            h('canvas', { 'data-level': `creative:${slot.slotIndex}`, 'aria-hidden': 'true' })
          ),
          h(
            'div',
            { class: 'card-meta' },
            h('span', { class: 'card-index' }, String(slot.slotIndex + 1).padStart(2, '0')),
            h(
              'span',
              { class: 'card-text' },
              h('span', { class: 'card-title' }, slot.name),
              h(
                'span',
                { class: 'card-sub' },
                `${t('create.bricks', { n: breakable })} · ${t('create.updated', { date: formatDate(slot.updatedAt) })}`
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

    return h(
      'section',
      { class: 'screen', 'aria-labelledby': 'screen-title' },
      this.screenHeader(
        t('create.title'),
        t('create.subtitle'),
        empty === null
          ? undefined
          : h(
              'a',
              { class: 'button button-primary', href: `#/create/edit/${empty}` },
              icon('plus'),
              t('create.new')
            )
      ),
      h(
        'div',
        { class: 'panel' },
        h('h2', { class: 'panel-title' }, t('create.import.title')),
        importForm
      ),
      h('ul', { class: 'card-grid', role: 'list' }, ...cards)
    );
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
      this.save.setCreativeLevelSlot(slotIndex, decoded.rows, name);
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
    this.save.setCreativeLevelSlot(target, source.rows, `${source.name}${suffix}`);
    this.toast(t('create.duplicated', { n: target + 1 }));
    this.renderMenu('create');
  }

  private async shareSlot(slotIndex: number): Promise<void> {
    const slot = this.save.getCreativeLevelSlot(slotIndex);
    if (!slot) {
      return;
    }
    const code = encodeCreativeLevelCode(slot.rows, slot.name);
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

  private helpScreen(): HTMLElement {
    const bricks: Array<[string, MessageKey]> = [
      ['standard', 'help.brick.standard'],
      ['resistant', 'help.brick.resistant'],
      ['explosive', 'help.brick.explosive'],
      ['bonus', 'help.brick.bonus'],
      ['shield', 'help.brick.shield'],
      ['indestructible', 'help.brick.indestructible']
    ];
    const powers: Array<[string, string, MessageKey]> = [
      ['multi', '×3', 'help.power.multiBall'],
      ['split', '×2', 'help.power.splitBall'],
      ['wide', 'W', 'help.power.widePaddle'],
      ['sticky', 'AIM', 'help.power.stickyPaddle'],
      ['life', '+1', 'help.power.extraLife']
    ];
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
          h(
            'ul',
            { class: 'help-list' },
            ...bricks.map(([kind, key]) =>
              h(
                'li',
                {},
                h('span', { class: `brick-swatch brick-${kind}`, 'aria-hidden': 'true' }),
                t(key)
              )
            )
          )
        ),
        h(
          'div',
          { class: 'panel' },
          h('h2', { class: 'panel-title' }, t('help.powerups')),
          h(
            'ul',
            { class: 'help-list' },
            ...powers.map(([kind, label, key]) =>
              h(
                'li',
                {},
                h('span', { class: `power-chip power-${kind}`, 'aria-hidden': 'true' }, label),
                t(key)
              )
            )
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
        this.engine.controller?.setSound(this.save.snapshot().preferences.soundEnabled, value);
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
          this.engine.controller?.setSound(value, this.save.snapshot().preferences.volumeSfx);
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
    this.engine.controller?.setSound(!prefs.soundEnabled, prefs.volumeSfx);
    this.rerender();
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
    if (route.mode === 'creative' && !data.creativeLevelSlots[String(route.index)]) {
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
          ref('effects', h('ul', { class: 'effect-list', 'aria-label': t('hud.effects') })),
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
          pauseButton('compact-pause')
        )
      )
    );

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
    setText(r.title, hud.levelName);
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

    const effects = r.effects;
    if (effects) {
      const signature = hud.effects.join(',');
      if (effects.dataset.signature !== signature) {
        effects.dataset.signature = signature;
        clear(effects);
        hud.effects.forEach((effect) => {
          const label = effect === 'widePaddle' ? 'W' : effect === 'stickyPaddle' ? 'AIM' : effect;
          effects.append(
            h(
              'li',
              { class: `power-chip power-${effect === 'widePaddle' ? 'wide' : 'sticky'}` },
              label
            )
          );
        });
      }
    }

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
              this.engine.controller?.setSound(enabled, prefs.volumeSfx);
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
