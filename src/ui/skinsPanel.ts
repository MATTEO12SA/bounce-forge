import {
  activeSkins,
  ballLook,
  isSkinUnlocked,
  paddleLook,
  SKIN_SLOTS,
  skinsFor,
  trailLook,
  type SkinSlot
} from '../game/config/skins';
import { paintBall, paintPaddle, paintTrailPreview } from '../game/render/skinArt';
import type { SaveSystem } from '../game/systems/SaveSystem';
import { clear, h, icon } from './dom';
import { t, type MessageKey } from './i18n';

/**
 * "Appearance" panel of the trophy room: every paddle, ball and trail skin, the trophy that
 * unlocks it, and a click to equip it.
 */

export function skinName(slot: SkinSlot, id: string): string {
  return t(`skins.${slot}.${id}` as MessageKey);
}

function preview(slot: SkinSlot, id: string): HTMLCanvasElement {
  const size = slot === 'paddle' ? [96, 34] : slot === 'ball' ? [64, 64] : [160, 48];
  const canvas = h('canvas', {
    class: `skin-preview skin-preview-${slot}`,
    width: size[0],
    height: size[1],
    'aria-hidden': 'true'
  });
  const ctx = canvas.getContext('2d');
  if (ctx) {
    if (slot === 'paddle') paintPaddle(ctx, paddleLook(id));
    else if (slot === 'ball') paintBall(ctx, ballLook(id));
    else paintTrailPreview(ctx, size[0]!, size[1]!, trailLook(id));
  }
  return canvas;
}

export function skinsPanel(save: SaveSystem): HTMLElement {
  const panel = h('section', { class: 'panel skins-panel', 'aria-labelledby': 'skins-title' });
  const draw = (): void => {
    clear(panel);
    const data = save.snapshot();
    const equipped = activeSkins(data.preferences.skins, data.achievements);
    const all = SKIN_SLOTS.flatMap((slot) => skinsFor(slot).map((skin) => ({ slot, skin })));
    const owned = all.filter(({ slot, skin }) => isSkinUnlocked(slot, skin.id, data.achievements));
    panel.append(
      h(
        'div',
        { class: 'skins-head' },
        h('h2', { class: 'panel-title', id: 'skins-title' }, t('skins.title')),
        h(
          'span',
          { class: 'progress-chip' },
          t('skins.count', { n: owned.length, total: all.length })
        )
      ),
      h('p', { class: 'result-hint' }, t('skins.subtitle'))
    );
    SKIN_SLOTS.forEach((slot) => {
      const items = skinsFor(slot).map((skin) => {
        const unlocked = isSkinUnlocked(slot, skin.id, data.achievements);
        const isOn = equipped[slot] === skin.id;
        const trophyName = skin.trophy
          ? (t(`trophy.${skin.trophy}` as MessageKey).split(' — ')[0] ?? skin.trophy)
          : '';
        return h(
          'li',
          {},
          h(
            'button',
            {
              class: `skin-card${isOn ? ' is-equipped' : ''}${unlocked ? '' : ' is-locked'}`,
              type: 'button',
              'aria-pressed': String(isOn),
              disabled: !unlocked,
              title: unlocked ? skinName(slot, skin.id) : t('skins.locked', { trophy: trophyName }),
              onclick: () => {
                if (save.setSkin(slot, skin.id)) draw();
              }
            },
            h('span', { class: 'skin-visual' }, preview(slot, skin.id)),
            h('span', { class: 'skin-name' }, skinName(slot, skin.id)),
            h(
              'span',
              { class: 'skin-state' },
              isOn
                ? t('skins.equipped')
                : unlocked
                  ? t('skins.equip')
                  : h('span', {}, icon('lock'), ` ${trophyName}`)
            )
          )
        );
      });
      panel.append(
        h('h3', { class: 'skins-slot' }, t(`skins.slot.${slot}` as MessageKey)),
        h('ul', { class: 'skin-grid', role: 'list' }, ...items)
      );
    });
  };
  draw();
  return panel;
}
