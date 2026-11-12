-- Explicit table privileges for the community library.
--
-- Some Supabase projects do not grant anything on new tables to the API roles by default, so the
-- first migration's row level security policies were never reached ("permission denied"). These
-- grants are the minimum the client needs; the policies still decide which rows are visible.

grant usage on schema public to anon, authenticated;

-- Library browsing works without an account.
grant select on public.profiles to anon, authenticated;
grant select on public.creations to anon, authenticated;

-- Authors delete their own creations (policy creations_delete), players read their own likes.
grant delete on public.creations to authenticated;
grant select on public.likes to authenticated;

-- Players can delete their own profile (and, by cascade, their creations).
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete using (id = auth.uid());
grant delete on public.profiles to authenticated;
