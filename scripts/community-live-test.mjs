#!/usr/bin/env node
// End-to-end check of the community backend (Supabase): anonymous account, nickname, publish,
// library listing, like, play counter, hide/show, update, delete — plus the security rules
// (validation, forged counters, other players' data). Cleans up after itself.
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

function rows() {
  const grid = Array.from({ length: 58 }, () => '.'.repeat(36));
  grid[4] = `11111111${'.'.repeat(28)}`;
  return grid;
}

const a = player();
const b = player();
const suffix = Math.random().toString(36).slice(2, 7);
let created = null;

try {
  const signA = await a.auth.signInAnonymously();
  const signB = await b.auth.signInAnonymously();
  check('anonymous sign-in works', !signA.error && !signB.error, signA.error ?? signB.error);
  const idA = signA.data.user.id;
  const idB = signB.data.user.id;

  const noNick = await a.rpc('publish_creation', {
    p_kind: 'level',
    p_title: 'Sans pseudo',
    p_description: '',
    p_levels: [{ name: 'L', rows: rows() }],
    p_difficulty: 1
  });
  check(
    'publishing needs a nickname',
    String(noNick.error?.message).includes('nickname_required'),
    noNick.error
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
  check(
    'the server rejects an invalid grid',
    String(bad.error?.message).includes('invalid_level'),
    bad.error
  );

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
    .select('id,title,author:profiles(nickname),preview:levels->0')
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
} catch (error) {
  check('no unexpected exception', false, String(error));
} finally {
  // Remove the two test players' profiles too (cascades to anything left behind).
  const cleanup = async () => {
    for (const client of [a, b]) {
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
