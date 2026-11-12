-- Chapter 6 brings the boss armour block `W` (shared/editorGridRules.mjs): community levels may
-- use it, and it counts as a brick that must be destroyed to win.

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
    if char_length(line) <> 36 or line !~ '^[.123EBSXCKGRIMOTFW]+$' then
      return false;
    end if;
    if line ~ '[123EBSCKIMFW]' then
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

create or replace function public.required_bricks(p_level jsonb)
returns integer
language sql
immutable
as $$
  select coalesce(sum(char_length(regexp_replace(line, '[^123EBSCKIMFW]', '', 'g'))), 0)::integer
    from jsonb_array_elements_text(p_level -> 'rows') as line
$$;

revoke all on function public.required_bricks(jsonb) from public, anon, authenticated;
