import {
  ADMIN_FILTERS,
  adminCreations,
  adminGetCreation,
  adminLog,
  adminModerate,
  adminOverview,
  adminPlayerAction,
  adminPlayers,
  adminSession,
  adminSignIn,
  adminSignOut,
  type AdminAction,
  type AdminCreation,
  type AdminFilter,
  type AdminPlayer,
  type PlayerAction
} from '../../community/admin';
import { append, clear, h, icon } from '../dom';
import { formatDate, formatNumber, t, type MessageKey } from '../i18n';
import { errorText, previewCanvas, type CommunityHost } from './CommunityUi';

/**
 * Admin panel (#/community/admin): sign-in with the admin's e-mail account, then every
 * moderation power — review and appeal decisions, restore / remove / delete any creation,
 * sanctions on players and the moderation log.
 */

type Tab = 'creations' | 'players' | 'log';

function dateText(value: string | null): string {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? formatDate(time) : '—';
}

function isBanned(until: string | null): boolean {
  return Boolean(until && Date.parse(until) > Date.now());
}

export class AdminScreen {
  private static state = {
    tab: 'creations' as Tab,
    filter: 'attention' as AdminFilter,
    search: ''
  };
  public readonly element: HTMLElement;
  private readonly body: HTMLElement;

  public constructor(private readonly host: CommunityHost) {
    this.body = h('div', { class: 'admin-body' });
    this.element = h(
      'section',
      { class: 'screen community admin', 'aria-labelledby': 'screen-title' },
      h('a', { class: 'back-link', href: '#/community' }, icon('arrowLeft'), t('community.back')),
      host.screenHeader(t('admin.title'), t('admin.subtitle')),
      this.body
    );
    void this.start();
  }

  private status(text: string, error = false): HTMLElement {
    return h('p', { class: `community-status${error ? ' is-error' : ''}`, role: 'status' }, text);
  }

  private async start(): Promise<void> {
    clear(this.body);
    this.body.append(this.status(t('community.loading')));
    try {
      const session = await adminSession();
      clear(this.body);
      if (!session) this.body.append(this.loginForm());
      else if (!session.isAdmin) this.body.append(this.notAdmin(session.email));
      else this.body.append(this.dashboard(session.email));
    } catch (error) {
      clear(this.body);
      this.body.append(this.status(errorText(error), true));
    }
  }

  private loginForm(): HTMLElement {
    const email = h('input', {
      type: 'email',
      autocomplete: 'username',
      required: true,
      placeholder: t('admin.email'),
      'aria-label': t('admin.email')
    });
    const password = h('input', {
      type: 'password',
      autocomplete: 'current-password',
      required: true,
      placeholder: t('admin.password'),
      'aria-label': t('admin.password')
    });
    const message = this.status('');
    const submit = h(
      'button',
      { class: 'button button-primary', type: 'submit' },
      icon('lock'),
      t('admin.signIn')
    );
    const form = h(
      'form',
      { class: 'panel admin-login' },
      h('h2', { class: 'panel-title' }, t('admin.signInTitle')),
      h('p', { class: 'result-hint' }, t('admin.signInHelp')),
      email,
      password,
      submit,
      message
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit.disabled = true;
      message.classList.remove('is-error');
      message.textContent = t('community.loading');
      void adminSignIn(email.value, password.value)
        .then(() => {
          password.value = '';
          return this.start();
        })
        .catch((error: unknown) => {
          message.textContent = errorText(error);
          message.classList.add('is-error');
          submit.disabled = false;
        });
    });
    return form;
  }

  private signOutButton(): HTMLButtonElement {
    return h(
      'button',
      {
        class: 'button button-ghost button-sm',
        type: 'button',
        onclick: () => void adminSignOut().finally(() => void this.start())
      },
      t('admin.signOut')
    );
  }

  private notAdmin(email: string): HTMLElement {
    return h(
      'div',
      { class: 'panel' },
      h('p', {}, t('admin.notAdmin', { email })),
      this.signOutButton()
    );
  }

  private dashboard(email: string): HTMLElement {
    const state = AdminScreen.state;
    const overview = h('div', { class: 'admin-overview' });
    const content = h('div', { class: 'admin-content' });
    const tabs = h('div', { class: 'filter-pills community-pills', role: 'tablist' });
    const refreshOverview = (): void => {
      void adminOverview()
        .then((counts) => {
          clear(overview);
          (Object.keys(counts) as Array<keyof typeof counts>).forEach((key) =>
            overview.append(
              h(
                'div',
                {
                  class: `admin-tile${counts[key] > 0 && ['review', 'team', 'appeals', 'reported'].includes(key) ? ' is-hot' : ''}`
                },
                h('span', { class: 'admin-tile-value' }, formatNumber(counts[key])),
                h('span', { class: 'admin-tile-label' }, t(`admin.count.${key}` as MessageKey))
              )
            )
          );
        })
        .catch((error: unknown) => {
          clear(overview);
          overview.append(this.status(errorText(error), true));
        });
    };
    const show = (): void => {
      clear(tabs);
      (['creations', 'players', 'log'] as Tab[]).forEach((tab) =>
        tabs.append(
          h(
            'button',
            {
              class: `pill${state.tab === tab ? ' is-active' : ''}`,
              type: 'button',
              role: 'tab',
              'aria-selected': String(state.tab === tab),
              onclick: () => {
                state.tab = tab;
                show();
              }
            },
            t(`admin.tab.${tab}` as MessageKey)
          )
        )
      );
      clear(content);
      if (state.tab === 'creations') content.append(this.creationsTab(refreshOverview));
      else if (state.tab === 'players') content.append(this.playersTab(refreshOverview));
      else content.append(this.logTab());
    };
    refreshOverview();
    show();
    return h(
      'div',
      {},
      h('p', { class: 'admin-signed' }, t('admin.signedIn', { email }), ' ', this.signOutButton()),
      overview,
      tabs,
      content
    );
  }

  // ---------------------------------------------------------------- creations

  private creationsTab(onChange: () => void): HTMLElement {
    const state = AdminScreen.state;
    const list = h('ul', { class: 'admin-list', role: 'list' });
    const filters = h('div', { class: 'filter-pills community-pills' });
    let request = 0;
    const load = async (): Promise<void> => {
      const current = ++request;
      clear(list);
      list.append(h('li', {}, this.status(t('community.loading'))));
      try {
        const items = await adminCreations(state.filter, state.search);
        if (current !== request) return;
        clear(list);
        if (items.length === 0) list.append(h('li', {}, this.status(t('admin.nothing'))));
        items.forEach((item) =>
          list.append(
            this.creationCard(item, () => {
              onChange();
              void load();
            })
          )
        );
      } catch (error) {
        if (current !== request) return;
        clear(list);
        list.append(h('li', {}, this.status(errorText(error), true)));
      }
    };
    const drawFilters = (): void => {
      clear(filters);
      ADMIN_FILTERS.forEach((filter) =>
        filters.append(
          h(
            'button',
            {
              class: `pill${state.filter === filter ? ' is-active' : ''}`,
              type: 'button',
              'aria-pressed': String(state.filter === filter),
              onclick: () => {
                state.filter = filter;
                drawFilters();
                void load();
              }
            },
            t(`admin.filter.${filter}` as MessageKey)
          )
        )
      );
    };
    drawFilters();
    void load();
    return h(
      'div',
      {},
      filters,
      this.searchField(state.search, (value) => {
        state.search = value;
        void load();
      }),
      list
    );
  }

  private searchField(value: string, onSearch: (value: string) => void): HTMLInputElement {
    const field = h('input', {
      class: 'community-search admin-search',
      type: 'search',
      value,
      placeholder: t('admin.search'),
      'aria-label': t('admin.search')
    });
    let timer = 0;
    field.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => onSearch(field.value), 300);
    });
    return field;
  }

  private creationCard(item: AdminCreation, onChange: () => void): HTMLElement {
    const note = h('input', {
      type: 'text',
      maxlength: '300',
      placeholder: t('admin.note'),
      'aria-label': t('admin.note')
    });
    const buttons: HTMLButtonElement[] = [];
    const act = async (action: AdminAction): Promise<void> => {
      if (
        action === 'delete' &&
        !(await this.host.confirm(
          t('admin.deleteConfirm', { name: item.title }),
          t('create.delete')
        ))
      ) {
        return;
      }
      buttons.forEach((button) => (button.disabled = true));
      try {
        await adminModerate(item.id, action, note.value);
        this.host.toast(t(`admin.done.${action}` as MessageKey));
        onChange();
      } catch (error) {
        this.host.toast(errorText(error));
        buttons.forEach((button) => (button.disabled = false));
      }
    };
    const play = async (): Promise<void> => {
      try {
        this.host.play(await adminGetCreation(item.id), 0, '#/community/admin');
      } catch (error) {
        this.host.toast(errorText(error));
      }
    };
    const button = (
      label: string,
      variant: string,
      action: () => void,
      iconName?: string
    ): HTMLButtonElement => {
      const element = h(
        'button',
        { class: `button button-${variant} button-sm`, type: 'button', onclick: action },
        iconName ? icon(iconName) : null,
        label
      );
      buttons.push(element);
      return element;
    };
    const statusLabel = item.teamReview
      ? t('admin.status.team')
      : t(`community.status.${item.status}` as MessageKey);
    const pendingReports = item.reports.filter((report) => !report.outcome);
    return h(
      'li',
      { class: `admin-card panel is-${item.teamReview ? 'team' : item.status}` },
      h('div', { class: 'review-visual' }, previewCanvas(item.preview)),
      h(
        'div',
        { class: 'review-text' },
        h(
          'div',
          { class: 'admin-card-head' },
          h('h2', { class: 'panel-title' }, item.title),
          h('span', { class: 'status-chip' }, statusLabel)
        ),
        h(
          'p',
          { class: 'card-sub' },
          item.kind === 'campaign' ? `${t('community.campaignOf', { n: item.levelCount })} · ` : '',
          `▶ ${formatNumber(item.plays)} · ♥ ${formatNumber(item.likes)} · ${dateText(item.updatedAt)}`
        ),
        h(
          'p',
          { class: 'card-sub' },
          t('admin.author', {
            name: item.author.nickname,
            trust: item.author.trust,
            strikes: item.author.strikes
          }),
          isBanned(item.author.bannedUntil)
            ? ` · ${t('admin.bannedUntil', { date: dateText(item.author.bannedUntil) })}`
            : ''
        ),
        item.description ? h('p', { class: 'community-description' }, item.description) : null,
        item.status === 'review' || item.votes.keep + item.votes.remove > 0
          ? h(
              'p',
              { class: 'result-hint' },
              t('admin.votes', { keep: item.votes.keep, remove: item.votes.remove })
            )
          : null,
        item.reports.length > 0
          ? h(
              'details',
              { class: 'admin-reports', open: pendingReports.length > 0 },
              h(
                'summary',
                {},
                t('admin.reports', { n: item.reports.length, pending: pendingReports.length })
              ),
              h(
                'ul',
                {},
                ...item.reports.map((report) =>
                  h(
                    'li',
                    {},
                    h('strong', {}, t(`moderation.reason.${report.reason}` as MessageKey)),
                    ` — ${report.by} · ${dateText(report.at)}`,
                    report.outcome
                      ? ` · ${t(`admin.outcome.${report.outcome}` as MessageKey)}`
                      : '',
                    report.details
                      ? h('blockquote', { class: 'report-detail' }, report.details)
                      : null
                  )
                )
              )
            )
          : null,
        item.appeal
          ? h(
              'div',
              { class: 'admin-appeal' },
              h(
                'strong',
                {},
                `${t('admin.appeal')} · ${t(`moderation.appeal.${item.appeal.status}` as MessageKey)}`
              ),
              item.appeal.message
                ? h('blockquote', { class: 'report-detail' }, item.appeal.message)
                : null
            )
          : null,
        note,
        h(
          'div',
          { class: 'community-actions' },
          button(t('community.play'), 'secondary', () => void play(), 'play'),
          item.status !== 'published'
            ? button(
                item.appeal?.status === 'pending' ? t('admin.acceptAppeal') : t('admin.restore'),
                'primary',
                () => void act('keep')
              )
            : pendingReports.length > 0
              ? button(t('admin.dismiss'), 'primary', () => void act('keep'))
              : null,
          item.status !== 'removed'
            ? button(t('moderation.remove'), 'danger', () => void act('remove'))
            : item.appeal?.status === 'pending'
              ? button(t('admin.rejectAppeal'), 'danger', () => void act('remove'))
              : null,
          button(t('create.delete'), 'ghost', () => void act('delete'), 'trash')
        )
      )
    );
  }

  // ---------------------------------------------------------------- players

  private playersTab(onChange: () => void): HTMLElement {
    const state = AdminScreen.state;
    const list = h('ul', { class: 'admin-list', role: 'list' });
    let request = 0;
    const load = async (): Promise<void> => {
      const current = ++request;
      clear(list);
      list.append(h('li', {}, this.status(t('community.loading'))));
      try {
        const players = await adminPlayers(state.search);
        if (current !== request) return;
        clear(list);
        if (players.length === 0) list.append(h('li', {}, this.status(t('admin.nothing'))));
        players.forEach((player) =>
          list.append(
            this.playerRow(player, () => {
              onChange();
              void load();
            })
          )
        );
      } catch (error) {
        if (current !== request) return;
        clear(list);
        list.append(h('li', {}, this.status(errorText(error), true)));
      }
    };
    void load();
    return h(
      'div',
      {},
      this.searchField(state.search, (value) => {
        state.search = value;
        void load();
      }),
      list
    );
  }

  private playerRow(player: AdminPlayer, onChange: () => void): HTMLElement {
    const act = async (action: PlayerAction, days = 0): Promise<void> => {
      if (
        action === 'delete' &&
        !(await this.host.confirm(
          t('admin.deletePlayerConfirm', { name: player.nickname }),
          t('create.delete')
        ))
      ) {
        return;
      }
      try {
        await adminPlayerAction(player.id, action, days);
        this.host.toast(t('admin.done.player'));
        onChange();
      } catch (error) {
        this.host.toast(errorText(error));
      }
    };
    const small = (label: string, action: () => void, variant = 'ghost'): HTMLButtonElement =>
      h(
        'button',
        { class: `button button-${variant} button-sm`, type: 'button', onclick: action },
        label
      );
    const banned = isBanned(player.bannedUntil);
    const row = h(
      'li',
      { class: `admin-player${banned ? ' is-banned' : ''}` },
      h(
        'div',
        { class: 'my-publication-text' },
        h('span', { class: 'card-title' }, player.nickname),
        h(
          'span',
          { class: 'card-sub' },
          t('admin.playerStats', {
            trust: player.trust,
            strikes: player.strikes,
            creations: player.creations,
            reports: player.reports,
            rejected: player.reportsRejected
          }),
          ` · ${dateText(player.createdAt)}`,
          banned ? ` · ${t('admin.bannedUntil', { date: dateText(player.bannedUntil) })}` : ''
        )
      )
    );
    append(
      row,
      h(
        'div',
        { class: 'admin-player-actions' },
        banned
          ? small(t('admin.unban'), () => void act('unban'), 'secondary')
          : small(t('admin.ban7'), () => void act('ban', 7), 'secondary'),
        banned ? null : small(t('admin.ban30'), () => void act('ban', 30), 'secondary'),
        player.strikes > 0 ? small(t('admin.resetStrikes'), () => void act('reset_strikes')) : null,
        player.trust !== 0 ? small(t('admin.resetTrust'), () => void act('reset_trust')) : null,
        small(t('admin.rename'), () => void act('rename')),
        small(t('create.delete'), () => void act('delete'), 'danger')
      )
    );
    return row;
  }

  // ---------------------------------------------------------------- log

  private logTab(): HTMLElement {
    const list = h(
      'ul',
      { class: 'admin-log', role: 'list' },
      h('li', {}, this.status(t('community.loading')))
    );
    void adminLog()
      .then((entries) => {
        clear(list);
        if (entries.length === 0) list.append(h('li', {}, this.status(t('admin.nothing'))));
        entries.forEach((entry) =>
          list.append(
            h(
              'li',
              {},
              h('span', { class: 'admin-log-date' }, dateText(entry.at)),
              h('strong', {}, t(`admin.log.${entry.action}` as MessageKey)),
              ` ${entry.title}`,
              h(
                'span',
                { class: 'card-sub' },
                ` · ${t(`admin.actor.${entry.actor}` as MessageKey)}`
              ),
              entry.note ? h('span', { class: 'card-sub' }, ` — ${entry.note}`) : null
            )
          )
        );
      })
      .catch((error: unknown) => {
        clear(list);
        list.append(h('li', {}, this.status(errorText(error), true)));
      });
    return list;
  }
}
