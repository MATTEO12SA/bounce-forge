import {
  deleteCreation,
  getCreation,
  likedAmong,
  listCreations,
  myCreations,
  myProfile,
  publish,
  setListed,
  setNickname,
  toggleLike
} from '../../community/api';
import {
  forgetPublication,
  hasCommunitySession,
  publicationOf,
  rememberPublication
} from '../../community/published';
import {
  CAMPAIGN_MAX,
  CAMPAIGN_MIN,
  checkPublication,
  DESCRIPTION_MAX,
  PAGE_SIZE,
  TITLE_MAX,
  toCommunityLevel
} from '../../community/rules';
import {
  CommunityError,
  type CommunityErrorCode,
  type CommunityLevel,
  type Creation,
  type CreationSummary,
  type KindFilter,
  type SortKey
} from '../../community/types';
import { estimateDifficulty } from '../../game/levels/levelChecks';
import { createLevelFromPattern } from '../../game/levels/levelFactory';
import type { SaveSystem } from '../../game/systems/SaveSystem';
import { append, clear, h, icon } from '../dom';
import { formatDate, formatNumber, t, type MessageKey } from '../i18n';
import { drawLevelPreview } from '../preview';

/** What the community screens need from the app shell. */
export interface CommunityHost {
  save: SaveSystem;
  toast(message: string): void;
  navigate(hash: string): void;
  openDialog(
    title: string,
    body: HTMLElement[],
    actions: Array<{
      label: string;
      variant: 'primary' | 'secondary' | 'ghost' | 'danger';
      icon?: string;
      action: () => void;
    }>,
    onEscape?: () => void
  ): void;
  closeOverlays(): void;
  confirm(message: string, confirmLabel: string): Promise<boolean>;
  screenHeader(title: string, subtitle: string, extra?: HTMLElement): HTMLElement;
  play(creation: Creation, index: number): void;
}

const SORTS: SortKey[] = ['popular', 'new', 'played', 'easy', 'hard'];
const KINDS: KindFilter[] = ['all', 'level', 'campaign'];

export function errorText(error: unknown): string {
  const code: CommunityErrorCode = error instanceof CommunityError ? error.code : 'unknown';
  return t(`community.error.${code}` as MessageKey);
}

function stars(difficulty: number): string {
  return '★'.repeat(difficulty) + '☆'.repeat(5 - difficulty);
}

function previewCanvas(level: CommunityLevel | null, className = ''): HTMLCanvasElement {
  const canvas = h('canvas', { class: className, 'aria-hidden': 'true' });
  if (level) {
    // Drawn after insertion so the canvas has its real size.
    window.requestAnimationFrame(() =>
      drawLevelPreview(
        canvas,
        createLevelFromPattern({ id: 'community', name: level.name, rows: level.rows }, 0)
      )
    );
  }
  return canvas;
}

/** The public library: filters, sorts, search and creation cards. */
export class LibraryScreen {
  private static state = { sort: 'popular' as SortKey, kind: 'all' as KindFilter, search: '' };
  public readonly element: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly status: HTMLElement;
  private readonly more: HTMLButtonElement;
  private page = 0;
  private searchTimer = 0;
  private request = 0;

  public constructor(private readonly host: CommunityHost) {
    const state = LibraryScreen.state;
    this.grid = h('ul', { class: 'card-grid community-grid', role: 'list' });
    this.status = h('p', { class: 'community-status', role: 'status' });
    this.more = h(
      'button',
      {
        class: 'button button-secondary',
        type: 'button',
        hidden: true,
        onclick: () => void this.load(true)
      },
      t('community.more')
    );
    const search = h('input', {
      class: 'community-search',
      type: 'search',
      placeholder: t('community.search'),
      'aria-label': t('community.search'),
      value: state.search
    });
    search.addEventListener('input', () => {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        state.search = search.value;
        void this.load(false);
      }, 300);
    });
    const pills = <T extends string>(
      values: T[],
      current: () => T,
      set: (value: T) => void,
      prefix: string
    ): HTMLElement => {
      const nav = h('div', { class: 'filter-pills community-pills', role: 'group' });
      const draw = (): void => {
        clear(nav);
        values.forEach((value) =>
          nav.append(
            h(
              'button',
              {
                class: `pill${current() === value ? ' is-active' : ''}`,
                type: 'button',
                'aria-pressed': String(current() === value),
                onclick: () => {
                  set(value);
                  draw();
                  void this.load(false);
                }
              },
              t(`${prefix}.${value}` as MessageKey)
            )
          )
        );
      };
      draw();
      return nav;
    };
    this.element = h(
      'section',
      { class: 'screen community', 'aria-labelledby': 'screen-title' },
      host.screenHeader(
        t('community.title'),
        t('community.subtitle'),
        h(
          'a',
          { class: 'button button-primary', href: '#/create' },
          icon('plus'),
          t('community.create')
        )
      ),
      h(
        'div',
        { class: 'community-toolbar' },
        pills(
          KINDS,
          () => state.kind,
          (value) => (state.kind = value),
          'community.kind'
        ),
        search
      ),
      pills(
        SORTS,
        () => state.sort,
        (value) => (state.sort = value),
        'community.sort'
      ),
      this.status,
      this.grid,
      h('div', { class: 'community-more' }, this.more)
    );
    void this.load(false);
  }

  private async load(append: boolean): Promise<void> {
    const request = ++this.request;
    this.page = append ? this.page + 1 : 0;
    if (!append) {
      clear(this.grid);
      this.status.textContent = t('community.loading');
      this.status.classList.remove('is-error');
    }
    this.more.hidden = true;
    try {
      const items = await listCreations({ ...LibraryScreen.state, page: this.page });
      if (request !== this.request) return;
      this.status.textContent = items.length === 0 && !append ? t('community.empty') : '';
      items.forEach((item) => this.grid.append(this.card(item)));
      this.more.hidden = items.length < PAGE_SIZE;
    } catch (error) {
      if (request !== this.request) return;
      this.status.textContent = errorText(error);
      this.status.classList.add('is-error');
    }
  }

  private card(item: CreationSummary): HTMLElement {
    return h(
      'li',
      {},
      h(
        'a',
        {
          class: `level-card community-card accent-${item.kind === 'campaign' ? 'chain' : 'storm'}`,
          href: `#/community/${item.id}`
        },
        h(
          'div',
          { class: 'card-visual' },
          previewCanvas(item.preview),
          item.kind === 'campaign'
            ? h('span', { class: 'kind-badge' }, t('community.campaignOf', { n: item.levelCount }))
            : null
        ),
        h(
          'div',
          { class: 'card-meta' },
          h(
            'span',
            { class: 'card-text' },
            h('span', { class: 'card-title' }, item.title),
            h('span', { class: 'card-sub' }, t('community.by', { name: item.author })),
            h(
              'span',
              { class: 'community-stats' },
              h(
                'span',
                { class: 'stars', title: t('workshop.difficulty', { n: item.difficulty }) },
                stars(item.difficulty)
              ),
              h('span', { title: t('community.plays') }, `▶ ${formatNumber(item.plays)}`),
              h('span', { title: t('community.likes') }, `♥ ${formatNumber(item.likes)}`)
            )
          )
        )
      )
    );
  }
}

/** One creation: description, levels, play, like, share. */
export class CreationScreen {
  public readonly element: HTMLElement;

  public constructor(
    private readonly host: CommunityHost,
    private readonly id: string
  ) {
    this.element = h(
      'section',
      { class: 'screen community-detail', 'aria-labelledby': 'screen-title' },
      h('p', { class: 'community-status', role: 'status' }, t('community.loading'))
    );
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const creation = await getCreation(this.id);
      const liked = hasCommunitySession()
        ? await likedAmong([creation.id]).catch(() => new Set<string>())
        : new Set<string>();
      this.render(creation, liked.has(creation.id));
    } catch (error) {
      clear(this.element);
      this.element.append(
        h('p', { class: 'community-status is-error', role: 'status' }, errorText(error)),
        h(
          'a',
          { class: 'button button-secondary', href: '#/community' },
          icon('arrowLeft'),
          t('community.back')
        )
      );
    }
  }

  private render(creation: Creation, liked: boolean): void {
    clear(this.element);
    const likeCount = h('span', {}, formatNumber(creation.likes));
    let isLiked = liked;
    const likeButton = h(
      'button',
      {
        class: `button button-secondary${isLiked ? ' is-liked' : ''}`,
        type: 'button',
        'aria-pressed': String(isLiked),
        onclick: async () => {
          likeButton.disabled = true;
          try {
            isLiked = await toggleLike(creation.id);
            creation.likes = Math.max(0, creation.likes + (isLiked ? 1 : -1));
            likeCount.textContent = formatNumber(creation.likes);
            likeButton.classList.toggle('is-liked', isLiked);
            likeButton.setAttribute('aria-pressed', String(isLiked));
          } catch (error) {
            this.host.toast(errorText(error));
          } finally {
            likeButton.disabled = false;
          }
        }
      },
      h('span', { class: 'like-heart', 'aria-hidden': 'true' }, '♥'),
      t('community.like'),
      likeCount
    );
    const copyLink = async (): Promise<void> => {
      const url = `${window.location.origin}${window.location.pathname}#/community/${creation.id}`;
      try {
        await navigator.clipboard.writeText(url);
        this.host.toast(t('community.linkCopied'));
      } catch {
        this.host.toast(url);
      }
    };
    const levels = creation.levels.map((level, index) =>
      h(
        'li',
        {},
        h(
          'button',
          {
            class: 'picker-item community-level',
            type: 'button',
            onclick: () => this.host.play(creation, index)
          },
          previewCanvas(level),
          h('span', {}, `${index + 1}. ${level.name}`)
        )
      )
    );
    append(
      this.element,
      h('a', { class: 'back-link', href: '#/community' }, icon('arrowLeft'), t('community.back')),
      h(
        'div',
        { class: 'community-hero' },
        h('div', { class: 'community-hero-visual' }, previewCanvas(creation.levels[0] ?? null)),
        h(
          'div',
          { class: 'community-hero-body' },
          h(
            'p',
            { class: 'hud-eyebrow' },
            creation.kind === 'campaign'
              ? t('community.campaignOf', { n: creation.levels.length })
              : t('community.kind.level')
          ),
          h('h1', { class: 'screen-title', id: 'screen-title' }, creation.title),
          h(
            'p',
            { class: 'community-author' },
            t('community.by', { name: creation.author }),
            ' · ',
            formatDate(Date.parse(creation.updatedAt))
          ),
          creation.description
            ? h('p', { class: 'community-description' }, creation.description)
            : null,
          h(
            'p',
            { class: 'community-stats is-large' },
            h('span', { class: 'stars' }, stars(creation.difficulty)),
            h('span', {}, `▶ ${t('community.playsCount', { n: formatNumber(creation.plays) })}`)
          ),
          h(
            'div',
            { class: 'community-actions' },
            h(
              'button',
              {
                class: 'button button-primary',
                type: 'button',
                onclick: () => this.host.play(creation, 0)
              },
              icon('play'),
              t('community.play')
            ),
            likeButton,
            h(
              'button',
              { class: 'button button-ghost', type: 'button', onclick: () => void copyLink() },
              icon('share'),
              t('community.copyLink')
            )
          )
        )
      ),
      creation.levels.length > 1
        ? h(
            'div',
            { class: 'panel' },
            h('h2', { class: 'panel-title' }, t('community.levels')),
            h('ul', { class: 'picker-grid', role: 'list' }, ...levels)
          )
        : null
    );
  }
}

// ------------------------------------------------------------------ publishing

async function ensureNickname(host: CommunityHost, field: HTMLInputElement | null): Promise<void> {
  if (!field) return;
  await setNickname(field.value);
  host.save.discover('community:nickname');
}

/**
 * Publish (or update) one saved Workshop level. Asks for a nickname the first time.
 */
export async function openPublishLevel(
  host: CommunityHost,
  slotIndex: number,
  level: { name: string; rows: readonly string[]; options?: unknown }
): Promise<void> {
  let communityLevel: CommunityLevel;
  try {
    communityLevel = toCommunityLevel(level.name, level.rows, level.options);
  } catch (error) {
    host.toast(errorText(error));
    return;
  }
  const previous = publicationOf(slotIndex);
  await openPublishDialog(host, {
    kind: 'level',
    defaultTitle: level.name,
    levels: [communityLevel],
    updateId: previous,
    onPublished: (id) => rememberPublication(slotIndex, id)
  });
}

/** Builds a campaign from saved Workshop levels (2 to 24, in the order they are ticked). */
export function openPublishCampaign(host: CommunityHost): void {
  const slots = Object.values(host.save.snapshot().creativeLevelSlots).sort(
    (a, b) => a.slotIndex - b.slotIndex
  );
  if (slots.length < CAMPAIGN_MIN) {
    host.toast(t('community.campaignNeedsLevels', { n: CAMPAIGN_MIN }));
    return;
  }
  const order: number[] = [];
  const list = h('ul', { class: 'campaign-pick', role: 'list' });
  const draw = (): void => {
    clear(list);
    slots.forEach((slot) => {
      const position = order.indexOf(slot.slotIndex);
      list.append(
        h(
          'li',
          {},
          h(
            'button',
            {
              class: `campaign-pick-item${position >= 0 ? ' is-picked' : ''}`,
              type: 'button',
              'aria-pressed': String(position >= 0),
              onclick: () => {
                if (position >= 0) order.splice(position, 1);
                else if (order.length < CAMPAIGN_MAX) order.push(slot.slotIndex);
                draw();
              }
            },
            h(
              'span',
              { class: 'campaign-pick-number' },
              position >= 0 ? String(position + 1) : '+'
            ),
            slot.name
          )
        )
      );
    });
  };
  draw();
  const title = h('input', {
    type: 'text',
    maxlength: String(TITLE_MAX),
    placeholder: t('community.campaignTitle')
  });
  const description = h('textarea', {
    rows: '3',
    maxlength: String(DESCRIPTION_MAX),
    placeholder: t('community.description')
  });
  const nicknameField = h('input', {
    type: 'text',
    maxlength: '20',
    placeholder: t('community.nickname'),
    hidden: true
  });
  void myProfile()
    .then((profile) => {
      nicknameField.hidden = profile !== null;
    })
    .catch(() => {
      nicknameField.hidden = false;
    });
  host.openDialog(
    t('community.publishCampaign'),
    [
      h('p', {}, t('community.campaignHelp', { min: CAMPAIGN_MIN, max: CAMPAIGN_MAX })),
      list,
      title,
      description,
      nicknameField
    ],
    [
      { label: t('common.cancel'), variant: 'ghost', action: () => host.closeOverlays() },
      {
        label: t('community.publish'),
        variant: 'primary',
        icon: 'share',
        action: () => {
          const levels = order.map((slotIndex) => {
            const slot = slots.find((item) => item.slotIndex === slotIndex)!;
            return toCommunityLevel(slot.name, slot.rows, slot.options);
          });
          void submit(host, {
            kind: 'campaign',
            title: title.value,
            description: description.value,
            levels,
            nicknameField: nicknameField.hidden ? null : nicknameField
          });
        }
      }
    ],
    () => host.closeOverlays()
  );
}

async function openPublishDialog(
  host: CommunityHost,
  options: {
    kind: 'level' | 'campaign';
    defaultTitle: string;
    levels: CommunityLevel[];
    updateId?: string;
    onPublished: (id: string) => void;
  }
): Promise<void> {
  let profile: Awaited<ReturnType<typeof myProfile>>;
  try {
    profile = await myProfile();
  } catch (error) {
    host.toast(errorText(error));
    return;
  }
  const title = h('input', {
    type: 'text',
    maxlength: String(TITLE_MAX),
    value: options.defaultTitle,
    'aria-label': t('community.titleLabel')
  });
  const description = h('textarea', {
    rows: '3',
    maxlength: String(DESCRIPTION_MAX),
    placeholder: t('community.description'),
    'aria-label': t('community.description')
  });
  const nicknameField = profile
    ? null
    : h('input', {
        type: 'text',
        maxlength: '20',
        placeholder: t('community.nickname'),
        'aria-label': t('community.nickname')
      });
  const send = (asNew: boolean): void => {
    void submit(host, {
      kind: options.kind,
      title: title.value,
      description: description.value,
      levels: options.levels,
      nicknameField,
      updateId: asNew ? undefined : options.updateId,
      onPublished: options.onPublished
    });
  };
  host.openDialog(
    options.updateId ? t('community.updateTitle') : t('community.publishTitle'),
    [
      h(
        'p',
        {},
        profile ? t('community.publishAs', { name: profile.nickname }) : t('community.nicknameHelp')
      ),
      ...(nicknameField ? [nicknameField] : []),
      title,
      description,
      h('p', { class: 'result-hint' }, t('community.rulesHint'))
    ],
    [
      { label: t('common.cancel'), variant: 'ghost', action: () => host.closeOverlays() },
      ...(options.updateId
        ? [
            {
              label: t('community.publishNew'),
              variant: 'secondary' as const,
              action: () => send(true)
            }
          ]
        : []),
      {
        label: options.updateId ? t('community.update') : t('community.publish'),
        variant: 'primary',
        icon: 'share',
        action: () => send(false)
      }
    ],
    () => host.closeOverlays()
  );
}

async function submit(
  host: CommunityHost,
  input: {
    kind: 'level' | 'campaign';
    title: string;
    description: string;
    levels: CommunityLevel[];
    nicknameField: HTMLInputElement | null;
    updateId?: string;
    onPublished?: (id: string) => void;
  }
): Promise<void> {
  const problem = checkPublication(input);
  if (problem) {
    host.toast(t(`community.error.${problem}` as MessageKey));
    return;
  }
  try {
    await ensureNickname(host, input.nicknameField);
    const difficulty = Math.round(
      input.levels.reduce((sum, level) => sum + estimateDifficulty(level.rows, level.options), 0) /
        input.levels.length
    );
    const id = await publish({ ...input, difficulty, id: input.updateId });
    input.onPublished?.(id);
    host.closeOverlays();
    host.toast(input.updateId ? t('community.updated') : t('community.published'));
    host.navigate(`#/community/${id}`);
  } catch (error) {
    host.toast(errorText(error));
  }
}

/** "My publications" panel of the Workshop (loaded only once the player has published). */
export function myPublicationsPanel(host: CommunityHost): HTMLElement | null {
  if (!hasCommunitySession()) return null;
  const list = h(
    'ul',
    { class: 'my-publications', role: 'list' },
    h('li', { class: 'community-status' }, t('community.loading'))
  );
  const panel = h(
    'div',
    { class: 'panel' },
    h('h2', { class: 'panel-title' }, t('community.mine')),
    list
  );
  const render = (items: CreationSummary[]): void => {
    clear(list);
    if (items.length === 0) {
      list.append(h('li', { class: 'community-status' }, t('community.mineEmpty')));
      return;
    }
    items.forEach((item) => {
      const listed = item.status === 'published';
      list.append(
        h(
          'li',
          { class: 'my-publication' },
          h(
            'div',
            { class: 'my-publication-text' },
            h('a', { class: 'card-title', href: `#/community/${item.id}` }, item.title),
            h(
              'span',
              { class: 'card-sub' },
              `${t(`community.status.${item.status}` as MessageKey)} · ▶ ${formatNumber(item.plays)} · ♥ ${formatNumber(item.likes)}`
            )
          ),
          item.status === 'published' || item.status === 'unlisted'
            ? h(
                'button',
                {
                  class: 'button button-ghost button-sm',
                  type: 'button',
                  onclick: async () => {
                    try {
                      await setListed(item.id, !listed);
                      item.status = listed ? 'unlisted' : 'published';
                      render(items);
                    } catch (error) {
                      host.toast(errorText(error));
                    }
                  }
                },
                listed ? t('community.hide') : t('community.show')
              )
            : null,
          h(
            'button',
            {
              class: 'icon-button icon-button-danger',
              type: 'button',
              title: t('create.delete'),
              'aria-label': `${t('create.delete')} — ${item.title}`,
              onclick: async () => {
                if (
                  !(await host.confirm(
                    t('community.deleteConfirm', { name: item.title }),
                    t('create.delete')
                  ))
                )
                  return;
                try {
                  await deleteCreation(item.id);
                  forgetPublication(item.id);
                  render(items.filter((other) => other.id !== item.id));
                } catch (error) {
                  host.toast(errorText(error));
                }
              }
            },
            icon('trash')
          )
        )
      );
    });
  };
  myCreations()
    .then(render)
    .catch((error: unknown) => {
      clear(list);
      list.append(h('li', { class: 'community-status is-error' }, errorText(error)));
    });
  return panel;
}
