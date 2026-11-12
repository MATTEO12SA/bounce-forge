import { currentUserId, myProfile, setNickname } from '../../community/api';
import {
  appealCreation,
  APPEAL_MAX,
  castVote,
  DETAILS_MAX,
  myModeration,
  myReports,
  REPORT_REASONS,
  reportCreation,
  reviewQueue
} from '../../community/moderation';
import { hasCommunitySession } from '../../community/published';
import type {
  Appeal,
  Creation,
  CreationSummary,
  ReportReason,
  ReviewItem
} from '../../community/types';
import { append, clear, h, icon } from '../dom';
import { formatDate, t, type MessageKey } from '../i18n';
import { errorText, previewCanvas, type CommunityHost } from './CommunityUi';

/**
 * Player side of moderation: report dialog, community review page, rules page and appeals.
 */

// ------------------------------------------------------------------ report

/**
 * "Report" button of a creation page. Hidden on the player's own creations, disabled once the
 * player has reported it.
 */
export function reportButton(host: CommunityHost, creation: Creation): HTMLButtonElement {
  const button = h(
    'button',
    {
      class: 'button button-ghost report-button',
      type: 'button',
      onclick: () => openReportDialog(host, creation, () => markReported())
    },
    icon('flag'),
    t('moderation.report')
  );
  const markReported = (): void => {
    button.disabled = true;
    clear(button);
    append(button, icon('flag'), t('moderation.reported'));
  };
  if (hasCommunitySession()) {
    void Promise.all([currentUserId(), myReports().catch(() => new Set<string>())]).then(
      ([me, reported]) => {
        if (me && me === creation.authorId) button.hidden = true;
        else if (reported.has(creation.id)) markReported();
      }
    );
  }
  return button;
}

export async function openReportDialog(
  host: CommunityHost,
  creation: Creation,
  onReported: () => void
): Promise<void> {
  let hasProfile: boolean;
  try {
    hasProfile = (await myProfile()) !== null;
  } catch (error) {
    host.toast(errorText(error));
    return;
  }
  let reason: ReportReason | null = null;
  const reasons = h('div', { class: 'report-reasons', role: 'radiogroup' });
  const drawReasons = (): void => {
    clear(reasons);
    REPORT_REASONS.forEach((value) =>
      reasons.append(
        h(
          'button',
          {
            class: `pill${reason === value ? ' is-active' : ''}`,
            type: 'button',
            role: 'radio',
            'aria-checked': String(reason === value),
            onclick: () => {
              reason = value;
              drawReasons();
            }
          },
          t(`moderation.reason.${value}` as MessageKey)
        )
      )
    );
  };
  drawReasons();
  const details = h('textarea', {
    rows: '3',
    maxlength: String(DETAILS_MAX),
    placeholder: t('moderation.details'),
    'aria-label': t('moderation.details')
  });
  const nickname = hasProfile
    ? null
    : h('input', {
        type: 'text',
        maxlength: '20',
        placeholder: t('community.nickname'),
        'aria-label': t('community.nickname')
      });
  host.openDialog(
    t('moderation.reportTitle', { name: creation.title }),
    [
      h('p', {}, t('moderation.reportHelp')),
      reasons,
      details,
      ...(nickname
        ? [h('p', { class: 'result-hint' }, t('moderation.nicknameNeeded')), nickname]
        : []),
      h(
        'p',
        { class: 'result-hint' },
        h(
          'a',
          { href: '#/community/rules', onclick: () => host.closeOverlays() },
          t('moderation.rulesLink')
        )
      )
    ],
    [
      { label: t('common.cancel'), variant: 'ghost', action: () => host.closeOverlays() },
      {
        label: t('moderation.send'),
        variant: 'danger',
        icon: 'flag',
        action: () => {
          if (!reason) {
            host.toast(t('moderation.pickReason'));
            return;
          }
          const chosen = reason;
          void (async () => {
            try {
              if (nickname) await setNickname(nickname.value);
              const status = await reportCreation(creation.id, chosen, details.value);
              host.closeOverlays();
              onReported();
              host.toast(status === 'review' ? t('moderation.sentReview') : t('moderation.sent'));
            } catch (error) {
              host.toast(errorText(error));
            }
          })();
        }
      }
    ],
    () => host.closeOverlays()
  );
}

// ------------------------------------------------------------------ community review

/** Library shortcut to the rules and (for trusted players) the review queue. */
export function moderationLinks(): HTMLElement {
  const review = h(
    'a',
    { class: 'button button-ghost button-sm', href: '#/community/review' },
    icon('shield'),
    t('moderation.reviewLink')
  );
  if (hasCommunitySession()) {
    void myModeration()
      .then((status) => {
        if (status.canReview && status.toReview > 0) {
          review.append(h('span', { class: 'count-badge' }, String(status.toReview)));
        }
      })
      .catch(() => undefined);
  }
  return h(
    'div',
    { class: 'moderation-links' },
    h(
      'a',
      { class: 'button button-ghost button-sm', href: '#/community/rules' },
      icon('help'),
      t('moderation.rulesLink')
    ),
    review
  );
}

/** Creations reported by players, waiting for trusted players' votes. */
export class ReviewScreen {
  public readonly element: HTMLElement;
  private readonly body: HTMLElement;

  public constructor(private readonly host: CommunityHost) {
    this.body = h('div', { class: 'review-body' });
    this.element = h(
      'section',
      { class: 'screen community', 'aria-labelledby': 'screen-title' },
      h('a', { class: 'back-link', href: '#/community' }, icon('arrowLeft'), t('community.back')),
      host.screenHeader(t('moderation.reviewTitle'), t('moderation.reviewSubtitle')),
      this.body
    );
    void this.load();
  }

  private status(text: string, error = false): HTMLElement {
    return h('p', { class: `community-status${error ? ' is-error' : ''}`, role: 'status' }, text);
  }

  private async load(): Promise<void> {
    clear(this.body);
    this.body.append(this.status(t('community.loading')));
    try {
      const me = await myModeration();
      clear(this.body);
      if (!me.canReview) {
        this.body.append(this.requirements(me.profile, me.trust));
        return;
      }
      const items = await reviewQueue();
      clear(this.body);
      if (items.length === 0) {
        this.body.append(this.status(t('moderation.queueEmpty')));
        return;
      }
      const list = h('ul', { class: 'review-list', role: 'list' });
      items.forEach((item) => list.append(this.card(item, list)));
      this.body.append(h('p', { class: 'result-hint' }, t('moderation.reviewHelp')), list);
    } catch (error) {
      clear(this.body);
      this.body.append(this.status(errorText(error), true));
    }
  }

  private requirements(profile: boolean, trust: number): HTMLElement {
    const items: MessageKey[] = [
      'moderation.need.nickname',
      'moderation.need.age',
      'moderation.need.plays',
      'moderation.need.trust'
    ];
    return h(
      'div',
      { class: 'panel' },
      h('h2', { class: 'panel-title' }, t('moderation.notYet')),
      h('ul', { class: 'rules-list' }, ...items.map((key) => h('li', {}, t(key)))),
      !profile ? h('p', { class: 'result-hint' }, t('moderation.needProfile')) : null,
      trust < 0 ? h('p', { class: 'result-hint' }, t('moderation.lowTrust')) : null
    );
  }

  private card(item: ReviewItem, list: HTMLElement): HTMLElement {
    const reasons = Object.entries(item.reasons).map(([reason, count]) =>
      h(
        'span',
        { class: 'reason-chip' },
        `${t(`moderation.reason.${reason}` as MessageKey)} × ${count}`
      )
    );
    const buttons: HTMLButtonElement[] = [];
    const vote = async (keep: boolean, card: HTMLElement): Promise<void> => {
      buttons.forEach((button) => (button.disabled = true));
      try {
        const result = await castVote(item.id, keep);
        this.host.toast(t(`moderation.voted.${result}` as MessageKey));
        card.remove();
        if (!list.firstChild) {
          clear(this.body);
          this.body.append(this.status(t('moderation.queueEmpty')));
        }
      } catch (error) {
        this.host.toast(errorText(error));
        buttons.forEach((button) => (button.disabled = false));
      }
    };
    const card: HTMLElement = h(
      'li',
      { class: 'review-card panel' },
      h('div', { class: 'review-visual' }, previewCanvas(item.levels[0] ?? null)),
      h(
        'div',
        { class: 'review-text' },
        h('h2', { class: 'panel-title' }, item.title),
        h(
          'p',
          { class: 'card-sub' },
          t('community.by', { name: item.author }),
          item.kind === 'campaign'
            ? ` · ${t('community.campaignOf', { n: item.levels.length })}`
            : ''
        ),
        item.description ? h('p', { class: 'community-description' }, item.description) : null,
        h('div', { class: 'reason-chips' }, ...reasons),
        ...item.details.map((text) => h('blockquote', { class: 'report-detail' }, text)),
        h('p', { class: 'result-hint' }, t('moderation.votesSoFar', { n: item.votes })),
        h(
          'div',
          { class: 'community-actions' },
          h(
            'button',
            {
              class: 'button button-secondary',
              type: 'button',
              onclick: () => this.host.play(item, 0, '#/community/review')
            },
            icon('play'),
            t('community.play')
          ),
          (buttons[0] = h(
            'button',
            {
              class: 'button button-primary',
              type: 'button',
              onclick: () => void vote(true, card)
            },
            t('moderation.keep')
          )),
          (buttons[1] = h(
            'button',
            {
              class: 'button button-danger',
              type: 'button',
              onclick: () => void vote(false, card)
            },
            t('moderation.remove')
          ))
        )
      )
    );
    return card;
  }
}

// ------------------------------------------------------------------ rules

export function rulesScreen(host: CommunityHost): HTMLElement {
  const section = (title: MessageKey, keys: MessageKey[]): HTMLElement =>
    h(
      'div',
      { class: 'panel' },
      h('h2', { class: 'panel-title' }, t(title)),
      h('ul', { class: 'rules-list' }, ...keys.map((key) => h('li', {}, t(key))))
    );
  return h(
    'section',
    { class: 'screen community', 'aria-labelledby': 'screen-title' },
    h('a', { class: 'back-link', href: '#/community' }, icon('arrowLeft'), t('community.back')),
    host.screenHeader(t('rules.title'), t('rules.subtitle')),
    h(
      'div',
      { class: 'rules-grid' },
      section('rules.do', ['rules.do.1', 'rules.do.2', 'rules.do.3']),
      section('rules.dont', ['rules.dont.1', 'rules.dont.2', 'rules.dont.3', 'rules.dont.4']),
      section('rules.auto', ['rules.auto.1', 'rules.auto.2', 'rules.auto.3']),
      section('rules.reports', ['rules.reports.1', 'rules.reports.2', 'rules.reports.3']),
      section('rules.sanctions', ['rules.sanctions.1', 'rules.sanctions.2', 'rules.sanctions.3']),
      section('rules.appeal', ['rules.appeal.1', 'rules.appeal.2'])
    )
  );
}

// ------------------------------------------------------------------ appeals

/** Status line and "Appeal" button for a removed creation in "My publications". */
export function appealControl(
  host: CommunityHost,
  item: CreationSummary,
  appeal: Appeal | undefined,
  onChange: () => void
): HTMLElement | null {
  if (item.status !== 'removed') return null;
  if (appeal) {
    return h(
      'span',
      { class: `appeal-status is-${appeal.status}`, title: appeal.note || undefined },
      t(`moderation.appeal.${appeal.status}` as MessageKey)
    );
  }
  return h(
    'button',
    {
      class: 'button button-ghost button-sm',
      type: 'button',
      onclick: () => {
        const message = h('textarea', {
          rows: '4',
          maxlength: String(APPEAL_MAX),
          placeholder: t('moderation.appealPlaceholder'),
          'aria-label': t('moderation.appealPlaceholder')
        });
        host.openDialog(
          t('moderation.appealTitle', { name: item.title }),
          [h('p', {}, t('moderation.appealHelp')), message],
          [
            { label: t('common.cancel'), variant: 'ghost', action: () => host.closeOverlays() },
            {
              label: t('moderation.appealSend'),
              variant: 'primary',
              action: () =>
                void appealCreation(item.id, message.value)
                  .then(() => {
                    host.closeOverlays();
                    host.toast(t('moderation.appealSent'));
                    onChange();
                  })
                  .catch((error: unknown) => host.toast(errorText(error)))
            }
          ],
          () => host.closeOverlays()
        );
      }
    },
    t('moderation.appealButton')
  );
}

/** Warning shown above "My publications" when the player has strikes or a publishing ban. */
export function sanctionNotice(): HTMLElement {
  const notice = h('p', { class: 'sanction-notice', hidden: true, role: 'status' });
  if (hasCommunitySession()) {
    void myModeration()
      .then((status) => {
        const banned = status.bannedUntil && Date.parse(status.bannedUntil) > Date.now();
        if (banned) {
          notice.textContent = t('moderation.bannedUntil', {
            date: formatDate(Date.parse(status.bannedUntil!))
          });
        } else if (status.strikes > 0) {
          notice.textContent = t('moderation.strikes', { n: status.strikes });
        } else {
          return;
        }
        notice.hidden = false;
      })
      .catch(() => undefined);
  }
  return notice;
}
