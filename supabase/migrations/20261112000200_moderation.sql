-- Bounce Forge community moderation.
--
-- 1. Automatic: nicknames, titles, descriptions and level names go through a word filter
--    (same list and normalisation as shared/moderation.mjs), links are refused, copies of an
--    existing creation (same grids) and nearly empty levels are refused.
-- 2. Reports: one per player and creation, 10 per day. At 3 reports from players in good
--    standing (trust >= 0) the creation is hidden and goes "in review".
-- 3. Community review: players with a profile older than 3 days, trust >= 0 and at least 3
--    different creations played vote "keep" or "remove" (never on their own creation or one
--    they reported). Decision at 5 votes or more with a 70 % majority; no majority after
--    9 votes sends it to the team.
-- 4. Trust: reporters win +1 when a report is upheld and lose 2 when it is rejected; voters win 1
--    when they agree with the decision and lose 1 otherwise (bounded to -10..10). At -5 a player
--    can no longer report.
-- 5. Sanctions: each removed creation is a strike for its author; 2 strikes = no publishing for
--    7 days, 4 strikes = 30 days.
-- 6. Appeals: the author may appeal a removal once; the team (admins) decides, and every
--    decision is written to the moderation log.
-- 7. Admins (table `admins`, filled by hand in the SQL editor) can see everything, decide
--    reviews and appeals, restore / remove / delete any creation and sanction players.

-- ------------------------------------------------------------------ text filter

create table if not exists public.moderation_words (
  word text primary key,
  inside boolean not null default false
);
alter table public.moderation_words enable row level security;
revoke all on public.moderation_words from anon, authenticated;

-- Normalised forms from shared/moderation.mjs (tests/moderation.test.ts checks they match).
delete from public.moderation_words;
insert into public.moderation_words (word, inside) values
  ('conard', true), ('conase', true), ('salope', true), ('salopard', true), ('salaud', false),
  ('pute', false), ('putain', true), ('encule', true), ('enculer', true), ('niquer', true),
  ('nique', false), ('ntm', false), ('fdp', false), ('pd', false), ('pede', false),
  ('batard', false), ('enfoire', true), ('negre', true), ('bougnoule', true), ('youpin', true),
  ('pedophile', true), ('violer', false), ('viol', false), ('fuck', true), ('fucker', true),
  ('motherfucker', true), ('shit', false), ('bitch', true), ('cunt', true), ('dick', false),
  ('cock', false), ('pusy', false), ('ashole', true), ('bastard', false), ('whore', true),
  ('slut', false), ('niger', false), ('niga', false), ('fagot', false), ('fag', false),
  ('rape', false), ('rapist', true), ('pedo', false), ('porn', false), ('twat', false),
  ('wanker', true), ('chink', false), ('spic', false), ('kike', false), ('kys', false),
  ('nazi', false), ('hitler', true);

-- Lower case, no accents, leet digits mapped, letters only, repeated letters collapsed.
create or replace function public.moderation_normalize(p_text text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(regexp_replace(
    translate(
      lower(replace(replace(replace(replace(
        translate(
          coalesce(p_text, ''),
          'àáâãäåāăąçćčďèéêëēėęěìíîïīįñńňòóôõöōőùúûüūůűųýÿžźżšśşťţŕřľĺÀÁÂÃÄÅĀĂĄÇĆČĎÈÉÊËĒĖĘĚÌÍÎÏĪĮÑŃŇÒÓÔÕÖŌŐÙÚÛÜŪŮŰŲÝŸŽŹŻŠŚŞŤŢŔŘĽĹ',
          'aaaaaaaaacccdeeeeeeeeiiiiiinnnooooooouuuuuuuuyyzzzsssttrrllAAAAAAAAACCCDEEEEEEEEIIIIIINNNOOOOOOOUUUUUUUUYYZZZSSSTTRRLL'
        ),
        'œ', 'oe'), 'Œ', 'oe'), 'æ', 'ae'), 'Æ', 'ae')),
      '01345789@$',
      'oieastbgas'
    ),
    '[^a-z]+', ' ', 'g'),
    '([a-z])\1+', '\1', 'g'))
$$;

create or replace function public.moderation_offensive(p_text text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with n as (select public.moderation_normalize(p_text) as t)
  select exists (
    select 1
      from public.moderation_words w, n
     where n.t <> ''
       and (position(' ' || w.word || ' ' in ' ' || n.t || ' ') > 0
            or (w.inside and position(w.word in replace(n.t, ' ', '')) > 0))
  )
$$;

create or replace function public.moderation_has_link(p_text text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_text, '')
    ~* '(https?://|www\.|\y[a-z0-9-]+\.(com|net|org|fr|io|gg|xyz|ru|ly|me)\y|@[a-z0-9-]+\.)'
$$;

-- Fingerprint of a creation's grids (names and settings ignored): spots copies.
create or replace function public.levels_hash(p_levels jsonb)
returns text
language sql
immutable
as $$
  select md5(coalesce(string_agg((item.value -> 'rows')::text, '|' order by item.position), ''))
    from jsonb_array_elements(p_levels) with ordinality as item(value, position)
$$;

-- Number of bricks that must be destroyed to win a level.
create or replace function public.required_bricks(p_level jsonb)
returns integer
language sql
immutable
as $$
  select coalesce(sum(char_length(regexp_replace(line, '[^123EBSCKIMF]', '', 'g'))), 0)::integer
    from jsonb_array_elements_text(p_level -> 'rows') as line
$$;

-- ------------------------------------------------------------------ new columns and tables

alter table public.profiles add column if not exists strikes integer not null default 0;
alter table public.creations add column if not exists content_hash text;
alter table public.creations add column if not exists team_review boolean not null default false;
alter table public.creations add column if not exists review_started_at timestamptz;
alter table public.creations add column if not exists moderated_at timestamptz;
update public.creations set content_hash = public.levels_hash(levels) where content_hash is null;
create index if not exists creations_hash on public.creations (content_hash);
create index if not exists creations_review on public.creations (updated_at) where status = 'review';

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id bigint generated always as identity primary key,
  creation_id uuid not null references public.creations (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('offensive', 'spam', 'broken', 'copied', 'other')),
  details text not null default '' check (char_length(details) <= 300),
  outcome text check (outcome in ('upheld', 'rejected')),
  created_at timestamptz not null default now(),
  unique (creation_id, reporter_id)
);
create index if not exists reports_reporter on public.reports (reporter_id, created_at);

create table if not exists public.review_votes (
  creation_id uuid not null references public.creations (id) on delete cascade,
  voter_id uuid not null references public.profiles (id) on delete cascade,
  keep boolean not null,
  created_at timestamptz not null default now(),
  primary key (creation_id, voter_id)
);

create table if not exists public.appeals (
  creation_id uuid primary key references public.creations (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  message text not null default '' check (char_length(message) <= 500),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  decision_note text not null default '',
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists public.moderation_log (
  id bigint generated always as identity primary key,
  creation_id uuid references public.creations (id) on delete set null,
  player_id uuid references public.profiles (id) on delete set null,
  title text not null default '',
  action text not null,
  actor text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
alter table public.reports enable row level security;
alter table public.review_votes enable row level security;
alter table public.appeals enable row level security;
alter table public.moderation_log enable row level security;

-- ------------------------------------------------------------------ admins and visibility

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

drop policy if exists creations_read on public.creations;
create policy creations_read on public.creations for select
  using (status = 'published' or author_id = auth.uid() or public.is_admin());

-- Players see their own reports (to know what they already reported).
drop policy if exists reports_read_own on public.reports;
create policy reports_read_own on public.reports for select using (reporter_id = auth.uid());

-- Authors see their own appeals and the decision.
drop policy if exists appeals_read on public.appeals;
create policy appeals_read on public.appeals for select
  using (author_id = auth.uid() or public.is_admin());

-- ------------------------------------------------------------------ nickname filter

create or replace function public.profiles_moderation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.moderation_offensive(new.nickname) then
    raise exception 'nickname_offensive';
  end if;
  if public.moderation_has_link(new.nickname) then
    raise exception 'links_forbidden';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_moderation on public.profiles;
create trigger profiles_moderation
  before insert or update of nickname on public.profiles
  for each row execute function public.profiles_moderation();

-- ------------------------------------------------------------------ publishing (with checks)

create or replace function public.publish_creation(
  p_kind text,
  p_title text,
  p_description text,
  p_levels jsonb,
  p_difficulty integer,
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  author public.profiles%rowtype;
  level_total integer;
  recent integer;
  result uuid;
  item jsonb;
  fingerprint text;
begin
  if me is null then
    raise exception 'auth_required';
  end if;
  select * into author from public.profiles where id = me;
  if not found then
    raise exception 'nickname_required';
  end if;
  if author.publish_banned_until is not null and author.publish_banned_until > now() then
    raise exception 'publish_banned';
  end if;
  if p_kind not in ('level', 'campaign') or jsonb_typeof(p_levels) <> 'array' then
    raise exception 'invalid_levels';
  end if;
  level_total := jsonb_array_length(p_levels);
  if (p_kind = 'level' and level_total <> 1)
      or (p_kind = 'campaign' and (level_total < 2 or level_total > 24)) then
    raise exception 'invalid_level_count';
  end if;
  if pg_column_size(p_levels) > 300000 then
    raise exception 'too_large';
  end if;
  for item in select value from jsonb_array_elements(p_levels) loop
    if not public.valid_level(item) then
      raise exception 'invalid_level';
    end if;
  end loop;
  if char_length(trim(coalesce(p_title, ''))) < 3 or char_length(p_title) > 60 then
    raise exception 'invalid_title';
  end if;
  if char_length(coalesce(p_description, '')) > 300 then
    raise exception 'invalid_description';
  end if;

  -- Automatic moderation.
  if public.moderation_offensive(p_title) or public.moderation_offensive(p_description) then
    raise exception 'offensive_text';
  end if;
  if public.moderation_has_link(p_title) or public.moderation_has_link(p_description) then
    raise exception 'links_forbidden';
  end if;
  for item in select value from jsonb_array_elements(p_levels) loop
    if public.moderation_offensive(item ->> 'name') then
      raise exception 'offensive_text';
    end if;
    if public.moderation_has_link(item ->> 'name') then
      raise exception 'links_forbidden';
    end if;
    if public.required_bricks(item) < 4 then
      raise exception 'too_simple';
    end if;
  end loop;
  fingerprint := public.levels_hash(p_levels);
  if exists (
    select 1 from public.creations
     where content_hash = fingerprint and id is distinct from p_id
  ) then
    raise exception 'duplicate';
  end if;

  if p_id is null then
    select count(*) into recent from public.creations
      where author_id = me and created_at > now() - interval '1 day';
    if recent >= 5 then
      raise exception 'rate_limited';
    end if;
    insert into public.creations
      (author_id, kind, title, description, levels, level_count, difficulty, content_hash)
    values (
      me, p_kind, trim(p_title), trim(coalesce(p_description, '')), p_levels, level_total,
      greatest(1, least(5, coalesce(p_difficulty, 1))), fingerprint
    )
    returning id into result;
    return result;
  end if;

  update public.creations
     set kind = p_kind,
         title = trim(p_title),
         description = trim(coalesce(p_description, '')),
         levels = p_levels,
         level_count = level_total,
         difficulty = greatest(1, least(5, coalesce(p_difficulty, 1))),
         content_hash = fingerprint,
         version = version + 1,
         updated_at = now()
   where id = p_id and author_id = me and status in ('published', 'unlisted')
  returning id into result;
  if result is null then
    raise exception 'not_found';
  end if;
  return result;
end;
$$;

-- ------------------------------------------------------------------ decisions (internal)

-- Applies a final decision on a creation: trust for voters and reporters, strikes and bans for
-- the author, pending appeal closed, log entry. `p_keep` = the creation stays (or comes back).
create or replace function public.moderation_resolve(
  p_id uuid,
  p_keep boolean,
  p_actor text,
  p_note text default ''
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.creations%rowtype;
  strike_count integer;
  new_status text;
begin
  select * into target from public.creations where id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;

  update public.profiles p
     set trust = greatest(-10, least(10, p.trust + case when v.keep = p_keep then 1 else -1 end))
    from public.review_votes v
   where v.creation_id = p_id and v.voter_id = p.id;
  delete from public.review_votes where creation_id = p_id;

  update public.profiles p
     set trust = greatest(-10, least(10, p.trust + case when p_keep then -2 else 1 end))
    from public.reports r
   where r.creation_id = p_id and r.outcome is null and r.reporter_id = p.id;
  update public.reports
     set outcome = case when p_keep then 'rejected' else 'upheld' end
   where creation_id = p_id and outcome is null;

  if p_keep then
    new_status := case when target.status = 'unlisted' then 'unlisted' else 'published' end;
    if target.status = 'removed' then
      -- A removal reversed: the strike goes away, and so does the ban if it no longer applies.
      update public.profiles
         set strikes = greatest(0, strikes - 1)
       where id = target.author_id
      returning strikes into strike_count;
      if strike_count < 2 then
        update public.profiles set publish_banned_until = null where id = target.author_id;
      end if;
    end if;
  else
    new_status := 'removed';
    if target.status <> 'removed' then
      update public.profiles
         set strikes = strikes + 1
       where id = target.author_id
      returning strikes into strike_count;
      if strike_count >= 4 then
        update public.profiles
           set publish_banned_until = greatest(coalesce(publish_banned_until, now()), now() + interval '30 days')
         where id = target.author_id;
      elsif strike_count >= 2 then
        update public.profiles
           set publish_banned_until = greatest(coalesce(publish_banned_until, now()), now() + interval '7 days')
         where id = target.author_id;
      end if;
    end if;
  end if;

  update public.creations
     set status = new_status, team_review = false, moderated_at = now()
   where id = p_id;
  update public.appeals
     set status = case when p_keep then 'accepted' else 'rejected' end,
         decision_note = left(coalesce(p_note, ''), 300),
         decided_at = now()
   where creation_id = p_id and status = 'pending';
  insert into public.moderation_log (creation_id, player_id, title, action, actor, note)
  values (p_id, target.author_id, target.title, case when p_keep then 'kept' else 'removed' end,
          p_actor, left(coalesce(p_note, ''), 300));
  return new_status;
end;
$$;

create or replace function public.can_review(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_user
       and p.trust >= 0
       and p.created_at <= now() - interval '3 days'
       and (select count(distinct creation_id) from public.plays where player_id = p_user) >= 3
  )
$$;

-- ------------------------------------------------------------------ player functions

-- What the interface needs to know about the current player.
create or replace function public.my_moderation()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  profile public.profiles%rowtype;
  eligible boolean;
begin
  select * into profile from public.profiles where id = me;
  if not found then
    return jsonb_build_object('profile', false, 'can_review', false, 'admin', public.is_admin());
  end if;
  eligible := public.can_review(me);
  return jsonb_build_object(
    'profile', true,
    'trust', profile.trust,
    'strikes', profile.strikes,
    'banned_until', profile.publish_banned_until,
    'can_report', profile.trust > -5,
    'can_review', eligible,
    'admin', public.is_admin(),
    'to_review', case when eligible then (
      select count(*) from public.creations c
       where c.status = 'review' and not c.team_review and c.author_id <> me
         and not exists (select 1 from public.reports r where r.creation_id = c.id and r.reporter_id = me)
         and not exists (select 1 from public.review_votes v where v.creation_id = c.id and v.voter_id = me)
    ) else 0 end
  );
end;
$$;

create or replace function public.report_creation(p_id uuid, p_reason text, p_details text default '')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  reporter public.profiles%rowtype;
  target public.creations%rowtype;
  trusted integer;
begin
  if me is null then
    raise exception 'auth_required';
  end if;
  select * into reporter from public.profiles where id = me;
  if not found then
    raise exception 'nickname_required';
  end if;
  if reporter.trust <= -5 then
    raise exception 'report_blocked';
  end if;
  if p_reason is null or p_reason not in ('offensive', 'spam', 'broken', 'copied', 'other') then
    raise exception 'invalid_reason';
  end if;
  if char_length(coalesce(p_details, '')) > 300 then
    raise exception 'invalid_description';
  end if;
  if public.moderation_offensive(p_details) then
    raise exception 'offensive_text';
  end if;
  if public.moderation_has_link(p_details) then
    raise exception 'links_forbidden';
  end if;
  select * into target from public.creations where id = p_id for update;
  if not found or target.status not in ('published', 'review') then
    raise exception 'not_found';
  end if;
  if target.author_id = me then
    raise exception 'cannot_report_own';
  end if;
  if exists (select 1 from public.reports where creation_id = p_id and reporter_id = me) then
    raise exception 'already_reported';
  end if;
  if (select count(*) from public.reports
       where reporter_id = me and created_at > now() - interval '1 day') >= 10 then
    raise exception 'report_quota';
  end if;

  insert into public.reports (creation_id, reporter_id, reason, details)
  values (p_id, me, p_reason, trim(coalesce(p_details, '')));

  if target.status = 'published' then
    select count(*) into trusted
      from public.reports r join public.profiles p on p.id = r.reporter_id
     where r.creation_id = p_id and r.outcome is null and p.trust >= 0;
    if trusted >= 3 then
      update public.creations
         set status = 'review', team_review = false, review_started_at = now()
       where id = p_id;
      insert into public.moderation_log (creation_id, player_id, title, action, actor)
      values (p_id, target.author_id, target.title, 'review', 'community');
      return 'review';
    end if;
  end if;
  return target.status;
end;
$$;

-- Creations waiting for community votes that the current player may judge.
create or replace function public.review_queue()
returns table (
  id uuid,
  kind text,
  title text,
  description text,
  level_count integer,
  difficulty smallint,
  levels jsonb,
  author text,
  reasons jsonb,
  details jsonb,
  votes integer,
  review_started_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
begin
  if me is null or not public.can_review(me) then
    raise exception 'not_eligible';
  end if;
  return query
    select c.id, c.kind, c.title, c.description, c.level_count, c.difficulty, c.levels,
           a.nickname,
           coalesce((select jsonb_object_agg(s.reason, s.total)
                       from (select r.reason, count(*) as total from public.reports r
                              where r.creation_id = c.id and r.outcome is null
                              group by r.reason) s), '{}'::jsonb),
           coalesce((select jsonb_agg(r.details) from public.reports r
                      where r.creation_id = c.id and r.outcome is null and r.details <> ''),
                    '[]'::jsonb),
           (select count(*)::integer from public.review_votes v where v.creation_id = c.id),
           c.review_started_at
      from public.creations c
      join public.profiles a on a.id = c.author_id
     where c.status = 'review' and not c.team_review and c.author_id <> me
       and not exists (select 1 from public.reports r where r.creation_id = c.id and r.reporter_id = me)
       and not exists (select 1 from public.review_votes v where v.creation_id = c.id and v.voter_id = me)
     order by c.review_started_at nulls first
     limit 20;
end;
$$;

-- Returns the creation's status after the vote: review, published, removed or team.
create or replace function public.cast_review_vote(p_id uuid, p_keep boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target public.creations%rowtype;
  total integer;
  kept integer;
begin
  if me is null or not public.can_review(me) then
    raise exception 'not_eligible';
  end if;
  if p_keep is null then
    raise exception 'invalid_vote';
  end if;
  select * into target from public.creations where id = p_id for update;
  if not found or target.status <> 'review' or target.team_review then
    raise exception 'not_found';
  end if;
  if target.author_id = me
      or exists (select 1 from public.reports where creation_id = p_id and reporter_id = me) then
    raise exception 'not_eligible';
  end if;
  insert into public.review_votes (creation_id, voter_id, keep)
  values (p_id, me, p_keep)
  on conflict do nothing;
  if not found then
    raise exception 'already_voted';
  end if;

  select count(*), count(*) filter (where keep) into total, kept
    from public.review_votes where creation_id = p_id;
  if total >= 5 and kept * 10 >= total * 7 then
    return public.moderation_resolve(p_id, true, 'community');
  end if;
  if total >= 5 and (total - kept) * 10 >= total * 7 then
    return public.moderation_resolve(p_id, false, 'community');
  end if;
  if total >= 9 then
    update public.creations set team_review = true where id = p_id;
    insert into public.moderation_log (creation_id, player_id, title, action, actor)
    values (p_id, target.author_id, target.title, 'escalated', 'community');
    return 'team';
  end if;
  return 'review';
end;
$$;

-- The author contests a removal, once per creation.
create or replace function public.appeal_creation(p_id uuid, p_message text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target public.creations%rowtype;
begin
  if me is null then
    raise exception 'auth_required';
  end if;
  select * into target from public.creations where id = p_id and author_id = me;
  if not found or target.status <> 'removed' then
    raise exception 'not_found';
  end if;
  if exists (select 1 from public.appeals where creation_id = p_id) then
    raise exception 'appeal_exists';
  end if;
  if char_length(coalesce(p_message, '')) > 500 then
    raise exception 'invalid_description';
  end if;
  if public.moderation_offensive(p_message) then
    raise exception 'offensive_text';
  end if;
  if public.moderation_has_link(p_message) then
    raise exception 'links_forbidden';
  end if;
  insert into public.appeals (creation_id, author_id, message)
  values (p_id, me, trim(coalesce(p_message, '')));
  insert into public.moderation_log (creation_id, player_id, title, action, actor)
  values (p_id, me, target.title, 'appealed', 'author');
end;
$$;

-- ------------------------------------------------------------------ admin functions

create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  return jsonb_build_object(
    'review', (select count(*) from public.creations where status = 'review' and not team_review),
    'team', (select count(*) from public.creations where status = 'review' and team_review),
    'appeals', (select count(*) from public.appeals where status = 'pending'),
    'reported', (select count(distinct creation_id) from public.reports where outcome is null),
    'published', (select count(*) from public.creations where status = 'published'),
    'removed', (select count(*) from public.creations where status = 'removed'),
    'players', (select count(*) from public.profiles),
    'banned', (select count(*) from public.profiles where publish_banned_until > now())
  );
end;
$$;

-- Creations for the admin page. Filters: attention (default), review, team, appeals, reported,
-- removed, all.
create or replace function public.admin_creations(p_filter text default 'attention', p_search text default '')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  needle text := lower(trim(coalesce(p_search, '')));
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  select coalesce(jsonb_agg(s.item order by s.sort_key desc), '[]'::jsonb) into result
    from (
      select c.updated_at as sort_key, jsonb_build_object(
        'id', c.id, 'kind', c.kind, 'title', c.title, 'description', c.description,
        'status', c.status, 'team_review', c.team_review, 'level_count', c.level_count,
        'difficulty', c.difficulty, 'plays', c.plays, 'likes', c.likes,
        'created_at', c.created_at, 'updated_at', c.updated_at, 'preview', c.levels -> 0,
        'author', jsonb_build_object(
          'id', a.id, 'nickname', a.nickname, 'trust', a.trust, 'strikes', a.strikes,
          'banned_until', a.publish_banned_until),
        'reports', (select coalesce(jsonb_agg(jsonb_build_object(
                       'reason', r.reason, 'details', r.details, 'by', rp.nickname,
                       'at', r.created_at, 'outcome', r.outcome) order by r.created_at desc), '[]'::jsonb)
                      from public.reports r left join public.profiles rp on rp.id = r.reporter_id
                     where r.creation_id = c.id),
        'votes', jsonb_build_object(
          'keep', (select count(*) from public.review_votes v where v.creation_id = c.id and v.keep),
          'remove', (select count(*) from public.review_votes v where v.creation_id = c.id and not v.keep)),
        'appeal', (select jsonb_build_object('message', ap.message, 'status', ap.status,
                                             'at', ap.created_at, 'note', ap.decision_note)
                     from public.appeals ap where ap.creation_id = c.id)
      ) as item
        from public.creations c
        join public.profiles a on a.id = c.author_id
       where (needle = '' or position(needle in lower(c.title)) > 0
              or position(needle in lower(a.nickname)) > 0)
         and case coalesce(p_filter, 'attention')
               when 'review' then c.status = 'review' and not c.team_review
               when 'team' then c.status = 'review' and c.team_review
               when 'appeals' then exists (select 1 from public.appeals ap
                                            where ap.creation_id = c.id and ap.status = 'pending')
               when 'reported' then exists (select 1 from public.reports r
                                             where r.creation_id = c.id and r.outcome is null)
               when 'removed' then c.status = 'removed'
               when 'all' then true
               else c.status = 'review'
                    or exists (select 1 from public.reports r where r.creation_id = c.id and r.outcome is null)
                    or exists (select 1 from public.appeals ap where ap.creation_id = c.id and ap.status = 'pending')
             end
       order by c.updated_at desc
       limit 60
    ) s;
  return result;
end;
$$;

-- keep = publish / restore (reports rejected, appeal accepted); remove = remove (strike, appeal
-- rejected); delete = erase for good.
create or replace function public.admin_moderate(p_id uuid, p_action text, p_note text default '')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.creations%rowtype;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if p_action = 'delete' then
    select * into target from public.creations where id = p_id;
    if not found then
      raise exception 'not_found';
    end if;
    insert into public.moderation_log (creation_id, player_id, title, action, actor, note)
    values (null, target.author_id, target.title, 'deleted', 'team', left(coalesce(p_note, ''), 300));
    delete from public.creations where id = p_id;
    return 'deleted';
  end if;
  if p_action not in ('keep', 'remove') then
    raise exception 'invalid_action';
  end if;
  return public.moderation_resolve(p_id, p_action = 'keep', 'team', p_note);
end;
$$;

create or replace function public.admin_players(p_search text default '')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  needle text := lower(trim(coalesce(p_search, '')));
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  select coalesce(jsonb_agg(s.item order by s.flagged desc, s.created_at desc), '[]'::jsonb) into result
    from (
      select p.created_at,
             (coalesce(p.publish_banned_until > now(), false) or p.strikes > 0 or p.trust < 0) as flagged,
             jsonb_build_object(
               'id', p.id, 'nickname', p.nickname, 'trust', p.trust, 'strikes', p.strikes,
               'banned_until', p.publish_banned_until, 'created_at', p.created_at,
               'creations', (select count(*) from public.creations c where c.author_id = p.id),
               'reports', (select count(*) from public.reports r where r.reporter_id = p.id),
               'reports_rejected', (select count(*) from public.reports r
                                     where r.reporter_id = p.id and r.outcome = 'rejected')
             ) as item
        from public.profiles p
       where needle = '' or position(needle in lower(p.nickname)) > 0
       order by flagged desc, p.created_at desc
       limit 50
    ) s;
  return result;
end;
$$;

-- Actions: ban (p_days), unban, reset_strikes, reset_trust, rename, delete.
create or replace function public.admin_player_action(p_user uuid, p_action text, p_days integer default 0)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.profiles%rowtype;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  select * into target from public.profiles where id = p_user;
  if not found then
    raise exception 'not_found';
  end if;
  case p_action
    when 'ban' then
      update public.profiles
         set publish_banned_until = now() + make_interval(days => greatest(1, least(3650, coalesce(p_days, 7))))
       where id = p_user;
    when 'unban' then
      update public.profiles set publish_banned_until = null where id = p_user;
    when 'reset_strikes' then
      update public.profiles set strikes = 0 where id = p_user;
    when 'reset_trust' then
      update public.profiles set trust = 0 where id = p_user;
    when 'rename' then
      update public.profiles
         set nickname = 'Joueur ' || substr(md5(random()::text || clock_timestamp()::text), 1, 6)
       where id = p_user;
    when 'delete' then
      delete from public.profiles where id = p_user;
    else
      raise exception 'invalid_action';
  end case;
  insert into public.moderation_log (player_id, title, action, actor, note)
  values (case when p_action = 'delete' then null else p_user end, target.nickname,
          'player_' || p_action, 'team',
          case when p_action = 'ban' then coalesce(p_days, 7) || ' d' else '' end);
end;
$$;

create or replace function public.admin_log()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', l.id, 'creation_id', l.creation_id, 'title', l.title, 'action', l.action,
             'actor', l.actor, 'note', l.note, 'at', l.created_at) order by l.id desc), '[]'::jsonb)
      from (select * from public.moderation_log order by id desc limit 100) l
  );
end;
$$;

-- ------------------------------------------------------------------ privileges

grant select (id, creation_id, reason, created_at) on public.reports to authenticated;
grant select on public.appeals to authenticated;
revoke all on public.admins, public.review_votes, public.moderation_log from anon, authenticated;

revoke all on function public.moderation_normalize(text) from public, anon, authenticated;
revoke all on function public.moderation_offensive(text) from public, anon, authenticated;
revoke all on function public.moderation_has_link(text) from public, anon, authenticated;
revoke all on function public.levels_hash(jsonb) from public, anon, authenticated;
revoke all on function public.required_bricks(jsonb) from public, anon, authenticated;
revoke all on function public.profiles_moderation() from public, anon, authenticated;
revoke all on function public.moderation_resolve(uuid, boolean, text, text) from public, anon, authenticated;
revoke all on function public.can_review(uuid) from public, anon, authenticated;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

revoke all on function public.my_moderation() from public, anon;
revoke all on function public.report_creation(uuid, text, text) from public, anon;
revoke all on function public.review_queue() from public, anon;
revoke all on function public.cast_review_vote(uuid, boolean) from public, anon;
revoke all on function public.appeal_creation(uuid, text) from public, anon;
revoke all on function public.admin_overview() from public, anon;
revoke all on function public.admin_creations(text, text) from public, anon;
revoke all on function public.admin_moderate(uuid, text, text) from public, anon;
revoke all on function public.admin_players(text) from public, anon;
revoke all on function public.admin_player_action(uuid, text, integer) from public, anon;
revoke all on function public.admin_log() from public, anon;
grant execute on function public.my_moderation() to authenticated;
grant execute on function public.report_creation(uuid, text, text) to authenticated;
grant execute on function public.review_queue() to authenticated;
grant execute on function public.cast_review_vote(uuid, boolean) to authenticated;
grant execute on function public.appeal_creation(uuid, text) to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_creations(text, text) to authenticated;
grant execute on function public.admin_moderate(uuid, text, text) to authenticated;
grant execute on function public.admin_players(text) to authenticated;
grant execute on function public.admin_player_action(uuid, text, integer) to authenticated;
grant execute on function public.admin_log() to authenticated;
