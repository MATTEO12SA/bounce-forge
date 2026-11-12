import { adminNow, adminStatus, onAdminChange } from '../../community/adminState';
import type { AdminCommand } from '../../game/bridge';
import { POWER_UP_TYPES, POWER_UPS } from '../../game/config/powerUps';
import { clear, h, icon } from '../dom';
import { t, type MessageKey } from '../i18n';

/**
 * Admin tools outside the admin page: the sign-in block of the settings screen and the cheat
 * panel of the pause menu. supabase-js is only loaded once the admin actually signs in.
 */

/** "Administration" block of the settings screen. */
export function adminSettingsPanel(): HTMLElement {
  const panel = h('div', { class: 'setting admin-settings' });
  let formOpen = false;
  const draw = (): void => {
    clear(panel);
    panel.append(h('span', { class: 'setting-label' }, t('admin.settingsTitle')));
    const state = adminNow();
    if (state?.isAdmin) {
      panel.append(
        h('p', { class: 'setting-hint' }, t('admin.signedIn', { email: state.email })),
        h(
          'div',
          { class: 'admin-settings-actions' },
          h(
            'a',
            { class: 'button button-primary button-sm', href: '#/community/admin' },
            icon('shield'),
            t('admin.openPanel')
          ),
          signOutButton()
        ),
        h('p', { class: 'setting-hint' }, t('admin.toolsHint'))
      );
      return;
    }
    if (state) {
      panel.append(
        h('p', { class: 'setting-hint' }, t('admin.notAdmin', { email: state.email })),
        signOutButton()
      );
      return;
    }
    if (!formOpen) {
      panel.append(
        h(
          'button',
          {
            class: 'button button-ghost button-sm',
            type: 'button',
            onclick: () => {
              formOpen = true;
              draw();
            }
          },
          icon('lock'),
          t('admin.signInTitle')
        )
      );
      return;
    }
    const slot = h('div', {}, h('p', { class: 'setting-hint' }, '…'));
    panel.append(slot);
    void import('./AdminUi').then(({ adminLoginForm }) => {
      clear(slot);
      slot.append(adminLoginForm(() => draw()));
    });
  };
  const signOutButton = (): HTMLButtonElement =>
    h(
      'button',
      {
        class: 'button button-ghost button-sm',
        type: 'button',
        onclick: () =>
          void import('../../community/admin').then(({ adminSignOut }) =>
            adminSignOut().catch(() => undefined)
          )
      },
      t('admin.signOut')
    );
  draw();
  // Redraws when the admin signs in or out (also on other screens); stops once removed.
  const stop = onAdminChange(() => {
    if (!panel.isConnected) {
      stop();
      return;
    }
    formOpen = false;
    draw();
  });
  void adminStatus();
  return panel;
}

/** Cheat buttons shown in the pause menu to a signed-in admin. */
export function adminPauseTools(
  apply: (command: AdminCommand) => void,
  invincible: boolean,
  toast: (message: string) => void
): HTMLElement {
  let godMode = invincible;
  const run = (command: AdminCommand, message: string): void => {
    apply(command);
    toast(message);
  };
  const godButton = h(
    'button',
    {
      class: `button button-sm ${godMode ? 'button-primary' : 'button-secondary'}`,
      type: 'button',
      'aria-pressed': String(godMode),
      onclick: () => {
        godMode = !godMode;
        godButton.className = `button button-sm ${godMode ? 'button-primary' : 'button-secondary'}`;
        godButton.setAttribute('aria-pressed', String(godMode));
        run(
          { kind: 'invincible', enabled: godMode },
          godMode ? t('admin.tools.godOn') : t('admin.tools.godOff')
        );
      }
    },
    t('admin.tools.god')
  );
  const powerButtons = POWER_UP_TYPES.map((type) => {
    const name = t(`power.${type}` as MessageKey).split(' — ')[0] ?? type;
    return h(
      'button',
      {
        class: `admin-power${POWER_UPS[type].risk ? ' is-risk' : ''}`,
        type: 'button',
        title: t(`power.${type}` as MessageKey),
        onclick: () => run({ kind: 'powerUp', type }, t('admin.tools.given', { name }))
      },
      h('span', { class: 'admin-power-icon', 'aria-hidden': 'true' }, POWER_UPS[type].icon),
      h('span', {}, name)
    );
  });
  return h(
    'details',
    { class: 'admin-tools', open: true },
    h('summary', {}, icon('shield'), t('admin.tools.title')),
    h(
      'div',
      { class: 'admin-tools-row' },
      h(
        'button',
        {
          class: 'button button-secondary button-sm',
          type: 'button',
          onclick: () => run({ kind: 'lives', amount: 1 }, t('admin.tools.livesGiven', { n: 1 }))
        },
        t('admin.tools.life1')
      ),
      h(
        'button',
        {
          class: 'button button-secondary button-sm',
          type: 'button',
          onclick: () => run({ kind: 'lives', amount: 9 }, t('admin.tools.livesMax'))
        },
        t('admin.tools.lifeMax')
      ),
      h(
        'button',
        {
          class: 'button button-secondary button-sm',
          type: 'button',
          onclick: () => run({ kind: 'points', amount: 5000 }, t('admin.tools.pointsGiven'))
        },
        t('admin.tools.points')
      ),
      godButton,
      h(
        'button',
        {
          class: 'button button-danger button-sm',
          type: 'button',
          onclick: () => run({ kind: 'clear' }, t('admin.tools.cleared'))
        },
        t('admin.tools.clear')
      )
    ),
    h('p', { class: 'admin-tools-label' }, t('admin.tools.powerUps')),
    h('div', { class: 'admin-power-grid' }, ...powerButtons),
    h('p', { class: 'result-hint' }, t('admin.tools.note'))
  );
}
