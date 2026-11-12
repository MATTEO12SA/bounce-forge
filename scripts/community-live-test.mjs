#!/usr/bin/env node
// End-to-end check of the community backend (Supabase): anonymous account, nickname, publish,
// library listing, like, play counter, hide/show, update, delete — plus the security rules
// (validation, forged counters, other players' data) and moderation (word filter, links, copies,
// reports, review, admin rights). Cleans up after itself.
//
// Usage: node scripts/community-live-test.mjs   (uses the public URL and publishable key)

import { createClient } from '@supabase/supabase-js';

const URL = process.env.VITE_SUPABASE_URL ?? 'https://gxeixluoxfhcqguxmems.supabase.co';
const KEY = process.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_b2PUr2QemidoCHjTXPS_JQ_5KLyN7Is';

let failures = 0;
function check(name, ok, details) {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : ` — ${JSON.stringify(details)}`}`);
  if (!ok) failures += 1;
}

const player = () => createClient(URL, KEY, { auth: { persistSession: false } });

const suffix = Math.random().toString(36).slice(2, 7);
// A different grid on every run, so leftovers of an interrupted run never count as copies.
const seed = Math.floor(Math.random() * 40 * 28);
function rows(variant = 0) {
  const grid = Array.from({ length: 58 }, () => '.'.repeat(36));
  const row = 2 + (seed % 40);
  const col = Math.floor(seed / 40) % 28;
  grid[row] = '.'.repeat(col) + '11111111' + '.'.repeat(28 - col);
  if (variant) grid[row + 2] = '.'.repeat(col) + '2222' + '.'.repeat(32 - col);
  return grid;
}

const errorOf = (result) => String(result.error?.message);

const a = player();
const b = player();
const c = player();
const d = player();
let created = null;
let reported = null;

try {
  const signA = await a.auth.signInAnonymously();
  const signB = await b.auth.signInAnonymously();
  const signC = await c.auth.signInAnonymously();
  const signD = await d.auth.signInAnonymously();
  check('anonymous sign-in works', !signA.error && !signB.error, signA.error ?? signB.error);
  const idA = signA.data.user.id;
  const idB = signB.data.user.id;
  const idC = signC.data.user.id;
  const idD = signD.data.user.id;

  const noNick = await a.rpc('publish_creation', {
    p_kind: 'level',
    p_title: 'Sans pseudo',
    p_description: '',
    p_levels: [{ name: 'L', rows: rows() }],
    p_difficulty: 1
  });
  check('publishing needs a nickname', errorOf(noNick).includes('nickname_required'), noNick.error);

  const rude = await a.from('profiles').insert({ id: idA, nickname: 'Gros connard' });
  check(
    'offensive nicknames are refused',
    errorOf(rude).includes('nickname_offensive'),
    rude.error
  );

  const nick = await a.from('profiles').insert({ id: idA, nickname: `Test ${suffix}` });
  check('a player chooses a nickname', !nick.error, nick.error);
  const nickB = await b.from('profiles').insert({ id: idB, nickname: `Autre ${suffix}` });
  check('a second player too', !nickB.error, nickB.error);
  const forgedTrust = await a.from('profiles').update({ trust: 999 }).eq('id', idA);
  check('players cannot raise their own trust', Boolean(forgedTrust.error), forgedTrust);

  const bad = await a.rpc('publish_creation', {
    p_kind: 'level',
    p_title: 'Grille cassée',
    p_description: '',
    p_levels: [{ name: 'L', rows: ['xx'] }],
    p_difficulty: 1
  });
  check('the server rejects an invalid grid', errorOf(bad).includes('invalid_level'), bad.error);

  const direct = await a.from('creations').insert({
    author_id: idA,
    kind: 'level',
    title: 'Direct',
    levels: [],
    level_count: 1
  });
  check('creations cannot be inserted directly', Boolean(direct.error), direct);

  const published = await a.rpc('publish_creation', {
    p_kind: 'level',
    p_title: `Test ${suffix}`,
    p_description: 'Test automatique',
    p_levels: [{ name: 'Niveau', rows: rows() }],
    p_difficulty: 2
  });
  check(
    'a valid level is published',
    !published.error && typeof published.data === 'string',
    published.error
  );
  created = published.data;

  const listed = await b
    .from('creations')
    .select('id,title,author:profiles!creations_author_id_fkey(nickname),preview:levels->0')
    .eq('status', 'published')
    .eq('id', created);
  check(
    'it appears in the library with its author and preview',
    listed.data?.length === 1 &&
      listed.data[0].author?.nickname === `Test ${suffix}` &&
      Array.isArray(listed.data[0].preview?.rows),
    listed
  );

  const forgedLikes = await b.from('creations').update({ likes: 999 }).eq('id', created);
  const afterForge = await b.from('creations').select('likes').eq('id', created).single();
  check('counters cannot be forged', afterForge.data?.likes === 0, { forgedLikes, afterForge });

  const like = await b.rpc('toggle_like', { p_id: created });
  const likes = await b.from('creations').select('likes').eq('id', created).single();
  check('another player likes it', like.data === true && likes.data?.likes === 1, { like, likes });
  const unlike = await b.rpc('toggle_like', { p_id: created });
  check('and can take the like back', unlike.data === false, unlike);

  await b.rpc('record_play', { p_id: created, p_completed: false });
  await b.rpc('record_play', { p_id: created, p_completed: true });
  const plays = await b.from('creations').select('plays').eq('id', created).single();
  check('a play counts once per player and day', plays.data?.plays === 1, plays);

  const stolen = await b.rpc('set_creation_listed', { p_id: created, p_listed: false });
  check("players cannot hide someone else's creation", Boolean(stolen.error), stolen);
  const hidden = await a.rpc('set_creation_listed', { p_id: created, p_listed: false });
  const invisible = await b.from('creations').select('id').eq('id', created);
  check('the author can hide it from the library', !hidden.error && invisible.data?.length === 0, {
    hidden,
    invisible
  });
  await a.rpc('set_creation_listed', { p_id: created, p_listed: true });

  const updated = await a.rpc('publish_creation', {
    p_kind: 'level',
    p_title: `Test ${suffix} v2`,
    p_description: '',
    p_levels: [{ name: 'Niveau', rows: rows() }],
    p_difficulty: 3,
    p_id: created
  });
  const version = await a.from('creations').select('version,title').eq('id', created).single();
  check('the author can update it', !updated.error && version.data?.version === 2, {
    updated,
    version
  });

  const deletedByOther = await b.from('creations').delete().eq('id', created).select('id');
  check(
    "players cannot delete someone else's creation",
    (deletedByOther.data ?? []).length === 0,
    deletedByOther
  );

  // ---------------------------------------------------------------- moderation
  const attempt = (client, title, levels, description = '') =>
    client.rpc('publish_creation', {
      p_kind: 'level',
      p_title: title,
      p_description: description,
      p_levels: levels,
      p_difficulty: 1
    });
  const rudeTitle = await attempt(a, 'Niveau de salope', [{ name: 'N', rows: rows(1) }]);
  check('offensive titles are refused', errorOf(rudeTitle).includes('offensive_text'), rudeTitle);
  const link = await attempt(a, 'Pub', [{ name: 'N', rows: rows(1) }], 'va sur www.example.com');
  check('links are refused', errorOf(link).includes('links_forbidden'), link.error);
  const copy = await attempt(b, 'Copie', [{ name: 'Autre nom', rows: rows() }]);
  check('copies of a creation are refused', errorOf(copy).includes('duplicate'), copy.error);
  const tiny = Array.from({ length: 58 }, () => '.'.repeat(36));
  tiny[3] = `1${'.'.repeat(35)}`;
  const empty = await attempt(a, 'Presque vide', [{ name: 'N', rows: tiny }]);
  check('nearly empty levels are refused', errorOf(empty).includes('too_simple'), empty.error);

  await c.from('profiles').insert({ id: idC, nickname: `Trois ${suffix}` });
  await d.from('profiles').insert({ id: idD, nickname: `Quatre ${suffix}` });
  const second = await attempt(a, `Signale ${suffix}`, [{ name: 'N', rows: rows(1) }]);
  reported = second.data;
  check('a second level is published', typeof reported === 'string', second.error);
  const report = (client, reason) =>
    client.rpc('report_creation', { p_id: reported, p_reason: reason, p_details: '' });
  const own = await report(a, 'spam');
  check(
    'authors cannot report their own creation',
    errorOf(own).includes('cannot_report_own'),
    own
  );
  const first = await report(b, 'spam');
  const again = await report(b, 'other');
  check(
    'a player reports a creation once',
    first.data === 'published' && errorOf(again).includes('already_reported'),
    { first, again }
  );
  await report(c, 'offensive');
  const third = await report(d, 'broken');
  const hiddenNow = await b.from('creations').select('id').eq('id', reported);
  const authorSees = await a.from('creations').select('status').eq('id', reported).single();
  check(
    'three reports hide it and send it to review',
    third.data === 'review' && hiddenNow.data?.length === 0 && authorSees.data?.status === 'review',
    { third, hiddenNow, authorSees }
  );
  const queue = await b.rpc('review_queue');
  check('new players cannot review yet', errorOf(queue).includes('not_eligible'), queue.error);
  const mine = await b.rpc('my_moderation');
  check(
    'players see their moderation status',
    mine.data?.profile === true && mine.data?.can_review === false && mine.data?.admin === false,
    mine
  );
  const notAdmin = await b.rpc('admin_overview');
  check('players have no admin rights', errorOf(notAdmin).includes('not_admin'), notAdmin.error);
  const selfAdmin = await b.from('admins').insert({ user_id: idB });
  check('players cannot make themselves admin', Boolean(selfAdmin.error), selfAdmin);
} catch (error) {
  check('no unexpected exception', false, String(error));
} finally {
  // Remove the test players' profiles too (cascades to anything left behind).
  const cleanup = async () => {
    if (reported) await a.from('creations').delete().eq('id', reported);
    for (const client of [a, b, c, d]) {
      const user = (await client.auth.getUser()).data.user;
      if (user) await client.from('profiles').delete().eq('id', user.id);
    }
  };
  if (created) {
    const removed = await a.from('creations').delete().eq('id', created).select('id');
    check('the author can delete it (cleanup)', (removed.data ?? []).length === 1, removed);
  }
  await cleanup();
}

console.log(
  failures === 0 ? '\nCommunity backend: all checks passed.' : `\n${failures} check(s) failed.`
);
process.exit(failures === 0 ? 0 : 1);
