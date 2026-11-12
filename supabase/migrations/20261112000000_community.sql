-- Bounce Forge community library: player profiles, published creations, plays and likes.
--
-- Security model:
-- * every player is an (anonymous) Supabase user; a profile holds the public nickname;
-- * everyone can read published creations; authors also see their own unlisted ones;
-- * creations are written only through `publish_creation`, which validates every grid on the
--   server and limits publishing to 5 new creations per player per day;
-- * plays and likes go through small functions so counters cannot be forged.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ tables

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null unique
    check (char_length(nickname) between 3 and 20 and nickname ~ '^[[:alnum:] _.-]+$'),
  created_at timestamptz not null default now(),
  trust integer not null default 0,
  publish_banned_until timestamptz
);

create table if not exists public.creations (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('level', 'campaign')),
  title text not null check (char_length(title) between 3 and 60),
  description text not null default '' check (char_length(description) <= 300),
  levels jsonb not null,
  level_count integer not null check (level_count between 1 and 24),
  difficulty smallint not null default 1 check (difficulty between 1 and 5),
  status text not null default 'published'
    check (status in ('published', 'unlisted', 'review', 'removed')),
  version integer not null default 1,
  plays integer not null default 0,
  likes integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creations_new on public.creations (created_at desc)
  where status = 'published';
create index if not exists creations_likes on public.creations (likes desc)
  where status = 'published';
create index if not exists creations_plays on public.creations (plays desc)
  where status = 'published';
create index if not exists creations_author on public.creations (author_id);

create table if not exists public.plays (
  creation_id uuid not null references public.creations (id) on delete cascade,
  player_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  completed boolean not null default false,
  primary key (creation_id, player_id, day)
);

create table if not exists public.likes (
  creation_id uuid not null references public.creations (id) on delete cascade,
  player_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (creation_id, player_id)
);

-- ------------------------------------------------------------------ row level security

alter table public.profiles enable row level security;
alter table public.creations enable row level security;
alter table public.plays enable row level security;
alter table public.likes enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (true);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- Players may only choose their nickname; trust and bans are for moderation.
revoke insert, update on public.profiles from anon, authenticated;
grant insert (id, nickname) on public.profiles to authenticated;
grant update (nickname) on public.profiles to authenticated;

drop policy if exists creations_read on public.creations;
create policy creations_read on public.creations for select
  using (status = 'published' or author_id = auth.uid());
drop policy if exists creations_delete on public.creations;
create policy creations_delete on public.creations for delete using (author_id = auth.uid());
revoke insert, update on public.creations from anon, authenticated;

drop policy if exists likes_read on public.likes;
create policy likes_read on public.likes for select using (player_id = auth.uid());
revoke insert, update, delete on public.likes from anon, authenticated;
revoke all on public.plays from anon, authenticated;

-- ------------------------------------------------------------------ grid validation

-- Same rules as shared/editorGridRules.mjs: 58 rows of 36 known symbols, at least one brick
-- that must be destroyed to win.
create or replace function public.valid_level(level jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  grid jsonb;
  line text;
  has_required boolean := false;
  i integer;
begin
  if jsonb_typeof(level) <> 'object' then
    return false;
  end if;
  grid := level -> 'rows';
  if jsonb_typeof(grid) <> 'array' or jsonb_array_length(grid) <> 58 then
    return false;
  end if;
  for i in 0..57 loop
    if jsonb_typeof(grid -> i) <> 'string' then
      return false;
    end if;
    line := grid ->> i;
    if char_length(line) <> 36 or line !~ '^[.123EBSXCKGRIMOTF]+$' then
      return false;
    end if;
    if line ~ '[123EBSCKIMF]' then
      has_required := true;
    end if;
  end loop;
  if level ? 'name' and (jsonb_typeof(level -> 'name') <> 'string'
      or char_length(level ->> 'name') > 60) then
    return false;
  end if;
  if level ? 'options' and jsonb_typeof(level -> 'options') <> 'object' then
    return false;
  end if;
  return has_required;
end;
$$;

-- ------------------------------------------------------------------ functions

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

  if p_id is null then
    select count(*) into recent from public.creations
      where author_id = me and created_at > now() - interval '1 day';
    if recent >= 5 then
      raise exception 'rate_limited';
    end if;
    insert into public.creations (author_id, kind, title, description, levels, level_count, difficulty)
    values (
      me, p_kind, trim(p_title), trim(coalesce(p_description, '')), p_levels, level_total,
      greatest(1, least(5, coalesce(p_difficulty, 1)))
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

-- Hide a creation from the library (or show it again) without deleting it.
create or replace function public.set_creation_listed(p_id uuid, p_listed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.creations
     set status = case when p_listed then 'published' else 'unlisted' end,
         updated_at = now()
   where id = p_id and author_id = auth.uid() and status in ('published', 'unlisted');
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

-- One play per player, creation and day; `completed` sticks once reached.
create or replace function public.record_play(p_id uuid, p_completed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  insert into public.plays (creation_id, player_id, completed)
  values (p_id, auth.uid(), p_completed)
  on conflict (creation_id, player_id, day)
  do update set completed = public.plays.completed or excluded.completed;
  update public.creations
     set plays = (select count(*) from public.plays where creation_id = p_id)
   where id = p_id;
end;
$$;

-- Toggles the player's like and returns whether the creation is now liked.
create or replace function public.toggle_like(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  liked boolean;
begin
  if auth.uid() is null then
    raise exception 'auth_required';
  end if;
  delete from public.likes where creation_id = p_id and player_id = auth.uid();
  if found then
    liked := false;
  else
    insert into public.likes (creation_id, player_id) values (p_id, auth.uid());
    liked := true;
  end if;
  update public.creations
     set likes = (select count(*) from public.likes where creation_id = p_id)
   where id = p_id;
  return liked;
end;
$$;

revoke all on function public.publish_creation(text, text, text, jsonb, integer, uuid) from public, anon;
revoke all on function public.set_creation_listed(uuid, boolean) from public, anon;
revoke all on function public.record_play(uuid, boolean) from public, anon;
revoke all on function public.toggle_like(uuid) from public, anon;
grant execute on function public.publish_creation(text, text, text, jsonb, integer, uuid) to authenticated;
grant execute on function public.set_creation_listed(uuid, boolean) to authenticated;
grant execute on function public.record_play(uuid, boolean) to authenticated;
grant execute on function public.toggle_like(uuid) to authenticated;
