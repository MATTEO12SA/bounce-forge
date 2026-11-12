import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { BANNED_WORDS, isOffensive } from '../shared/moderation.mjs';

/**
 * Runs the real Supabase migrations in an in-memory Postgres (PGlite) with a minimal stand-in
 * for Supabase's `auth` schema, then plays the moderation rules as different players.
 */

const MIGRATIONS = 'supabase/migrations';

const SUPABASE_STANDIN = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

let db: PGlite;

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

/** Runs `task` as a signed-in player (or as an anonymous visitor when `user` is null). */
async function as<T>(user: string | null, task: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`set local role ${user ? 'authenticated' : 'anon'}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ?? '']);
    return task(tx);
  });
}

async function rpc<T = unknown>(user: string | null, call: string, params: unknown[] = []) {
  return as(user, async (tx) => {
    const result = await tx.query<{ value: T }>(`select ${call} as value`, params);
    return result.rows[0]?.value as T;
  });
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'no error';
  } catch (error) {
    return String((error as Error).message);
  }
}

let userCount = 0;
/** A new player with a nickname; `daysOld` ages the profile, `played` adds distinct plays. */
async function player(options: { daysOld?: number; played?: number; nickname?: string } = {}) {
  userCount += 1;
  const { rows } = await db.query<{ id: string }>(
    'insert into auth.users default values returning id'
  );
  const id = rows[0]!.id;
  await as(id, (tx) =>
    tx.query('insert into public.profiles (id, nickname) values ($1, $2)', [
      id,
      options.nickname ?? `Joueur${userCount}`
    ])
  );
  if (options.daysOld) {
    await db.query(
      `update public.profiles set created_at = now() - make_interval(days => $2) where id = $1`,
      [id, options.daysOld]
    );
  }
  for (let index = 0; index < (options.played ?? 0); index += 1) {
    const author = await anyAuthor();
    const creation = await db.query<{ id: string }>(
      `insert into public.creations (author_id, kind, title, levels, level_count, content_hash)
       values ($1, 'level', 'Joué', '[]', 1, gen_random_uuid()::text) returning id`,
      [author]
    );
    await db.query('insert into public.plays (creation_id, player_id) values ($1, $2)', [
      creation.rows[0]!.id,
      id
    ]);
  }
  return id;
}

let fillerAuthor: string | null = null;
async function anyAuthor(): Promise<string> {
  if (!fillerAuthor) {
    const { rows } = await db.query<{ id: string }>(
      'insert into auth.users default values returning id'
    );
    fillerAuthor = rows[0]!.id;
    await db.query(`insert into public.profiles (id, nickname) values ($1, 'Remplissage')`, [
      fillerAuthor
    ]);
  }
  return fillerAuthor;
}

let gridSeed = 0;
/** A valid, unique level (a short row of bricks at a different place each time). */
function level(name = 'Niveau', bricks = 8) {
  gridSeed += 1;
  const rows = Array.from({ length: 58 }, () => '.'.repeat(36));
  const row = 2 + (gridSeed % 50);
  const col = Math.floor(gridSeed / 50) % 20;
  rows[row] = '.'.repeat(col) + '1'.repeat(bricks) + '.'.repeat(36 - col - bricks);
  return { name, rows };
}

function publish(user: string, title: string, levels = [level()], description = '') {
  return rpc<string>(user, 'public.publish_creation($1, $2, $3, $4::jsonb, 2)', [
    'level',
    title,
    description,
    JSON.stringify(levels)
  ]);
}

function report(user: string, creation: string, reason = 'offensive', details = '') {
  return rpc<string>(user, 'public.report_creation($1, $2, $3)', [creation, reason, details]);
}

function vote(user: string, creation: string, keep: boolean) {
  return rpc<string>(user, 'public.cast_review_vote($1, $2)', [creation, keep]);
}

async function status(creation: string): Promise<string> {
  const { rows } = await db.query<{ status: string }>(
    'select status from public.creations where id = $1',
    [creation]
  );
  return rows[0]?.status ?? 'missing';
}

async function profile(id: string) {
  const { rows } = await db.query<{
    trust: number;
    strikes: number;
    banned: boolean;
  }>(
    `select trust, strikes, coalesce(publish_banned_until > now(), false) as banned
       from public.profiles where id = $1`,
    [id]
  );
  return rows[0]!;
}

/** Sends a creation to review with three reports. */
async function toReview(creation: string) {
  for (let index = 0; index < 3; index += 1) await report(await player(), creation);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8').replace(
      /create extension if not exists pgcrypto;/g,
      ''
    );
    await db.exec(sql);
  }
}, 60_000);

describe('community database: automatic moderation', () => {
  it('uses the same word list as the client', () => {
    const sql = readFileSync(
      join(MIGRATIONS, migrationFiles().find((file) => file.includes('moderation'))!),
      'utf8'
    );
    const values = sql.slice(sql.indexOf('insert into public.moderation_words'));
    const words = [
      ...values.slice(0, values.indexOf(';')).matchAll(/\('([a-z]+)', (true|false)\)/g)
    ].map((match) => [match[1], match[2] === 'true']);
    expect(words).toEqual(BANNED_WORDS.map(([word, inside]) => [word, inside]));
  });

  it('judges text exactly like the client filter', async () => {
    const samples = [
      'Gros connard',
      'c0nn4rd',
      'F.U.C.K',
      'f u c k this',
      'xxSALOPExx',
      'Le niveau de Hitler',
      'ÉNCULÉ',
      'motherfuuucker',
      'kys noob',
      'Mèche à retardement',
      'Computer',
      'Violet',
      'Cocktail',
      'En retard',
      'Bite the dust',
      'Nigeria',
      'Cœur de forge',
      'Tempête de cristal',
      'Forgeron_42',
      ''
    ];
    for (const text of samples) {
      const server = await db.query<{ value: boolean }>(
        'select public.moderation_offensive($1) as value',
        [text]
      );
      expect(server.rows[0]!.value, text).toBe(isOffensive(text));
    }
  });

  it('refuses offensive nicknames and links in nicknames', async () => {
    const { rows } = await db.query<{ id: string }>(
      'insert into auth.users default values returning id'
    );
    const id = rows[0]!.id;
    const insert = (nickname: string) =>
      as(id, (tx) =>
        tx.query('insert into public.profiles (id, nickname) values ($1, $2)', [id, nickname])
      );
    expect(await failure(insert('Sale connard'))).toContain('nickname_offensive');
    expect(await failure(insert('mon-site.com'))).toContain('links_forbidden');
    expect(await failure(insert('Gentil joueur'))).toBe('no error');
    const rename = as(id, (tx) =>
      tx.query('update public.profiles set nickname = $2 where id = $1', [id, 'FuckYou'])
    );
    expect(await failure(rename)).toContain('nickname_offensive');
  });

  it('refuses offensive or linked text, nearly empty levels and copies', async () => {
    const author = await player();
    expect(await failure(publish(author, 'Niveau de merde salope'))).toContain('offensive_text');
    expect(await failure(publish(author, 'Bon niveau', [level()], 'va sur www.x.com'))).toContain(
      'links_forbidden'
    );
    expect(await failure(publish(author, 'Bon niveau', [level('Hitler')]))).toContain(
      'offensive_text'
    );
    expect(await failure(publish(author, 'Trop vide', [level('Vide', 2)]))).toContain('too_simple');
    const original = level();
    const id = await publish(author, 'Original', [original]);
    expect(typeof id).toBe('string');
    const copier = await player();
    expect(await failure(publish(copier, 'Copie', [{ ...original, name: 'Autre nom' }]))).toContain(
      'duplicate'
    );
    // The author can still update their own creation with the same grid.
    expect(
      await failure(
        rpc(author, 'public.publish_creation($1, $2, $3, $4::jsonb, 2, $5)', [
          'level',
          'Original v2',
          '',
          JSON.stringify([original]),
          id
        ])
      )
    ).toBe('no error');
  });
});

describe('community database: boss blocks', () => {
  it('accepts levels with boss armour and counts it as bricks to break', async () => {
    const author = await player();
    const rows = Array.from({ length: 58 }, () => '.'.repeat(36));
    rows[6] = `..WWWW${'.'.repeat(30)}`;
    rows[7] = `..WWWW${'.'.repeat(30)}`;
    expect(typeof (await publish(author, 'Boss maison', [{ name: 'Boss', rows }]))).toBe('string');
    const count = await db.query<{ value: number }>(
      'select public.required_bricks($1::jsonb) as value',
      [JSON.stringify({ rows })]
    );
    expect(count.rows[0]!.value).toBe(8);
  });
});

describe('community database: reports, review, sanctions, appeals', () => {
  it('sends a creation to review after three reports and hides it', async () => {
    const author = await player();
    const creation = await publish(author, 'Signalé');
    expect(await failure(report(author, creation))).toContain('cannot_report_own');
    const first = await player();
    expect(await report(first, creation, 'spam')).toBe('published');
    expect(await failure(report(first, creation))).toContain('already_reported');
    expect(await failure(report(first, creation, 'nope'))).toContain('invalid_reason');
    await report(await player(), creation, 'broken', 'Impossible à finir');
    expect(await report(await player(), creation)).toBe('review');

    const visitor = await player();
    const visible = await as(visitor, (tx) =>
      tx.query('select id from public.creations where id = $1', [creation])
    );
    expect(visible.rows).toHaveLength(0);
    const own = await as(author, (tx) =>
      tx.query('select id from public.creations where id = $1', [creation])
    );
    expect(own.rows).toHaveLength(1);
    const mine = await as(first, (tx) =>
      tx.query('select reason from public.reports where creation_id = $1', [creation])
    );
    expect(mine.rows).toEqual([{ reason: 'spam' }]);
  });

  it('limits reports per day and blocks distrusted reporters', async () => {
    const reporter = await player();
    for (let index = 0; index < 10; index += 1) {
      await report(reporter, await publish(await player(), `Quota ${index}`), 'other');
    }
    const extra = await publish(await player(), 'Quota extra');
    expect(await failure(report(reporter, extra))).toContain('report_quota');
    const liar = await player();
    await db.query('update public.profiles set trust = -5 where id = $1', [liar]);
    expect(await failure(report(liar, extra))).toContain('report_blocked');
  });

  it('lets trusted players vote and removes with a 70 % majority', async () => {
    const author = await player();
    const creation = await publish(author, 'À juger');
    const reporters = [await player(), await player(), await player()];
    for (const reporter of reporters) await report(reporter, creation);
    expect(await status(creation)).toBe('review');

    const newcomer = await player({ played: 5 });
    expect(await failure(rpc(newcomer, 'public.review_queue()'))).toContain('not_eligible');
    expect(await failure(vote(newcomer, creation, false))).toContain('not_eligible');
    const idle = await player({ daysOld: 5, played: 1 });
    expect(await failure(vote(idle, creation, false))).toContain('not_eligible');

    const voters = [];
    for (let index = 0; index < 5; index += 1) voters.push(await player({ daysOld: 4, played: 3 }));
    const queue = await as(voters[0]!, (tx) =>
      tx.query<{ id: string; reasons: Record<string, number> }>(
        'select id, reasons from public.review_queue()'
      )
    );
    expect(queue.rows.map((row) => row.id)).toContain(creation);
    expect(queue.rows.find((row) => row.id === creation)!.reasons).toEqual({ offensive: 3 });
    const mood = await rpc<{ can_review: boolean; to_review: number }>(
      voters[0]!,
      'public.my_moderation()'
    );
    expect(mood.can_review).toBe(true);
    expect(mood.to_review).toBeGreaterThanOrEqual(1);

    expect(await vote(voters[0]!, creation, false)).toBe('review');
    expect(await failure(vote(voters[0]!, creation, true))).toContain('already_voted');
    expect(await vote(voters[1]!, creation, true)).toBe('review');
    expect(await vote(voters[2]!, creation, false)).toBe('review');
    expect(await vote(voters[3]!, creation, false)).toBe('review');
    // 4 remove / 1 keep = 80 %.
    expect(await vote(voters[4]!, creation, false)).toBe('removed');
    expect(await status(creation)).toBe('removed');

    expect((await profile(author)).strikes).toBe(1);
    expect((await profile(author)).banned).toBe(false);
    expect((await profile(reporters[0]!)).trust).toBe(1);
    expect((await profile(voters[0]!)).trust).toBe(1);
    expect((await profile(voters[1]!)).trust).toBe(-1);

    // A second removal bans publishing for 7 days.
    const second = await publish(author, 'Récidive');
    await toReview(second);
    await db.query(`select public.moderation_resolve($1, false, 'team')`, [second]);
    expect((await profile(author)).strikes).toBe(2);
    expect((await profile(author)).banned).toBe(true);
    expect(await failure(publish(author, 'Interdit'))).toContain('publish_banned');
  });

  it('keeps a creation when reports were wrong and lowers the reporters’ trust', async () => {
    const author = await player();
    const creation = await publish(author, 'Innocent');
    const reporters = [await player(), await player(), await player()];
    for (const reporter of reporters) await report(reporter, creation);
    const voters = [];
    for (let index = 0; index < 5; index += 1) voters.push(await player({ daysOld: 4, played: 3 }));
    for (const voter of voters.slice(0, 4))
      expect(await vote(voter, creation, true)).toBe('review');
    expect(await vote(voters[4]!, creation, true)).toBe('published');
    expect((await profile(reporters[0]!)).trust).toBe(-2);
    expect((await profile(author)).strikes).toBe(0);
  });

  it('sends a split vote to the team after nine votes', async () => {
    const creation = await publish(await player(), 'Partagé');
    await toReview(creation);
    const results = [];
    for (let index = 0; index < 9; index += 1) {
      results.push(await vote(await player({ daysOld: 4, played: 3 }), creation, index % 2 === 0));
    }
    expect(results.at(-1)).toBe('team');
    const queue = await rpc<unknown>(
      await player({ daysOld: 4, played: 3 }),
      '(select count(*) from public.review_queue() where id = $1)',
      [creation]
    );
    expect(Number(queue)).toBe(0);
  });

  it('lets the author appeal once', async () => {
    const author = await player();
    const creation = await publish(author, 'Contesté');
    expect(
      await failure(rpc(author, 'public.appeal_creation($1, $2)', [creation, 'Pourquoi ?']))
    ).toContain('not_found');
    await toReview(creation);
    await db.query(`select public.moderation_resolve($1, false, 'team')`, [creation]);
    expect(
      await failure(rpc(await player(), 'public.appeal_creation($1, $2)', [creation, 'Moi']))
    ).toContain('not_found');
    expect(await failure(rpc(author, 'public.appeal_creation($1, $2)', [creation, 'Erreur']))).toBe(
      'no error'
    );
    expect(
      await failure(rpc(author, 'public.appeal_creation($1, $2)', [creation, 'Encore']))
    ).toContain('appeal_exists');
    const appeal = await as(author, (tx) =>
      tx.query<{ status: string }>('select status from public.appeals where creation_id = $1', [
        creation
      ])
    );
    expect(appeal.rows).toEqual([{ status: 'pending' }]);
  });
});

describe('community database: admin panel', () => {
  it('gives the admin every right and nobody else', async () => {
    const someone = await player();
    expect(await failure(rpc(someone, 'public.admin_overview()'))).toContain('not_admin');
    expect(await failure(rpc(null, 'public.admin_overview()'))).toContain('permission denied');
    const forged = await failure(
      as(someone, (tx) => tx.query('insert into public.admins (user_id) values ($1)', [someone]))
    );
    expect(forged).toContain('permission denied');

    const { rows } = await db.query<{ id: string }>(
      'insert into auth.users default values returning id'
    );
    const admin = rows[0]!.id;
    await db.query('insert into public.admins (user_id) values ($1)', [admin]);
    expect(await rpc(admin, 'public.is_admin()')).toBe(true);
    expect(await rpc(someone, 'public.is_admin()')).toBe(false);

    // Appeal accepted: the creation comes back and the strike goes away.
    const author = await player();
    const creation = await publish(author, 'Recours');
    await toReview(creation);
    await db.query(`select public.moderation_resolve($1, false, 'team')`, [creation]);
    await rpc(author, 'public.appeal_creation($1, $2)', [creation, 'Erreur']);
    const overview = await rpc<{ appeals: number }>(admin, 'public.admin_overview()');
    expect(overview.appeals).toBeGreaterThanOrEqual(1);
    const listed = await rpc<Array<{ id: string; appeal: { status: string } }>>(
      admin,
      'public.admin_creations($1, $2)',
      ['appeals', '']
    );
    expect(listed.find((item) => item.id === creation)?.appeal.status).toBe('pending');
    const hidden = await as(admin, (tx) =>
      tx.query('select id from public.creations where id = $1', [creation])
    );
    expect(hidden.rows).toHaveLength(1);
    expect(await rpc(admin, 'public.admin_moderate($1, $2, $3)', [creation, 'keep', 'OK'])).toBe(
      'published'
    );
    expect((await profile(author)).strikes).toBe(0);
    const appeal = await db.query<{ status: string }>(
      'select status from public.appeals where creation_id = $1',
      [creation]
    );
    expect(appeal.rows[0]!.status).toBe('accepted');

    // Remove, delete, sanction and rename.
    expect(await rpc(admin, 'public.admin_moderate($1, $2, $3)', [creation, 'remove', ''])).toBe(
      'removed'
    );
    expect(await rpc(admin, 'public.admin_moderate($1, $2, $3)', [creation, 'delete', ''])).toBe(
      'deleted'
    );
    expect(await status(creation)).toBe('missing');
    await rpc(admin, 'public.admin_player_action($1, $2, $3)', [author, 'ban', 30]);
    expect((await profile(author)).banned).toBe(true);
    await rpc(admin, 'public.admin_player_action($1, $2, $3)', [author, 'unban', 0]);
    expect((await profile(author)).banned).toBe(false);
    await rpc(admin, 'public.admin_player_action($1, $2, $3)', [author, 'rename', 0]);
    const renamed = await db.query<{ nickname: string }>(
      'select nickname from public.profiles where id = $1',
      [author]
    );
    expect(renamed.rows[0]!.nickname).toMatch(/^Joueur [0-9a-f]{6}$/);
    const players = await rpc<Array<{ id: string }>>(admin, 'public.admin_players($1)', ['joueur']);
    expect(players.length).toBeGreaterThan(0);
    const log = await rpc<Array<{ action: string }>>(admin, 'public.admin_log()');
    expect(log.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['kept', 'removed', 'deleted', 'player_ban', 'player_rename'])
    );
    expect(
      await failure(rpc(someone, 'public.admin_player_action($1, $2, $3)', [author, 'ban', 30]))
    ).toContain('not_admin');
  });
});
